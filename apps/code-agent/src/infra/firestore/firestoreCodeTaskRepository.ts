/** Firestore implementation of CodeTask repository — thin adapter that delegates to
 *  sibling modules under `apps/code-agent/src/infra/firestore/`:
 *  `task-serializer` (shape), `task-dedup` (create-time dedup), `task-query-builder` (queries). */

/* eslint-disable */

import type { Firestore, Query, Transaction as FirestoreTransaction } from '@google-cloud/firestore';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
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
} from './task-serializer.js';
import { checkDedupLayers, generateDedupKey } from './task-dedup.js';
import {
  activeByLinearIssue, activeReviewForPR, allNotArchived, buildListQuery,
  dispatchedOrRunningForLinearIssue, dispatchedOrRunningForPR, erroredExecutionMemoryPostRun, latestAskAgentForUser,
  nonArchivedForUser, nonArchivedGlobal, pendingExecutionMemoryPostRun,
  plannedPlanningByLinearIssue, preservedPullRequestForPR, prTasksByCreatedAt,
  queuedOrderedByAge, recentByLinearIssue, recentRemediationForPR, scanPrWindow,
  selectLatestExecutionTask, selectNonMergeConflict, selectOriginTask,
  selectPreservedPullRequest, tasksCreatedSince, zombieTasks,
} from './task-query-builder.js';
import { LIST_QUEUED_DEFAULT_LIMIT } from './task-constants.js';

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
    findById: (taskId, options) => guarded<CodeTask>(async () => {
      const docRef = collection.doc(taskId);
      const doc = options?.transaction !== undefined
        ? await options.transaction.get(docRef)
        : await docRef.get();
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
        return err(firestoreError(error));
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
    findRecentTasksByPR: (repository, prNumber, limit) => guarded(
      () => docsToTasks(prTasksByCreatedAt(collection, repository, prNumber, limit)),
      { repository, prNumber, limit }, 'Failed to find recent tasks by PR',
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
    hasOtherDispatchedOrRunningForLinearIssue: (taskId, linearIssueId) => guarded(async () => {
      const snap = await dispatchedOrRunningForLinearIssue(collection, linearIssueId).get();
      const sibling = snap.docs.find((d) => d.id !== taskId);
      return sibling === undefined
        ? { hasActive: false }
        : { hasActive: true, taskId: sibling.id };
    }, { taskId, linearIssueId }, 'Failed to check dispatched/running sibling for Linear issue'),
    claimForDispatch: (taskId) => guarded(
      () => firestore.runTransaction(async (txn) => {
        const docRef = collection.doc(taskId);
        const snap = await txn.get(docRef);
        if (!snap.exists || snap.get('status') !== 'queued') return false;
        txn.update(docRef, {
          status: 'dispatched',
          dispatchedAt: new Date(),
          dispatchStatus: FieldValue.delete(),
        });
        return true;
      }),
      { taskId },
      'Failed to claim task for dispatch',
    ),
  };
};
