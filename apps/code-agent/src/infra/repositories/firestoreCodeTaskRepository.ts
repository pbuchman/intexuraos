/**
 * Firestore implementation of CodeTask repository with transaction-based deduplication.
 */

/* eslint-disable */

import type { Firestore, QueryDocumentSnapshot, Transaction as FirestoreTransaction } from '@google-cloud/firestore';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { createHash, randomUUID } from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask } from '../../domain/models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  ListTasksOutput,
  RepositoryError,
} from '../../domain/repositories/codeTaskRepository.js';
import { NON_ARCHIVED_STATUSES } from '../../domain/issueGrouping/constants.js';

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (design line 1544)
const DEDUP_CANDIDATE_LIMIT = 5; // Fetch up to 5 candidates for app-level active-status filtering
const ACTIVE_TASK_STATUSES = ['queued', 'dispatched', 'running'] as const;

/** Statuses representing tasks actively consuming worker capacity (excludes queued). */
const DISPATCHED_OR_RUNNING_STATUSES = ['dispatched', 'running'] as const;

function stripLegacyLinearFields(data: Record<string, unknown>): Record<string, unknown> {
  const {
    linearIssueTitle: _linearIssueTitle,
    linearIssueUrl: _linearIssueUrl,
    linearIssueType: _linearIssueType,
    linearIssueLabels: _linearIssueLabels,
    linearFallback: _linearFallback,
    ...taskData
  } = data;
  return taskData;
}

function toCodeTask(doc: { id: string; data(): Record<string, unknown> }): CodeTask {
  const rawData = doc.data();
  const data = stripLegacyLinearFields(rawData);
  return {
    ...data,
    id: doc.id,
    createdAt: data['createdAt'] as Timestamp,
    updatedAt: data['updatedAt'] as Timestamp,
  } as CodeTask;
}

function toTimestamp(value: unknown): Timestamp | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  return undefined;
}

function serializeExecutionMemoryContext(
  input: CodeTask['executionMemoryContext']
): CodeTask['executionMemoryContext'] {
  /* v8 ignore start -- upstream: prior check guarantees serializer input is defined; private helper is not unit-testable @preserve */
  if (input === undefined) {
    return undefined;
  }
  /* v8 ignore stop @preserve */

  const { matchedAt: _matchedAt, ...rest } = input;
  const matchedAt = toTimestamp(input.matchedAt);

  return {
    ...rest,
    ...(matchedAt !== undefined && { matchedAt }),
  };
}

function serializeExecutionMemoryPostRun(
  input: CodeTask['executionMemoryPostRun']
): CodeTask['executionMemoryPostRun'] {
  /* v8 ignore start -- upstream: prior check guarantees serializer input is defined; private helper is not unit-testable @preserve */
  if (input === undefined) {
    return undefined;
  }
  /* v8 ignore stop @preserve */

  const {
    lastAttemptAt: _lastAttemptAt,
    completedAt: _completedAt,
    ...rest
  } = input;
  const lastAttemptAt = toTimestamp(input.lastAttemptAt);
  const completedAt = toTimestamp(input.completedAt);

  return {
    ...rest,
    ...(lastAttemptAt !== undefined && { lastAttemptAt }),
    ...(completedAt !== undefined && { completedAt }),
  };
}

function generateDedupKey(userId: string, prompt: string, linearIssueId?: string): string {
  // Normalize prompt: trim, collapse spaces, lowercase (design lines 1542-1547)
  const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  // Include linearIssueId when present so the same default prompt
  // ("Implement exactly as described...") produces distinct keys for different issues.
  const input = linearIssueId !== undefined
    ? userId + linearIssueId + normalized
    : userId + normalized;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 16);
}

function isMergeConflictTaskData(data: Record<string, unknown>): boolean {
  return data['followUpReason'] === 'merge_conflict' || data['systemPromptHash'] === MERGE_CONFLICT_SYSTEM_PROMPT_HASH;
}

export const createFirestoreCodeTaskRepository = (deps: {
  firestore: Firestore;
  logger: Logger;
}): CodeTaskRepository => {
  const { firestore, logger } = deps;
  const collection = firestore.collection('code_tasks');

  return {
    create: async (input: CreateTaskInput, options?: { transaction?: FirebaseFirestore.Transaction }): Promise<Result<CodeTask, RepositoryError>> => {
      const taskId = input.id ?? `task_${randomUUID()}`;
      const dedupKey = generateDedupKey(input.userId, input.prompt, input.linearIssueId);
      const now = new Date();
      const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_MS);

      const executeInTransaction = async (transaction: FirestoreTransaction): Promise<Result<CodeTask, RepositoryError>> => {
        // Layer 0: Check approvalEventId (design lines 1532-1536)
        if (input.approvalEventId !== undefined) {
          const approvalQuery = collection
            .where('approvalEventId', '==', input.approvalEventId)
            .limit(1);
          const approvalSnapshot = await transaction.get(approvalQuery);

          if (!approvalSnapshot.empty) {
            const existingTask = approvalSnapshot.docs[0]!;
            logger.info({
              dedupLayer: 0,
              dedupType: 'DUPLICATE_APPROVAL',
              existingTaskId: existingTask.id,
              approvalEventId: input.approvalEventId,
            }, 'Dedup triggered: duplicate approval event');
            return err({
              code: 'DUPLICATE_APPROVAL',
              message: 'Duplicate approval event',
              existingTaskId: existingTask.id,
            } as const);
          }
        }

        // Layer 1: Check actionId (design lines 1538-1541)
        if (input.actionId !== undefined) {
          const actionQuery = collection.where('actionId', '==', input.actionId).limit(1);
          const actionSnapshot = await transaction.get(actionQuery);

          if (!actionSnapshot.empty) {
            const existingTask = actionSnapshot.docs[0]!;
            logger.info({
              dedupLayer: 1,
              dedupType: 'DUPLICATE_ACTION',
              existingTaskId: existingTask.id,
              actionId: input.actionId,
            }, 'Dedup triggered: duplicate action');
            return err({
              code: 'DUPLICATE_ACTION',
              message: 'Duplicate action',
              existingTaskId: existingTask.id,
            } as const);
          }
        }

        // Layer 2: Check dedupKey within 5-minute window (design lines 1543-1554)
        // Skip dedup for retried tasks — same prompt is intentional
        // Skip dedup for execution follow-up tasks — implementation reuses planning prompt by design
        if (
          input.retriedFrom === undefined &&
          input.followUpReason !== 'execution_implement'
        ) {
          const dedupQuery = collection
            .where('dedupKey', '==', dedupKey)
            .where('createdAt', '>', Timestamp.fromDate(dedupWindowStart))
            .limit(DEDUP_CANDIDATE_LIMIT);
          const dedupSnapshot = await transaction.get(dedupQuery);

          // Only active tasks block dedup — terminal tasks (cancelled, failed, etc.) are ignored
          const activeStatuses: readonly string[] = ACTIVE_TASK_STATUSES;
          const activeMatch = dedupSnapshot.docs.find(
            (doc) => activeStatuses.includes(String(doc.data()['status']))
          );
          if (activeMatch !== undefined) {
            logger.info({
              dedupLayer: 2,
              dedupType: 'DUPLICATE_PROMPT',
              existingTaskId: activeMatch.id,
              dedupKey,
            }, 'Dedup triggered: duplicate prompt within 5 minutes');
            return err({
              code: 'DUPLICATE_PROMPT',
              message: 'Duplicate prompt within 5 minutes',
              existingTaskId: activeMatch.id,
            } as const);
          }
        }

        // Layer 3: Check active task for Linear issue (design lines 448-458)
        if (input.linearIssueId !== undefined && input.agentType !== 'review' && input.systemPromptHash !== MERGE_CONFLICT_SYSTEM_PROMPT_HASH) {
          const linearQuery = collection
            .where('linearIssueId', '==', input.linearIssueId)
            .where('status', 'in', ACTIVE_TASK_STATUSES);
          const linearSnapshot = await transaction.get(linearQuery);

          for (const existingTask of linearSnapshot.docs) {
            const existingData = existingTask.data();
            if (existingData['agentType'] === 'review' || existingData['systemPromptHash'] === MERGE_CONFLICT_SYSTEM_PROMPT_HASH) {
              continue;
            }

            logger.info({
              dedupLayer: 3,
              dedupType: 'ACTIVE_TASK_EXISTS',
              existingTaskId: existingTask.id,
              linearIssueId: input.linearIssueId,
            }, 'Dedup triggered: active task exists for Linear issue');
            return err({
              code: 'ACTIVE_TASK_EXISTS',
              message: 'Active task exists for Linear issue',
              existingTaskId: existingTask.id,
            } as const);
          }
        }

        // All checks passed - create the task
        const taskTimestamp = Timestamp.fromDate(now);
        const taskData: CodeTask = {
          id: taskId,
          userId: input.userId,
          prompt: input.prompt,
          sanitizedPrompt: input.sanitizedPrompt,
          systemPromptHash: input.systemPromptHash,
          workerType: input.workerType,
          workerLocation: input.workerLocation,
          repository: input.repository,
          baseBranch: input.baseBranch,
          traceId: input.traceId,
          status: input.initialStatus ?? 'queued',
          dedupKey,
          callbackReceived: false,
          createdAt: taskTimestamp,
          updatedAt: taskTimestamp,
        };

        // Add optional fields only if defined
        if (input.actionId !== undefined) {
          taskData.actionId = input.actionId;
        }
        if (input.approvalEventId !== undefined) {
          taskData.approvalEventId = input.approvalEventId;
        }
        if (input.linearIssueId !== undefined) {
          taskData.linearIssueId = input.linearIssueId;
        }
        if (input.webhookSecret !== undefined) {
          taskData.webhookSecret = input.webhookSecret;
        }
        if (input.retriedFrom !== undefined) {
          taskData.retriedFrom = input.retriedFrom;
        }
        if (input.prNumber !== undefined) {
          taskData.prNumber = input.prNumber;
        }
        if (input.prBranch !== undefined) {
          taskData.prBranch = input.prBranch;
        }
        if (input.parentTaskId !== undefined) {
          taskData.parentTaskId = input.parentTaskId;
        }
        if (input.followUpReason !== undefined) {
          taskData.followUpReason = input.followUpReason;
        }
        if (input.agentType !== undefined) {
          taskData.agentType = input.agentType;
        }
        if (input.planningPrBranch !== undefined) {
          taskData.planningPrBranch = input.planningPrBranch;
        }
        if (input.planningPrUrl !== undefined) {
          taskData.planningPrUrl = input.planningPrUrl;
        }
        if (input.trackingCommentId !== undefined) {
          taskData.trackingCommentId = input.trackingCommentId;
        }
        if (input.reviewTypes !== undefined) {
          taskData.reviewTypes = input.reviewTypes;
        }
        if (input.executionMemoryContext !== undefined) {
          const serializedExecutionMemoryContext = serializeExecutionMemoryContext(
            input.executionMemoryContext
          );
          /* v8 ignore start -- upstream: prior check guarantees serializer output is defined after guarded input; false branch is not reachable @preserve */
          if (serializedExecutionMemoryContext !== undefined) {
            taskData.executionMemoryContext = serializedExecutionMemoryContext;
          }
          /* v8 ignore stop @preserve */
        }
        if (input.executionMemoryPostRun !== undefined) {
          const serializedExecutionMemoryPostRun = serializeExecutionMemoryPostRun(
            input.executionMemoryPostRun
          );
          /* v8 ignore start -- upstream: prior check guarantees serializer output is defined after guarded input; false branch is not reachable @preserve */
          if (serializedExecutionMemoryPostRun !== undefined) {
            taskData.executionMemoryPostRun = serializedExecutionMemoryPostRun;
          }
          /* v8 ignore stop @preserve */
        }

        const docRef = collection.doc(taskId);
        transaction.set(docRef, taskData);

        return ok(taskData);
      };

      try {
        // If a transaction is provided (e.g., from createTaskForPR's outer transaction),
        // reuse it to avoid nested transactions. Otherwise, create our own.
        if (options?.transaction !== undefined) {
          return await executeInTransaction(options.transaction);
        }

        const result = await firestore.runTransaction(async (transaction: FirestoreTransaction) => {
          return executeInTransaction(transaction);
        });

        return result;
      } catch (error) {
        logger.error({ error }, 'Failed to create task');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findById: async (taskId: string): Promise<Result<CodeTask, RepositoryError>> => {
      try {
        const docRef = collection.doc(taskId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'NOT_FOUND',
            message: `Task ${taskId} not found`,
          });
        }

        return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error }, 'Failed to find task by id');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findByIdForUser: async (
      taskId: string,
      userId: string
    ): Promise<Result<CodeTask, RepositoryError>> => {
      try {
        const docRef = collection.doc(taskId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'NOT_FOUND',
            message: `Task ${taskId} not found`,
          });
        }

        const data = doc.data()!;

        // Verify user owns this task
        if (data['userId'] !== userId) {
          return err({
            code: 'NOT_FOUND',
            message: `Task ${taskId} not found`,
          });
        }

        return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error }, 'Failed to find task by id for user');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    update: async (
      taskId: string,
      input: UpdateTaskInput,
      options?: { transaction?: FirebaseFirestore.Transaction }
    ): Promise<Result<CodeTask, RepositoryError>> => {
      try {
        const docRef = collection.doc(taskId);
        const doc = options?.transaction !== undefined
          ? await options.transaction.get(docRef)
          : await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'NOT_FOUND',
            message: `Task ${taskId} not found`,
          });
        }

        const updateData: Record<string, unknown> = {};

        // Allow explicit updatedAt for heartbeat (INT-372), otherwise use current time
        if (input.updatedAt !== undefined) {
          updateData['updatedAt'] = Timestamp.fromDate(input.updatedAt);
        } else {
          updateData['updatedAt'] = Timestamp.fromDate(new Date());
        }

        if (input.status !== undefined) {
          updateData['status'] = input.status;
        }
        if (input.result !== undefined) {
          updateData['result'] = input.result;
        }
        if (input.error !== undefined) {
          updateData['error'] = input.error === null
            ? FieldValue.delete()
            : input.error;
        }
        if (input.statusSummary !== undefined) {
          updateData['statusSummary'] = input.statusSummary;
        }
        if (input.workerLocation !== undefined) {
          updateData['workerLocation'] = input.workerLocation;
        }
        if (input.callbackReceived !== undefined) {
          updateData['callbackReceived'] = input.callbackReceived;
        }
        if (input.queuedAt !== undefined) {
          updateData['queuedAt'] = Timestamp.fromDate(input.queuedAt);
        }
        if (input.dispatchedAt !== undefined) {
          updateData['dispatchedAt'] = Timestamp.fromDate(input.dispatchedAt);
        }
        if (input.completedAt !== undefined) {
          updateData['completedAt'] = Timestamp.fromDate(input.completedAt);
        }
        if (input.logChunksDropped !== undefined) {
          updateData['logChunksDropped'] = input.logChunksDropped;
        }
        if (input.lastHeartbeat !== undefined) {
          updateData['lastHeartbeat'] = Timestamp.fromDate(input.lastHeartbeat);
        }
        if (input.cancelNonce !== undefined) {
          updateData['cancelNonce'] = input.cancelNonce === null
            ? FieldValue.delete()
            : input.cancelNonce;
        }
        if (input.cancelNonceExpiresAt !== undefined) {
          updateData['cancelNonceExpiresAt'] = input.cancelNonceExpiresAt === null
            ? FieldValue.delete()
            : input.cancelNonceExpiresAt;
        }
        if (input.pendingUserMessages !== undefined) {
          updateData['pendingUserMessages'] = input.pendingUserMessages;
        }
        if (input.implementationTaskId !== undefined) {
          updateData['implementationTaskId'] = input.implementationTaskId === null
            ? FieldValue.delete()
            : input.implementationTaskId;
        }
        if (input.fanOutChildTaskIds !== undefined) {
          updateData['fanOutChildTaskIds'] = input.fanOutChildTaskIds === null
            ? FieldValue.delete()
            : input.fanOutChildTaskIds;
        }
        if (input.prNumber !== undefined) {
          updateData['prNumber'] = input.prNumber;
        }
        if (input.prBranch !== undefined) {
          updateData['prBranch'] = input.prBranch;
        }
        if (input.prMergedAt !== undefined) {
          updateData['prMergedAt'] = Timestamp.fromDate(input.prMergedAt);
        }
        if (input.executionMemoryContext !== undefined) {
          const serializedExecutionMemoryContext = serializeExecutionMemoryContext(
            input.executionMemoryContext
          );
          /* v8 ignore start -- upstream: prior check guarantees serializer output is defined after guarded input; false branch is not reachable @preserve */
          if (serializedExecutionMemoryContext !== undefined) {
            updateData['executionMemoryContext'] = serializedExecutionMemoryContext;
          }
          /* v8 ignore stop @preserve */
        }
        if (input.executionMemoryPostRun !== undefined) {
          const serializedExecutionMemoryPostRun = serializeExecutionMemoryPostRun(
            input.executionMemoryPostRun
          );
          /* v8 ignore start -- upstream: prior check guarantees serializer output is defined after guarded input; false branch is not reachable @preserve */
          if (serializedExecutionMemoryPostRun !== undefined) {
            updateData['executionMemoryPostRun'] = serializedExecutionMemoryPostRun;
          }
          /* v8 ignore stop @preserve */
        }
        if (input.requiresReReview !== undefined) {
          updateData['requiresReReview'] = input.requiresReReview;
        }

        if (options?.transaction !== undefined) {
          options.transaction.update(docRef, updateData);
          // Inside an external transaction, avoid read-after-write by merging
          // the known updates into the already-read doc data in memory.
          // Important: strip FieldValue.delete() sentinels — spread would leave
          // delete-sentinel objects in the merged result instead of omitting the
          // field. Filter them out so the returned CodeTask has a clean shape.
          const mergedData = { ...doc.data(), ...updateData };
          for (const [key, value] of Object.entries(mergedData)) {
            if (value instanceof FieldValue) {
              delete mergedData[key];
            }
          }
          return ok(toCodeTask({ id: taskId, data: () => mergedData } as { id: string; data(): Record<string, unknown> }));
        }

        await docRef.update(updateData);
        const updatedDoc = await docRef.get();
        return ok(toCodeTask(updatedDoc as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error, taskId, input }, 'Failed to update task');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    list: async (input: ListTasksInput): Promise<Result<ListTasksOutput, RepositoryError>> => {
      try {
        let query = collection.where('userId', '==', input.userId);

        // Firestore 'in' operator throws on empty array, so only add filter when non-empty
        if (input.status !== undefined && input.status.length > 0) {
          query = query.where('status', 'in', input.status);
        }

        query = query.orderBy('createdAt', 'desc');

        if (input.cursor !== undefined) {
          // For cursor-based pagination, we'd start after the cursor
          // This is simplified - full implementation would decode the cursor
          const cursorDoc = await collection.doc(input.cursor).get();
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        // Fetch limit + 1 to determine if there are more results
        const limit = input.limit ?? 20;
        query = query.limit(limit + 1);

        const snapshot = await query.get();

        const docs = snapshot.docs;
        const hasMore = docs.length > limit;

        // Take only the requested number of results
        const resultDocs = hasMore ? docs.slice(0, limit) : docs;

        const tasks = resultDocs.map((doc: any) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        const output: ListTasksOutput = { tasks };

        // Only set nextCursor when there are actually more results
        if (hasMore && resultDocs.length > 0) {
          const lastDoc = resultDocs[resultDocs.length - 1];
          /* v8 ignore start -- ts-type: FakeFirestore always returns non-sparse arrays from queries @preserve */
          if (lastDoc !== undefined) {
            output.nextCursor = lastDoc.id;
          }
          /* v8 ignore stop @preserve */
        }

        return ok(output);
      } catch (error) {
        logger.error({ error, input }, 'Failed to list tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    hasActiveTaskForLinearIssue: async (
      linearIssueId: string
    ): Promise<Result<{ hasActive: boolean; taskId?: string }, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('linearIssueId', '==', linearIssueId)
          .where('status', 'in', ACTIVE_TASK_STATUSES)
          .get();

        for (const task of snapshot.docs) {
          const data = task.data();
          if (data['agentType'] === 'review') {
            continue;
          }

          return ok({
            hasActive: true,
            taskId: task.id,
          });
        }

        return ok({ hasActive: false });
      } catch (error) {
        logger.error({ error, linearIssueId }, 'Failed to check active task for Linear issue');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findZombieTasks: async (staleThreshold: Date): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        const snapshot = await collection
          // Note: 'queued' excluded — queued tasks don't heartbeat (no updatedAt changes),
          // so they'd be false positives. Queue TTL expiry in drainTaskQueue handles them.
          .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
          .where('updatedAt', '<', Timestamp.fromDate(staleThreshold))
          .get();

         
        const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
          toCodeTask(doc as { id: string; data(): Record<string, unknown> })
        );

        return ok(tasks);
      } catch (error) {
        logger.error({ error, staleThreshold }, 'Failed to find zombie tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    countByUserToday: async (userId: string): Promise<Result<number, RepositoryError>> => {
      try {
        // Calculate start of today in UTC
        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

        const snapshot = await collection
          .where('userId', '==', userId)
          .where('createdAt', '>=', Timestamp.fromDate(startOfDay))
          .get();

        return ok(snapshot.size);
      } catch (error) {
        logger.error({ error, userId }, 'Failed to count user tasks for today');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findArchivableTasks: async (
      cutoffDate: Date,
      limit: number
    ): Promise<Result<{ taskId: string }[], RepositoryError>> => {
      try {
        const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
        const snapshot = await collection
          .where('completedAt', '<', cutoffTimestamp)
          .where('logsArchived', '==', false)
          .limit(limit)
          .get();

        const tasks = snapshot.docs.map((doc: any) => ({ taskId: doc.id as string }));
        return ok(tasks);
      } catch (error) {
        logger.error({ error, cutoffDate }, 'Failed to find archivable tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    archiveTaskLogs: async (
      taskId: string,
      batchSize: number
    ): Promise<Result<{ logCount: number; archivedAt: Date }, RepositoryError>> => {
      try {
        const taskRef = collection.doc(taskId);
        const taskDoc = await taskRef.get();

        if (!taskDoc.exists) {
          return err({
            code: 'NOT_FOUND',
            message: `Task ${taskId} not found`,
          });
        }

        const logsRef = taskRef.collection('logs');
        const logsSnapshot = await logsRef.get();
        const logCount = logsSnapshot.docs.length;

        if (logCount > 0) {
          let batch = firestore.batch();
          let batchCount = 0;

          for (const logDoc of logsSnapshot.docs) {
            batch.delete(logDoc.ref);
            batchCount++;

            if (batchCount >= batchSize) {
              await batch.commit();
              batch = firestore.batch();
              batchCount = 0;
            }
          }

          if (batchCount > 0) {
            await batch.commit();
          }
        }

        const logLinesRef = taskRef.collection('log_lines');
        const logLinesSnapshot = await logLinesRef.get();

        if (logLinesSnapshot.docs.length > 0) {
          let linesBatch = firestore.batch();
          let linesBatchCount = 0;

          for (const lineDoc of logLinesSnapshot.docs) {
            linesBatch.delete(lineDoc.ref);
            linesBatchCount++;

            if (linesBatchCount >= batchSize) {
              await linesBatch.commit();
              linesBatch = firestore.batch();
              linesBatchCount = 0;
            }
          }

          if (linesBatchCount > 0) {
            await linesBatch.commit();
          }
        }

        const logEntriesRef = taskRef.collection('log_entries');
        const logEntriesSnapshot = await logEntriesRef.get();

        if (logEntriesSnapshot.docs.length > 0) {
          let entriesBatch = firestore.batch();
          let entriesBatchCount = 0;

          for (const entryDoc of logEntriesSnapshot.docs) {
            entriesBatch.delete(entryDoc.ref);
            entriesBatchCount++;

            if (entriesBatchCount >= batchSize) {
              await entriesBatch.commit();
              entriesBatch = firestore.batch();
              entriesBatchCount = 0;
            }
          }

          if (entriesBatchCount > 0) {
            await entriesBatch.commit();
          }
        }

        const turnMetricsRef = taskRef.collection('turn_metrics');
        const turnMetricsSnapshot = await turnMetricsRef.get();

        if (turnMetricsSnapshot.docs.length > 0) {
          let metricsBatch = firestore.batch();
          let metricsBatchCount = 0;

          for (const metricsDoc of turnMetricsSnapshot.docs) {
            metricsBatch.delete(metricsDoc.ref);
            metricsBatchCount++;

            if (metricsBatchCount >= batchSize) {
              await metricsBatch.commit();
              metricsBatch = firestore.batch();
              metricsBatchCount = 0;
            }
          }

          if (metricsBatchCount > 0) {
            await metricsBatch.commit();
          }
        }

        const totalLogCount = logCount + logLinesSnapshot.docs.length + logEntriesSnapshot.docs.length + turnMetricsSnapshot.docs.length;
        const archivedAt = new Date();
        await taskRef.update({
          logsArchived: true,
          logCount: totalLogCount,
          archivedAt: Timestamp.fromDate(archivedAt),
        });

        logger.info({ taskId, logCount: totalLogCount }, 'Task logs archived');
        return ok({ logCount: totalLogCount, archivedAt });
      } catch (error) {
        logger.error({ error, taskId }, 'Failed to archive task logs');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findRecentRemediationForPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .where('agentType', '==', 'remediation')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find recent remediation task for PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findPreservedPullRequestTask: async (
      repository: string,
      prNumber: number,
    ): Promise<Result<{ id: string; workerLocation: string; userId: string } | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .where('agentType', '==', 'pull_request')
          .where('status', '==', 'implemented')
          .orderBy('completedAt', 'desc')
          .limit(50)
          .get();

        for (const doc of snapshot.docs) {
          const data = doc.data();
          if (!isMergeConflictTaskData(data)) {
            return ok({
              id: doc.id,
              /* v8 ignore start -- upstream: FakeFirestore always returns complete documents, cannot simulate missing Firestore fields @preserve */
              workerLocation: String(data['workerLocation'] ?? ''),
              userId: String(data['userId'] ?? ''),
              /* v8 ignore stop @preserve */
            });
          }
        }

        return ok(null);
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find preserved pull_request task');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    deleteTask: async (taskId: string, userId: string): Promise<Result<void, RepositoryError>> => {
      try {
        const doc = await collection.doc(taskId).get();

        if (!doc.exists) {
          return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
        }

        const data = doc.data();
        if (data?.['userId'] !== userId) {
          return err({ code: 'NOT_FOUND', message: `Task ${taskId} not found` });
        }

        await collection.doc(taskId).delete();
        return ok(undefined);
      } catch (error) {
        logger.error({ error, taskId }, 'Failed to delete task');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listQueuedByAge: async (limit: number): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        // Order by createdAt (not queuedAt) because createdAt is always present and
        // queuedAt is optional — pre-migration tasks may lack it. Both are set nearly
        // simultaneously for new tasks, so createdAt is a reliable FIFO proxy.
        const snapshot = await collection
          .where('status', '==', 'queued')
          .orderBy('createdAt', 'asc')
          .limit(limit)
          .get();
        return ok(snapshot.docs.map((doc) => toCodeTask(doc as { id: string; data(): Record<string, unknown> })));
      } catch (error) {
        logger.error({ error }, 'Failed to list queued tasks by age');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    listQueued: async (): Promise<Result<CodeTask[], RepositoryError>> => {
      try {
        // Cap at 200 to avoid unbounded reads; queue should never grow this large
        const snapshot = await collection
          .where('status', '==', 'queued')
          .orderBy('createdAt', 'asc')
          .limit(200)
          .get();
        return ok(snapshot.docs.map((doc) => toCodeTask(doc as { id: string; data(): Record<string, unknown> })));
      } catch (error) {
        logger.error({ error }, 'Failed to list queued tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    countQueued: async (): Promise<Result<number, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('status', '==', 'queued')
          .get();
        return ok(snapshot.size);
      } catch (error) {
        logger.error({ error }, 'Failed to count queued tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    findPlannedTaskByLinearIssue: async (
      linearIssueId: string
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('linearIssueId', '==', linearIssueId)
          .where('status', '==', 'planned')
          .where('agentType', '==', 'planning')
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        const task = toCodeTask(doc as { id: string; data(): Record<string, unknown> });

        // Only return if implementation has not already been launched
        if (
          task.implementationTaskId !== undefined ||
          (task.fanOutChildTaskIds !== undefined && task.fanOutChildTaskIds.length > 0)
        ) {
          return ok(null);
        }

        return ok(task);
      } catch (error) {
        logger.error({ error, linearIssueId }, 'Failed to find planned task by Linear issue');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },

    runInTransaction: async <T>(
      operation: (transaction: FirebaseFirestore.Transaction) => Promise<Result<T, RepositoryError>>
    ): Promise<Result<T, RepositoryError>> => {
      try {
        return await firestore.runTransaction(async (transaction) => await operation(transaction));
      } catch (error) {
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
        // Excludes review, remediation, and merge-conflict follow-up tasks.
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const agentType = data['agentType'] as string | undefined;
          // Treat missing agentType as execution-eligible (backward compatibility)
          if (agentType !== 'review' && agentType !== 'remediation' && !isMergeConflictTaskData(data)) {
            return ok(toCodeTask(doc as { id: string; data(): Record<string, unknown> }));
          }
        }

        if (snapshot.docs.length === 50) {
          logger.warn(
            { repository, prNumber, docsScanned: 50 },
            'findLatestExecutionTaskByPR exhausted 50-doc window without finding a non-review task',
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
  };
};

function getErrorMessage(error: unknown): string {
  /* v8 ignore start -- ts-type: defensive type narrowing -- catch blocks always throw Error instances so non-Error branch is unreachable @preserve */
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
  /* v8 ignore stop @preserve */
}
