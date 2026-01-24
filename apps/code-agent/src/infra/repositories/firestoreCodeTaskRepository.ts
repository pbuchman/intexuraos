/**
 * Firestore implementation of CodeTask repository with transaction-based deduplication.
 */

/* eslint-disable */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-restricted-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/dot-notation */

import type { Firestore } from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
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

function generateDedupKey(userId: string, prompt: string): string {
  // Normalize prompt: trim, collapse spaces, lowercase (design lines 1542-1547)
  const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  const hash = createHash('sha256').update(userId + normalized).digest('hex');
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
      const taskId = `task_${randomUUID()}`;
      const dedupKey = generateDedupKey(input.userId, input.prompt);
      const now = new Date();
      const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_MS);

      try {
        // Use transaction for atomic deduplication (design lines 1558-1563)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await firestore.runTransaction(async (transaction: any) => {
          // Layer 0: Check approvalEventId (design lines 1532-1536)
          if (input.approvalEventId !== undefined) {
            const approvalQuery = collection
              .where('approvalEventId', '==', input.approvalEventId)
              .limit(1);
            const approvalSnapshot = await transaction.get(approvalQuery);

            if (!approvalSnapshot.empty) {
              const existingTask = approvalSnapshot.docs[0]!;
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
              return err({
                code: 'DUPLICATE_ACTION',
                message: 'Duplicate action',
                existingTaskId: existingTask.id,
              } as const);
            }
          }

          // Layer 2: Check dedupKey within 5-minute window (design lines 1543-1554)
          const dedupQuery = collection
            .where('dedupKey', '==', dedupKey)
            .where('createdAt', '>', Timestamp.fromDate(dedupWindowStart))
            .limit(1);
          const dedupSnapshot = await transaction.get(dedupQuery);

          if (!dedupSnapshot.empty) {
            const existingTask = dedupSnapshot.docs[0]!;
            return err({
              code: 'DUPLICATE_PROMPT',
              message: 'Duplicate prompt within 5 minutes',
              existingTaskId: existingTask.id,
            } as const);
          }

          // Layer 3: Check active task for Linear issue (design lines 448-458)
          if (input.linearIssueId !== undefined) {
            const activeStatuses = ['dispatched', 'running'] as const;
            const linearQuery = collection
              .where('linearIssueId', '==', input.linearIssueId)
              .where('status', 'in', activeStatuses)
              .limit(1);
            const linearSnapshot = await transaction.get(linearQuery);

            if (!linearSnapshot.empty) {
              const existingTask = linearSnapshot.docs[0]!;
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
          if (input.linearIssueTitle !== undefined) {
            taskData.linearIssueTitle = input.linearIssueTitle;
          }
          if (input.linearFallback !== undefined) {
            taskData.linearFallback = input.linearFallback;
          }

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

        const data = doc.data()!;
        const task: CodeTask = {
          ...data,
          id: doc.id,
          createdAt: data['createdAt'],
          updatedAt: data['updatedAt'],
        } as CodeTask;

        return ok(task);
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

        const task: CodeTask = {
          ...data,
          id: doc.id,
          createdAt: data['createdAt'],
          updatedAt: data['updatedAt'],
        } as CodeTask;

        return ok(task);
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

        const updateData: Record<string, unknown> = {
          ['updatedAt']: Timestamp.fromDate(new Date()),
        };

        if (input.status !== undefined) {
          updateData['status'] = input.status;
        }
        if (input.result !== undefined) {
          updateData['result'] = input.result;
        }
        if (input.error !== undefined) {
          updateData['error'] = input.error;
        }
        if (input.statusSummary !== undefined) {
          updateData['statusSummary'] = input.statusSummary;
        }
        if (input.callbackReceived !== undefined) {
          updateData['callbackReceived'] = input.callbackReceived;
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

        await docRef.update(updateData);

        // Fetch updated document
        const updatedDoc = await docRef.get();
        const data = updatedDoc.data()!;
        const task: CodeTask = {
          ...data,
          id: updatedDoc.id,
          createdAt: data['createdAt'],
          updatedAt: data['updatedAt'],
        } as CodeTask;

        return ok(task);
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

        if (input.status !== undefined) {
          query = query.where('status', '==', input.status);
        }

        query = query.orderBy('createdAt', 'desc');

        if (input.limit !== undefined) {
          query = query.limit(input.limit);
        }

        if (input.cursor !== undefined) {
          // For cursor-based pagination, we'd start after the cursor
          // This is simplified - full implementation would decode the cursor
          const cursorDoc = await collection.doc(input.cursor).get();
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        const snapshot = await query.get();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = snapshot.docs.map((doc: any) => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            createdAt: data['createdAt'],
            updatedAt: data['updatedAt'],
          } as CodeTask;
        });

        const nextCursor =
          snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1]!.id : undefined;

        const output: ListTasksOutput = {
          tasks,
          ...(nextCursor !== undefined && { nextCursor }),
        };

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
        const activeStatuses = ['pending', 'dispatched', 'running'] as const;
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
          .where('status', 'in', ['running', 'dispatched'])
          .where('updatedAt', '<', Timestamp.fromDate(staleThreshold))
          .get();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = snapshot.docs.map((doc: any) => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            createdAt: data['createdAt'],
            updatedAt: data['updatedAt'],
          } as CodeTask;
        });

        return ok(tasks);
      } catch (error) {
        logger.error({ error, staleThreshold }, 'Failed to find zombie tasks');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },
  };
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
