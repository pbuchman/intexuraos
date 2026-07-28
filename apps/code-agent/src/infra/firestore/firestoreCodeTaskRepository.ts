/** Firestore implementation of CodeTask repository — thin adapter that delegates to
 *  sibling modules under `apps/code-agent/src/infra/firestore/`:
 *  `task-serializer` (shape), `task-dedup` (create-time dedup), `task-query-builder` (queries). */

/* eslint-disable */

import type {
  Firestore,
  Query,
  QueryDocumentSnapshot,
  Transaction as FirestoreTransaction,
} from '@google-cloud/firestore';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { CodeTask } from '../../domain/models/codeTask.js';
import { resolveTaskLifecycleTime } from '../../domain/models/taskLifecycleTime.js';
import type {
  CodeTaskRepository, CreateTaskInput, ListTasksInput, ListTasksOutput, RepositoryError, UpdateTaskInput,
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

const EXACT_TASK_READ_CHUNK_SIZE = 100;
const COMPATIBILITY_LIST_SCAN_PAGE_SIZE = 100;
const COMPATIBILITY_LIST_SCAN_MAX_PAGES = 10;
const OWNER_LINEAR_SCAN_PAGE_SIZE = 50;
const OWNER_LINEAR_SCAN_MAX_PAGES = 10;
const OWNER_LINEAR_SCAN_MAX_RESULTS = 50;

function needsCompletedStatusCompatibility(input: ListTasksInput): boolean {
  return input.status?.some(
    (status) => status === 'planned' || status === 'reviewed' || status === 'implemented',
  ) === true;
}

function firestoreError(error: unknown): RepositoryError {
  /* v8 ignore start -- ts-type: catch blocks always throw Error instances so non-Error branch is unreachable in unit tests @preserve */
  const message = error instanceof Error ? error.message : String(error);
  /* v8 ignore stop @preserve */
  return { code: 'FIRESTORE_ERROR', message: `Firestore error: ${message}` };
}

class RepositoryTransactionResultError extends Error {
  constructor(readonly repositoryError: RepositoryError) {
    super('Repository transaction operation returned an error result');
  }
}

export const createFirestoreCodeTaskRepository = (deps: {
  firestore: Firestore;
  logger: Logger;
}): CodeTaskRepository => {
  const { firestore, logger } = deps;
  const collection = firestore.collection('code_tasks');
  type PendingLifecycleTransition = {
    existingTask: CodeTask;
    updatedTask: CodeTask;
    input: UpdateTaskInput;
  };
  const transactionLifecycleTransitions = new WeakMap<
    FirestoreTransaction,
    PendingLifecycleTransition[]
  >();

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
  const logLifecycleTransition = (
    existingTask: CodeTask,
    updatedTask: CodeTask,
    input?: UpdateTaskInput,
  ): void => {
    if (existingTask.status === updatedTask.status) return;
    const resolved = resolveTaskLifecycleTime(updatedTask);
    const inputDispatchStatus = input?.dispatchStatus;
    const dispatchReason =
      (inputDispatchStatus !== undefined && inputDispatchStatus !== null
        ? inputDispatchStatus.terminalCause?.reason ?? inputDispatchStatus.reason
        : undefined)
      ?? existingTask.dispatchStatus?.terminalCause?.reason
      ?? existingTask.dispatchStatus?.reason;
    const inputError = input?.error;
    const errorCode =
      (inputError !== undefined && inputError !== null ? inputError.code : undefined)
      ?? updatedTask.error?.code;
    logger.info({
      taskId: updatedTask.id,
      userId: updatedTask.userId,
      workerType: updatedTask.workerType,
      workerLocation: updatedTask.workerLocation,
      fromStatus: existingTask.status,
      toStatus: updatedTask.status,
      statusChangedAt: resolved.at.toDate().toISOString(),
      lifecycleTimeSource: resolved.source,
      ...(dispatchReason !== undefined && { dispatchReason }),
      ...(errorCode !== undefined && { errorCode }),
    }, 'Code task lifecycle transitioned');
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
      /* v8 ignore start -- ts-type: optional transaction branch for exactOptionalPropertyTypes; direct repository reads are covered and transaction callers pass options explicitly @preserve */
      const doc = options?.transaction !== undefined
        ? await options.transaction.get(docRef)
        : await docRef.get();
      /* v8 ignore stop @preserve */
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
    findByIdsForUser: (taskIds, userId) => guarded<CodeTask[]>(async () => {
      const uniqueTaskIds = [...new Set(taskIds)];
      const tasks: CodeTask[] = [];
      for (let offset = 0; offset < uniqueTaskIds.length; offset += EXACT_TASK_READ_CHUNK_SIZE) {
        const chunkIds = uniqueTaskIds.slice(offset, offset + EXACT_TASK_READ_CHUNK_SIZE);
        const refs = chunkIds.map((taskId) => collection.doc(taskId));
        const snapshots = await firestore.getAll(...refs);
        const ownedById = new Map<string, CodeTask>();
        for (const snapshot of snapshots) {
          if (!snapshot.exists || snapshot.data()?.['userId'] !== userId) continue;
          ownedById.set(snapshot.id, fromFirestoreDoc(snapshot));
        }
        for (const taskId of chunkIds) {
          const task = ownedById.get(taskId);
          if (task !== undefined) tasks.push(task);
        }
      }
      return tasks;
    }, {
      userId,
      requestedTaskCount: taskIds.length,
    }, 'Failed to find tasks by ids for user'),
    update: (taskId, input, options) => guarded<CodeTask>(async () => {
      const docRef = collection.doc(taskId);
      type UpdateOutcome =
        | { kind: 'not_updated'; result: Result<CodeTask, RepositoryError> }
        | {
          kind: 'updated';
          result: Result<CodeTask, RepositoryError>;
          existingTask: CodeTask;
          updatedTask: CodeTask;
        };
      const applyUpdate = async (
        transaction: FirestoreTransaction,
        transitionSink?: PendingLifecycleTransition[] | null,
      ): Promise<UpdateOutcome> => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
          return {
            kind: 'not_updated',
            result: err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` }),
          };
        }
        const existingTask = fromFirestoreDoc(doc);
        const updateData = buildUpdateData(existingTask, input, new Date());
        const merged = mergeUpdateForTransaction(doc.data()!, updateData);
        const updatedTask = fromFirestoreDoc({ id: taskId, data: () => merged });
        const statusChanged = existingTask.status !== updatedTask.status;
        if (statusChanged && transitionSink === null) {
          return {
            kind: 'not_updated',
            result: err({
              code: 'FIRESTORE_ERROR',
              message: 'Status transitions with an external transaction require runInTransaction',
            }),
          };
        }
        transaction.update(docRef, updateData);
        if (statusChanged && transitionSink !== undefined && transitionSink !== null) {
          transitionSink.push({ existingTask, updatedTask, input });
        }
        return { kind: 'updated', result: ok(updatedTask), existingTask, updatedTask };
      };

      if (options?.transaction !== undefined) {
        const transitionSink =
          transactionLifecycleTransitions.get(options.transaction) ?? null;
        const outcome = await applyUpdate(options.transaction, transitionSink);
        return outcome.result;
      }

      const outcome = await firestore.runTransaction(applyUpdate);
      if (outcome.kind === 'updated') {
        logLifecycleTransition(outcome.existingTask, outcome.updatedTask, input);
      }
      return outcome.result;
    }, { taskId, input }, 'Failed to update task', true),
    list: (input: ListTasksInput) => guarded<ListTasksOutput>(async () => {
      if (needsCompletedStatusCompatibility(input)) {
        const limit = input.limit ?? 20;
        const publicStatuses = new Set(
          /* v8 ignore start -- upstream: needsCompletedStatusCompatibility guarantees input.status is defined before this compatibility branch is entered @preserve */
          input.status ?? []
          /* v8 ignore stop @preserve */
        );
        const matchingTasks: CodeTask[] = [];
        let scanCursor = input.cursor;
        let lastScannedTaskId: string | undefined;
        let exhausted = false;

        for (
          let page = 0;
          page < COMPATIBILITY_LIST_SCAN_MAX_PAGES && matchingTasks.length <= limit;
          page += 1
        ) {
          const scanInput: ListTasksInput = {
            ...input,
            limit: COMPATIBILITY_LIST_SCAN_PAGE_SIZE - 1,
            ...(scanCursor !== undefined ? { cursor: scanCursor } : {}),
          };
          const { query } = await buildListQuery(collection, scanInput);
          const docs = (await query.get()).docs;
          exhausted = docs.length < COMPATIBILITY_LIST_SCAN_PAGE_SIZE;

          for (const doc of docs) {
            lastScannedTaskId = doc.id;
            const task = fromFirestoreDoc(doc);
            if (publicStatuses.has(task.status)) matchingTasks.push(task);
            if (matchingTasks.length > limit) break;
          }

          if (matchingTasks.length > limit || exhausted) break;
          const lastDoc = docs.at(-1);
          /* v8 ignore start -- upstream: exhausted-page early return guarantees a non-exhausted query page always has a final document @preserve */
          if (lastDoc === undefined) {
            exhausted = true;
            break;
          }
          /* v8 ignore stop @preserve */
          scanCursor = lastDoc.id;
        }

        const tasks = matchingTasks.slice(0, limit);
        const out: ListTasksOutput = { tasks };
        if (matchingTasks.length > limit) {
          const lastReturnedTask = tasks.at(-1);
          if (lastReturnedTask !== undefined) out.nextCursor = lastReturnedTask.id;
        } else if (!exhausted && lastScannedTaskId !== undefined) {
          out.nextCursor = lastScannedTaskId;
        }
        return out;
      }

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
      try {
        let committedTransitions: PendingLifecycleTransition[] = [];
        const result = await firestore.runTransaction(async (transaction) => {
          const attemptTransitions: PendingLifecycleTransition[] = [];
          transactionLifecycleTransitions.set(transaction, attemptTransitions);
          try {
            const attemptResult = await operation(transaction);
            if (!attemptResult.ok) {
              throw new RepositoryTransactionResultError(attemptResult.error);
            }
            committedTransitions = attemptTransitions;
            return attemptResult;
          } finally {
            transactionLifecycleTransitions.delete(transaction);
          }
        });
        for (const transition of committedTransitions) {
          logLifecycleTransition(
            transition.existingTask,
            transition.updatedTask,
            transition.input,
          );
        }
        return result;
      }
      catch (error) {
        if (error instanceof RepositoryTransactionResultError) {
          return err(error.repositoryError);
        }
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
    findRecentTasksByLinearIssue: (linearIssueId, limit, userId) => guarded(async () => {
      if (userId === undefined) {
        return await docsToTasks(recentByLinearIssue(collection, linearIssueId, limit));
      }

      const startedAt = Date.now();
      const requestedLimit = Math.min(Math.max(limit, 0), OWNER_LINEAR_SCAN_MAX_RESULTS);
      const tasks: CodeTask[] = [];
      let cursorDoc: QueryDocumentSnapshot | undefined;
      let scannedTaskCount = 0;
      let exhausted = false;

      for (
        let page = 0;
        page < OWNER_LINEAR_SCAN_MAX_PAGES && tasks.length < requestedLimit;
        page += 1
      ) {
        let query = recentByLinearIssue(
          collection,
          linearIssueId,
          OWNER_LINEAR_SCAN_PAGE_SIZE,
        );
        if (cursorDoc !== undefined) query = query.startAfter(cursorDoc);
        const snapshot = await query.get();
        exhausted = snapshot.docs.length < OWNER_LINEAR_SCAN_PAGE_SIZE;

        for (const doc of snapshot.docs) {
          scannedTaskCount += 1;
          if (doc.data()['userId'] === userId) tasks.push(fromFirestoreDoc(doc));
          if (tasks.length >= requestedLimit) break;
        }

        if (tasks.length >= requestedLimit || exhausted) break;
        cursorDoc = snapshot.docs.at(-1);
        /* v8 ignore start -- upstream: exhausted-page early return guarantees a full owner-scan page always has a final cursor document @preserve */
        if (cursorDoc === undefined) {
          exhausted = true;
          break;
        }
        /* v8 ignore stop @preserve */
      }

      logger.info({
        linearIssueId,
        userId,
        requestedLimit,
        matchedTaskCount: tasks.length,
        scannedTaskCount,
        exhausted,
        durationMs: Date.now() - startedAt,
        [SKIP_SENTRY_KEY]: true,
      }, 'Completed owner-scoped Linear issue task scan');
      return tasks;
    }, { linearIssueId, limit, userId }, 'Failed to find recent tasks by Linear issue'),
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
    claimForDispatch: (taskId) => guarded(async () => {
      const outcome = await firestore.runTransaction(async (txn) => {
        const docRef = collection.doc(taskId);
        const snap = await txn.get(docRef);
        if (!snap.exists || snap.get('status') !== 'queued') {
          return { claimed: false } as const;
        }
        const existingTask = fromFirestoreDoc(snap);
        const transitionTimestamp = Timestamp.fromDate(new Date());
        const updateData = {
          status: 'dispatched',
          statusChangedAt: transitionTimestamp,
          dispatchedAt: transitionTimestamp,
          updatedAt: transitionTimestamp,
          completedAt: FieldValue.delete(),
          dispatchStatus: FieldValue.delete(),
          schemaVersion: 2,
          schemaUpdatedAt: transitionTimestamp,
        };
        txn.update(docRef, updateData);
        const merged = mergeUpdateForTransaction(snap.data()!, updateData);
        return {
          claimed: true,
          existingTask,
          updatedTask: fromFirestoreDoc({ id: taskId, data: () => merged }),
        } as const;
      });
      if (!outcome.claimed) return false;
      logLifecycleTransition(outcome.existingTask, outcome.updatedTask);
      return true;
    },
      { taskId },
      'Failed to claim task for dispatch',
    ),
  };
};
