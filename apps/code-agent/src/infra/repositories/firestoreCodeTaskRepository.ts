/**
 * Firestore implementation of CodeTask repository with transaction-based deduplication.
 */

/* eslint-disable */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import type { Firestore } from '@google-cloud/firestore';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { createHash, randomUUID } from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  ListTasksOutput,
  RepositoryError,
} from '../../domain/repositories/codeTaskRepository.js';

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (design line 1544)

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

export const createFirestoreCodeTaskRepository = (deps: {
  firestore: Firestore;
  logger: Logger;
}): CodeTaskRepository => {
  const { firestore, logger } = deps;
  const collection = firestore.collection('code_tasks');

  return {
    create: async (input: CreateTaskInput): Promise<Result<CodeTask, RepositoryError>> => {
      const taskId = input.id ?? `task_${randomUUID()}`;
      const dedupKey = generateDedupKey(input.userId, input.prompt, input.linearIssueId);
      const now = new Date();
      const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_MS);

      try {
        // Use transaction for atomic deduplication (design lines 1558-1563)
         
        const result = await firestore.runTransaction(async (transaction: any) => {
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
              .limit(1);
            const dedupSnapshot = await transaction.get(dedupQuery);

            if (!dedupSnapshot.empty) {
              const existingTask = dedupSnapshot.docs[0]!;
              logger.info({
                dedupLayer: 2,
                dedupType: 'DUPLICATE_PROMPT',
                existingTaskId: existingTask.id,
                dedupKey,
              }, 'Dedup triggered: duplicate prompt within 5 minutes');
              return err({
                code: 'DUPLICATE_PROMPT',
                message: 'Duplicate prompt within 5 minutes',
                existingTaskId: existingTask.id,
              } as const);
            }
          }

          // Layer 3: Check active task for Linear issue (design lines 448-458)
          if (input.linearIssueId !== undefined) {
            const activeStatuses = ['queued', 'dispatched', 'running'] as const;
            const linearQuery = collection
              .where('linearIssueId', '==', input.linearIssueId)
              .where('status', 'in', activeStatuses)
              .limit(1);
            const linearSnapshot = await transaction.get(linearQuery);

            if (!linearSnapshot.empty) {
              const existingTask = linearSnapshot.docs[0]!;
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
            status: 'dispatched',
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
          /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
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
          /* v8 ignore stop @preserve */

          const docRef = collection.doc(taskId);
          transaction.set(docRef, taskData);

          return ok(taskData);
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
      input: UpdateTaskInput
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
        if (input.workerLocation !== undefined) {
          updateData['workerLocation'] = input.workerLocation;
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
        if (input.prNumber !== undefined) {
          updateData['prNumber'] = input.prNumber;
        }
        if (input.prBranch !== undefined) {
          updateData['prBranch'] = input.prBranch;
        }

        await docRef.update(updateData);

        // Fetch updated document
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
          /* v8 ignore start -- ts-type: array last element check @preserve */
          const lastDoc = resultDocs[resultDocs.length - 1];
          if (lastDoc !== undefined) {
          /* v8 ignore stop @preserve */
            output.nextCursor = lastDoc.id;
          }
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
        const activeStatuses = ['queued', 'dispatched', 'running'] as const;
        const snapshot = await collection
          .where('linearIssueId', '==', linearIssueId)
          .where('status', 'in', activeStatuses)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok({ hasActive: false });
        }

        const task = snapshot.docs[0]!;
        return ok({
          hasActive: true,
          taskId: task.id,
        });
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
          .where('status', 'in', ['running', 'dispatched'])
          .where('updatedAt', '<', Timestamp.fromDate(staleThreshold))
          .get();

         
        const tasks = snapshot.docs.map((doc: any) =>
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

          /* v8 ignore start -- test-infra: FakeFirestore batch commit not tracked by v8 coverage @preserve */
          if (batchCount > 0) {
            await batch.commit();
          }
          /* v8 ignore stop @preserve */
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

          /* v8 ignore start -- test-infra: FakeFirestore batch commit not tracked by v8 coverage @preserve */
          if (linesBatchCount > 0) {
            await linesBatch.commit();
          }
          /* v8 ignore stop @preserve */
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

          /* v8 ignore start -- test-infra: FakeFirestore batch commit not tracked by v8 coverage @preserve */
          if (entriesBatchCount > 0) {
            await entriesBatch.commit();
          }
          /* v8 ignore stop @preserve */
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

          /* v8 ignore start -- test-infra: FakeFirestore batch commit not tracked by v8 coverage @preserve */
          if (metricsBatchCount > 0) {
            await metricsBatch.commit();
          }
          /* v8 ignore stop @preserve */
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

    findOldestQueued: async (): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('status', '==', 'queued')
          .orderBy('createdAt', 'asc')
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        const data = doc.data();
        const task: CodeTask = {
          ...data,
          id: doc.id,
          createdAt: data['createdAt'],
          updatedAt: data['updatedAt'],
        } as CodeTask;

        return ok(task);
      } catch (error) {
        logger.error({ error }, 'Failed to find oldest queued task');
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

        // Only return if implementationTaskId is not already set
        if (task.implementationTaskId !== undefined) {
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

    findByPR: async (
      repository: string,
      prNumber: number
    ): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('prNumber', '==', prNumber)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        const data = doc.data();
        const task: CodeTask = {
          ...data,
          id: doc.id,
          createdAt: data['createdAt'],
          updatedAt: data['updatedAt'],
        } as CodeTask;

        return ok(task);
      } catch (error) {
        logger.error({ error, repository, prNumber }, 'Failed to find task by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },
  };
};

function getErrorMessage(error: unknown): string {
  /* v8 ignore start -- ts-type: instanceof check creates type narrowing branch @preserve */
  if (error instanceof Error) {
    return error.message;
  }
  /* v8 ignore stop @preserve */
  return String(error);
}
