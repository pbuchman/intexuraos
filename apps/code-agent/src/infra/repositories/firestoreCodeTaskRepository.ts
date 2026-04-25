/** Firestore implementation of CodeTask repository — thin adapter that delegates to
 *  sibling modules under `apps/code-agent/src/infra/firestore/`:
 *  `task-serializer` (shape), `task-dedup` (create-time dedup), `task-query-builder` (queries). */

/* eslint-disable */

import type { Firestore, Query, Transaction as FirestoreTransaction } from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type {
  CodeTaskRepository, CreateTaskInput, ListTasksInput, ListTasksOutput, RepositoryError,
} from '../../domain/repositories/codeTaskRepository.js';
import { NON_ARCHIVED_STATUSES } from '../../domain/issueGrouping/constants.js';
import {
  buildUpdateData, fromFirestoreDoc, mergeUpdateForTransaction, toFirestoreDoc,
} from '../firestore/task-serializer.js';
import { checkDedupLayers, generateDedupKey } from '../firestore/task-dedup.js';
import {
  activeByLinearIssue, activeReviewForPR, allNotArchived, archivableTasks, buildListQuery,
  dispatchedOrRunningForPR, erroredExecutionMemoryPostRun, latestAskAgentForUser,
  nonArchivedForUser, nonArchivedGlobal, pendingExecutionMemoryPostRun,
  plannedPlanningByLinearIssue, preservedPullRequestForPR, prTasksByCreatedAt,
  queuedOrderedByAge, recentByLinearIssue, recentRemediationForPR, scanPrWindow,
  selectLatestExecutionTask, selectNonMergeConflict, selectOriginTask,
  selectPreservedPullRequest, tasksCreatedSince, zombieTasks,
} from '../firestore/task-query-builder.js';
import { LIST_QUEUED_DEFAULT_LIMIT } from '../firestore/task-constants.js';

function firestoreError(error: unknown): RepositoryError {
  /* v8 ignore start -- ts-type: catch blocks always throw Error instances so non-Error branch is unreachable in unit tests @preserve */
  const message = error instanceof Error ? error.message : String(error);
  /* v8 ignore stop @preserve */
  return { code: 'FIRESTORE_ERROR', message: `Firestore error: ${message}` };
}

export const createFirestoreCodeTaskRepository = (deps: {
  firestore: Firestore;
  logger: Logger;
}): CodeTaskRepository => {
  const { firestore, logger } = deps;
  const collection = firestore.collection('code_tasks');

  /** Run an async thunk and wrap it in Result + uniform error logging.
   *  When `asResult` is true, the thunk already returns a Result and is passed through. */
  const guarded = async <T>(
    fn: () => Promise<T | Result<T, RepositoryError>>,
    logCtx: Record<string, unknown>, errMsg: string, asResult = false,
  ): Promise<Result<T, RepositoryError>> => {
    try {
      const out = await fn();
      return asResult ? (out as Result<T, RepositoryError>) : ok(out as T);
    } catch (error) {
      logger.error({ error, ...logCtx }, errMsg);
      return err(firestoreError(error));
    }
  };
  const docsToTasks = async (q: Query): Promise<CodeTask[]> =>
    (await q.get()).docs.map((d) => fromFirestoreDoc(d));
  const firstOrNull = async (q: Query): Promise<CodeTask | null> => {
    const snap = await q.get();
    return snap.empty ? null : fromFirestoreDoc(snap.docs[0]!);
  };
  const runCreate = async (
    input: CreateTaskInput, transaction: FirestoreTransaction,
    ctx: { taskId: string; dedupKey: string; now: Date },
  ): Promise<Result<CodeTask, RepositoryError>> => {
    const d = await checkDedupLayers(transaction, collection, input, { logger, ...ctx });
    if (!d.ok) return err(d.error);
    const taskData = toFirestoreDoc(input, ctx);
    transaction.set(collection.doc(ctx.taskId), taskData);
    return ok(taskData);
  };

  return {
    create: (input, options) => {
      const ctx = {
        taskId: input.id ?? `task_${randomUUID()}`,
        dedupKey: generateDedupKey(input.userId, input.prompt, input.linearIssueId),
        now: new Date(),
      };
      return guarded<CodeTask>(
        () => options?.transaction !== undefined
          ? runCreate(input, options.transaction, ctx)
          : firestore.runTransaction((t: FirestoreTransaction) => runCreate(input, t, ctx)),
        {}, 'Failed to create task', true,
      );
    },
    findById: (taskId) => guarded<CodeTask>(async () => {
      const doc = await collection.doc(taskId).get();
      if (!doc.exists) return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
      return ok(fromFirestoreDoc(doc));
    }, { taskId }, 'Failed to find task by id', true),
    findByIdForUser: (taskId, userId) => guarded<CodeTask>(async () => {
      const doc = await collection.doc(taskId).get();
      if (!doc.exists || doc.data()?.['userId'] !== userId) {
        return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
      }
      return ok(fromFirestoreDoc(doc));
    }, { taskId, userId }, 'Failed to find task by id for user', true),
    update: (taskId, input, options) => guarded<CodeTask>(async () => {
      const docRef = collection.doc(taskId);
      const doc = options?.transaction !== undefined
        ? await options.transaction.get(docRef) : await docRef.get();
      if (!doc.exists) return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
      const updateData = buildUpdateData(input);
      if (options?.transaction !== undefined) {
        options.transaction.update(docRef, updateData);
        // doc.exists checked above, so data() returns the actual document data
        const merged = mergeUpdateForTransaction(doc.data()!, updateData);
        return ok(fromFirestoreDoc({ id: taskId, data: () => merged }));
      }
      await docRef.update(updateData);
      return ok(fromFirestoreDoc(await docRef.get()));
    }, { taskId, input }, 'Failed to update task', true),
    list: (input: ListTasksInput) => guarded<ListTasksOutput>(async () => {
      const { query, limit } = await buildListQuery(collection, input);
      const docs = (await query.get()).docs;
      const hasMore = docs.length > limit;
      const result = hasMore ? docs.slice(0, limit) : docs;
      const out: ListTasksOutput = { tasks: result.map((d) => fromFirestoreDoc(d)) };
      if (hasMore && result.length > 0) {
        const last = result[result.length - 1];
        /* v8 ignore start -- ts-type: FakeFirestore always returns non-sparse arrays from queries @preserve */
        if (last !== undefined) out.nextCursor = last.id;
        /* v8 ignore stop @preserve */
      }
      return out;
    }, { input }, 'Failed to list tasks'),
    hasActiveTaskForLinearIssue: (linearIssueId) => guarded(async () => {
      const snap = await activeByLinearIssue(collection, linearIssueId).get();
      for (const t of snap.docs) {
        if (t.data()['agentType'] === 'review') continue;
        return { hasActive: true, taskId: t.id } as { hasActive: boolean; taskId?: string };
      }
      return { hasActive: false } as { hasActive: boolean; taskId?: string };
    }, { linearIssueId }, 'Failed to check active task for Linear issue'),
    findZombieTasks: (staleThreshold) => guarded(
      () => docsToTasks(zombieTasks(collection, Timestamp.fromDate(staleThreshold))),
      { staleThreshold }, 'Failed to find zombie tasks',
    ),
    countByUserToday: (userId) => guarded(async () => {
      const now = new Date();
      const startOfDay = Timestamp.fromDate(new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0,
      )));
      return (await tasksCreatedSince(collection, userId, startOfDay).get()).size;
    }, { userId }, 'Failed to count user tasks for today'),
    findArchivableTasks: (cutoffDate, limit) => guarded(async () =>
      (await archivableTasks(collection, Timestamp.fromDate(cutoffDate), limit).get())
        .docs.map((d) => ({ taskId: d.id })),
      { cutoffDate }, 'Failed to find archivable tasks',
    ),
    archiveTaskLogs: (taskId, batchSize) => guarded<{ logCount: number; archivedAt: Date }>(async () => {
      const taskRef = collection.doc(taskId);
      if (!(await taskRef.get()).exists) {
        return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
      }
      const wipe = async (name: string): Promise<number> => {
        const docs = (await taskRef.collection(name).get()).docs;
        let batch = firestore.batch();
        let n = 0;
        for (const d of docs) {
          batch.delete(d.ref);
          if (++n % batchSize === 0) { await batch.commit(); batch = firestore.batch(); }
        }
        if (n % batchSize !== 0) await batch.commit();
        return docs.length;
      };
      const logCount = (await wipe('logs')) + (await wipe('log_lines'))
        + (await wipe('log_entries')) + (await wipe('turn_metrics'));
      const archivedAt = new Date();
      await taskRef.update({ logsArchived: true, logCount, archivedAt: Timestamp.fromDate(archivedAt) });
      logger.info({ taskId, logCount }, 'Task logs archived');
      return ok({ logCount, archivedAt });
    }, { taskId }, 'Failed to archive task logs', true),
    findRecentRemediationForPR: (repository, prNumber) => guarded(
      () => firstOrNull(recentRemediationForPR(collection, repository, prNumber)),
      { repository, prNumber }, 'Failed to find recent remediation task for PR',
    ),
    findPreservedPullRequestTask: (repository, prNumber) => guarded(
      async () => selectPreservedPullRequest(
        (await preservedPullRequestForPR(collection, repository, prNumber).get()).docs,
      ),
      { repository, prNumber }, 'Failed to find preserved pull_request task',
    ),
    findLatestAskAgentTask: (userId) => guarded(
      () => firstOrNull(latestAskAgentForUser(collection, userId, NON_ARCHIVED_STATUSES)),
      { userId }, 'Failed to find latest ask-agent task',
    ),
    deleteTask: (taskId, userId) => guarded<void>(async () => {
      const doc = await collection.doc(taskId).get();
      if (!doc.exists || doc.data()?.['userId'] !== userId) {
        return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
      }
      await collection.doc(taskId).delete();
      return ok(undefined);
    }, { taskId }, 'Failed to delete task', true),
    // Order by createdAt (not queuedAt) — queuedAt is optional on pre-migration tasks.
    listQueuedByAge: (limit) => guarded(
      () => docsToTasks(queuedOrderedByAge(collection, limit)),
      { limit }, 'Failed to list queued tasks by age',
    ),
    listQueued: () => guarded(
      () => docsToTasks(queuedOrderedByAge(collection, LIST_QUEUED_DEFAULT_LIMIT)),
      {}, 'Failed to list queued tasks',
    ),
    countQueued: () => guarded(
      async () => (await collection.where('status', '==', 'queued').get()).size,
      {}, 'Failed to count queued tasks',
    ),
    findPlannedTaskByLinearIssue: (linearIssueId) => guarded(async () => {
      const snap = await plannedPlanningByLinearIssue(collection, linearIssueId).get();
      if (snap.empty) return null;
      const task = fromFirestoreDoc(snap.docs[0]!);
      // Only return if implementation has not already been launched
      if (
        task.implementationTaskId !== undefined
        || (task.fanOutChildTaskIds !== undefined && task.fanOutChildTaskIds.length > 0)
      ) return null;
      return task;
    }, { linearIssueId }, 'Failed to find planned task by Linear issue'),
    runInTransaction: async (operation) => {
      try { return await firestore.runTransaction((t) => operation(t)); }
      catch (error) {
        logger.error({ error }, 'Failed to run repository transaction');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listPendingExecutionMemoryPostRun: async (limit: number): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('agentType', 'in', ['execution', 'planning', 'review', 'remediation', 'pull_request'])
          .where('executionMemoryPostRun.status', '==', 'pending')
          .orderBy('completedAt', 'asc')
          .limit(limit)
          .get();

        return ok(snapshot.docs.map((doc) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        ));
      } catch (error) {
        logger.error({ error, limit }, 'Failed to list pending execution memory post-run tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listErroredExecutionMemoryPostRun: async (): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('executionMemoryPostRun.status', '==', 'error')
          .limit(50)
          .get();
        return ok(snapshot.docs.map((doc) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        ));
      } catch (error) {
        logger.error({ error }, 'Failed to list errored execution memory post-run tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findByPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        for (const doc of snapshot.docs) {
          const data = doc.data();
          if (!isMergeConflictTaskData(data)) {
            return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
          }
        }

        return ok(null);
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find task by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findActiveReviewForPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .where('agentType', '==', 'review')
          .where('status', 'in', ACTIVE_TASK_STATUSES)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find active review task by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    hasDispatchedOrRunningForPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<{ hasActive: boolean; taskId?: string }, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok({ hasActive: false });
        }

        const doc = snapshot.docs[0]!;
        return ok({ hasActive: true, taskId: doc.id });
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to check dispatched/running task for PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    hasOtherDispatchedOrRunningForLinearIssue: async (
      taskId: string,
      linearIssueId: string,
    ): Promise<Result<{ hasActive: boolean; taskId?: string }, RepositoryError>> => {
      try {
        // Use DISPATCHED_OR_RUNNING_STATUSES (NOT ACTIVE_TASK_STATUSES) — including 'queued'
        // would deadlock two queued reviews on the same Linear issue (each blocking the other).
        const snapshot = await collection
          .where('linearIssueId', '==', linearIssueId)
          .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
          .get();

        // Exclude the candidate's own document from the results.
        const sibling = snapshot.docs.find((doc) => doc.id !== taskId);
        if (sibling === undefined) {
          return ok({ hasActive: false });
        }
        return ok({ hasActive: true, taskId: sibling.id });
      } catch (error) {
        logger.error(
          { error, taskId, linearIssueId },
          'Failed to check non-self dispatched/running task for Linear issue',
        );
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    claimForDispatch: async (
      taskId: string,
    ): Promise<Result<
      | { claimed: true }
      | { claimed: false; alreadyClaimed: true }
      | { claimed: false; notFound: true },
      RepositoryError
    >> => {
      const docRef = collection.doc(taskId);
      try {
        const outcome = await firestore.runTransaction(
          async (
            txn,
          ): Promise<
            | { claimed: true }
            | { claimed: false; alreadyClaimed: true }
            | { claimed: false; notFound: true }
          > => {
            const snap = await txn.get(docRef);
            if (!snap.exists) {
              return { claimed: false, notFound: true };
            }
            const data = snap.data() ?? {};
            if (data['status'] !== 'queued') {
              return { claimed: false, alreadyClaimed: true };
            }
            txn.update(docRef, {
              status: 'dispatched',
              dispatchedAt: Timestamp.fromDate(new Date()),
              updatedAt: Timestamp.fromDate(new Date()),
            });
            return { claimed: true };
          },
        );
        return ok(outcome);
      } catch (error) {
        logger.error({ error, taskId }, 'Failed to claim task for dispatch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findLatestExecutionTaskByPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        // Query the newest 50 tasks for this PR and filter in-memory.
        // Uses limit(50) instead of a Firestore inequality filter on agentType
        // to avoid a composite index. 50 is generous — a PR would need 50+
        // consecutive review tasks before the oldest non-review task falls
        // outside this window.
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        // Find the first execution-eligible task.
        // Excludes review, remediation, planning, and merge-conflict follow-up tasks.
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const agentType = data['agentType'] as string | undefined;
          // Treat missing agentType as execution-eligible (backward compatibility)
          if (agentType !== 'review' && agentType !== 'remediation' && agentType !== 'planning' && !isMergeConflictTaskData(data)) {
            return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
          }
        }

        if (snapshot.docs.length === 50) {
          logger.warn(
            { repository, prNumber, docsScanned: 50 },
            'findLatestExecutionTaskByPR exhausted 50-doc window without finding an execution-eligible task',
          );
        }

        return ok(null);
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find latest execution task by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findOriginTaskByPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        // Query the newest 50 tasks for this PR and filter in-memory.
        // Uses limit(50) instead of a Firestore inequality filter on agentType
        // to avoid a composite index.
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        // Find the origin task: planning/execution preferred, pull_request as fallback
        let pullRequestFallback: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const agentType = data['agentType'] as string | undefined;
          if (agentType === 'planning' || agentType === 'execution') {
            return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
          }
          if (agentType === 'pull_request' && pullRequestFallback === null) {
            pullRequestFallback = doc;
          }
        }

        if (snapshot.docs.length === 50) {
          logger.warn(
            { repository, prNumber, docsScanned: 50 },
            'findOriginTaskByPR exhausted 50-doc window without finding an origin task',
          );
        }

        return ok(
          pullRequestFallback !== null
            ? toCodeTask(pullRequestFallback as { id: string; data(): Record<string, unknown> })
            : null
        );
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find origin task by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findRecentTasksByLinearIssue: async (
      linearIssueId: string,
      limit: number
    ): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('linearIssueId', '==', linearIssueId)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();

        const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        return ok(tasks);
      } catch (error) {
        logger.error({ error, linearIssueId, limit }, 'Failed to find recent tasks by Linear issue');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listAllNonArchived: async (userId: string): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('userId', '==', userId)
          .where('status', 'in', NON_ARCHIVED_STATUSES)
          .orderBy('createdAt', 'desc')
          .get();

        const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        return ok(tasks);
      } catch (error) {
        logger.error({ error, userId }, 'Failed to list all non-archived tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listAllNonArchivedGlobal: async (): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('status', 'in', NON_ARCHIVED_STATUSES)
          .orderBy('updatedAt', 'asc')
          .get();

        const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        return ok(tasks);
      } catch (error) {
        logger.error({ error }, 'Failed to list all non-archived tasks globally');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findAllNonArchived: async (): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        // Uses != 'archived' (not 'in NON_ARCHIVED_STATUSES') deliberately:
        // this approach is future-proof — any new status added later is automatically
        // included, ensuring the hasActive safety check in the use case always sees
        // the complete picture. listAllNonArchivedGlobal uses 'in' for backward compat.
        const snapshot = await collection
          .where('status', '!=', 'archived')
          .get();

        const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        return ok(tasks);
      } catch (error) {
        logger.error({ error }, 'Failed to find all non-archived tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },
    listPendingExecutionMemoryPostRun: (limit) => guarded(
      () => docsToTasks(pendingExecutionMemoryPostRun(collection, limit)),
      { limit }, 'Failed to list pending execution memory post-run tasks',
    ),
    listErroredExecutionMemoryPostRun: () => guarded(
      () => docsToTasks(erroredExecutionMemoryPostRun(collection)),
      {}, 'Failed to list errored execution memory post-run tasks',
    ),
    findByPR: (repository, prNumber) => guarded(
      async () => selectNonMergeConflict(
        (await prTasksByCreatedAt(collection, repository, prNumber).get()).docs,
      ),
      { repository, prNumber }, 'Failed to find task by PR',
    ),
    findActiveReviewForPR: (repository, prNumber) => guarded(
      () => firstOrNull(activeReviewForPR(collection, repository, prNumber)),
      { repository, prNumber }, 'Failed to find active review task by PR',
    ),
    hasDispatchedOrRunningForPR: (repository, prNumber) => guarded(async () => {
      const snap = await dispatchedOrRunningForPR(collection, repository, prNumber).get();
      const out: { hasActive: boolean; taskId?: string } = { hasActive: !snap.empty };
      if (!snap.empty) out.taskId = snap.docs[0]!.id;
      return out;
    }, { repository, prNumber }, 'Failed to check dispatched/running task for PR'),
    // Uses limit(50) + in-memory filter to avoid a composite index on agentType.
    findLatestExecutionTaskByPR: (repository, prNumber) => guarded(
      () => scanPrWindow(collection, repository, prNumber, selectLatestExecutionTask, logger,
        'findLatestExecutionTaskByPR exhausted 50-doc window without finding an execution-eligible task'),
      { repository, prNumber }, 'Failed to find latest execution task by PR',
    ),
    findOriginTaskByPR: (repository, prNumber) => guarded(
      () => scanPrWindow(collection, repository, prNumber, selectOriginTask, logger,
        'findOriginTaskByPR exhausted 50-doc window without finding an origin task'),
      { repository, prNumber }, 'Failed to find origin task by PR',
    ),
    findRecentTasksByLinearIssue: (linearIssueId, limit) => guarded(
      () => docsToTasks(recentByLinearIssue(collection, linearIssueId, limit)),
      { linearIssueId, limit }, 'Failed to find recent tasks by Linear issue',
    ),
    listAllNonArchived: (userId) => guarded(
      () => docsToTasks(nonArchivedForUser(collection, userId, NON_ARCHIVED_STATUSES)),
      { userId }, 'Failed to list all non-archived tasks',
    ),
    listAllNonArchivedGlobal: () => guarded(
      () => docsToTasks(nonArchivedGlobal(collection, NON_ARCHIVED_STATUSES)),
      {}, 'Failed to list all non-archived tasks globally',
    ),
    findAllNonArchived: () => guarded(
      () => docsToTasks(allNotArchived(collection)),
      {}, 'Failed to find all non-archived tasks',
    ),
  };
};
