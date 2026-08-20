import { createHash } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from '@google-cloud/firestore';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
  RepositoryError,
} from '../repositories/codeTaskRepository.js';

const REVIEW_TASK_SLOT_COLLECTION = 'code_review_task_slots';
const REVIEW_TASK_EVENT_COLLECTION = 'code_review_events';
const REVIEW_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_QUEUE_SIZE = 50;

export type ReviewPromptPriority = 'ordinary' | 'linear_context' | 'review_comment';

export interface ReserveReviewTaskDeps {
  firestore: Firestore;
  codeTaskRepo: CodeTaskRepository;
}

export interface ReserveReviewTaskInput {
  repository: string;
  prNumber: number;
  eventId: string;
  promptPriority?: ReviewPromptPriority;
  maxQueueSize?: number;
  taskInput: CreateTaskInput;
}

export interface ReserveReviewTaskResult {
  task: CodeTask;
  created: boolean;
}

export type ReserveReviewTaskError = RepositoryError | {
  code: 'QUEUE_FULL';
  message: string;
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildReviewTaskId(eventId: string): string {
  return `task_review_${digest(eventId).slice(0, 32)}`;
}

export function buildReviewTaskSlotPath(
  repository: string,
  prNumber: number,
  userId: string,
): string {
  return `${REVIEW_TASK_SLOT_COLLECTION}/${digest(`${repository}#${String(prNumber)}#${userId}`)}`;
}

export function buildReviewTaskEventPath(slotPath: string, eventId: string): string {
  return `${slotPath}/${REVIEW_TASK_EVENT_COLLECTION}/${digest(eventId)}`;
}

function firestoreError(error: unknown): RepositoryError {
  return {
    code: 'FIRESTORE_ERROR',
    message: `Firestore error: ${getErrorMessage(error, 'unknown')}`,
  };
}

function invalidReservation(message: string): RepositoryError {
  return {
    code: 'FIRESTORE_ERROR',
    message: `Invalid review reservation: ${message}`,
  };
}

function isMatchingReview(
  task: CodeTask,
  input: Pick<ReserveReviewTaskInput, 'repository' | 'prNumber' | 'taskInput'>,
): boolean {
  return task.agentType === 'review'
    && task.repository === input.repository
    && task.prNumber === input.prNumber
    && task.userId === input.taskInput.userId;
}

function isMatchingQueuedReview(
  task: CodeTask,
  input: Pick<ReserveReviewTaskInput, 'repository' | 'prNumber' | 'taskInput'>,
): boolean {
  return task.status === 'queued' && isMatchingReview(task, input);
}

const PROMPT_PRIORITY_RANK: Record<ReviewPromptPriority, number> = {
  ordinary: 0,
  linear_context: 1,
  review_comment: 2,
};

function inferPromptPriority(prompt: string): ReviewPromptPriority {
  if (prompt.includes('Triggered by review request comment:')) return 'review_comment';
  if (prompt.includes('### Issue Requirements')) return 'linear_context';
  return 'ordinary';
}

function readPromptPriority(
  slotData: Record<string, unknown> | undefined,
  task: CodeTask,
): ReviewPromptPriority {
  const stored = slotData?.['promptPriority'];
  if (stored === 'ordinary' || stored === 'linear_context' || stored === 'review_comment') {
    return stored;
  }
  return inferPromptPriority(task.prompt);
}

function mergeReviewTypesIntoPrompt(prompt: string, reviewTypes: readonly string[]): string {
  const requestedTypes = `Review types requested: ${reviewTypes.join(', ')}`;
  return prompt.replace(/^Review types requested:.*$/m, requestedTypes);
}

function writeSlot(
  transaction: Transaction,
  slotRef: ReturnType<Firestore['doc']>,
  input: Pick<ReserveReviewTaskInput, 'repository' | 'prNumber' | 'eventId' | 'taskInput'>,
  taskId: string,
  promptPriority: ReviewPromptPriority,
): void {
  transaction.set(slotRef, {
    taskId,
    eventId: input.eventId,
    repository: input.repository,
    prNumber: input.prNumber,
    userId: input.taskInput.userId,
    promptPriority,
    updatedAt: Timestamp.now(),
  });
}

function writeEventMarker(
  transaction: Transaction,
  eventRef: ReturnType<Firestore['doc']>,
  input: Pick<ReserveReviewTaskInput, 'repository' | 'prNumber' | 'eventId' | 'taskInput'>,
  taskId: string,
): void {
  transaction.set(eventRef, {
    taskId,
    eventId: input.eventId,
    repository: input.repository,
    prNumber: input.prNumber,
    userId: input.taskInput.userId,
    createdAt: Timestamp.now(),
    expireAt: Timestamp.fromMillis(Date.now() + REVIEW_EVENT_RETENTION_MS),
  });
}

function refreshQueuedReview(
  transaction: Transaction,
  firestore: Firestore,
  task: CodeTask,
  taskInput: CreateTaskInput,
  currentPriority: ReviewPromptPriority,
  incomingPriority: ReviewPromptPriority,
): { task: CodeTask; promptPriority: ReviewPromptPriority } {
  const reviewTypes = [...new Set([
    ...(task.reviewTypes ?? []),
    ...(taskInput.reviewTypes ?? []),
  ])];
  const updatedAt = Timestamp.now();
  const replacePrompt = PROMPT_PRIORITY_RANK[incomingPriority] >= PROMPT_PRIORITY_RANK[currentPriority];
  const promptPriority = replacePrompt ? incomingPriority : currentPriority;
  const selectedPrompt = replacePrompt ? taskInput.prompt : task.prompt;
  const selectedSanitizedPrompt = replacePrompt ? taskInput.sanitizedPrompt : task.sanitizedPrompt;
  const selectedWorkerType = replacePrompt ? taskInput.workerType : task.workerType;
  const selectedLinearIssueId = replacePrompt ? taskInput.linearIssueId : task.linearIssueId;
  const dispatchSchedule = taskInput.dispatchSchedule === undefined
    ? undefined
    : {
      ...taskInput.dispatchSchedule,
      notBeforeAt: taskInput.dispatchSchedule.notBeforeAt instanceof Timestamp
        ? taskInput.dispatchSchedule.notBeforeAt
        : Timestamp.fromDate(taskInput.dispatchSchedule.notBeforeAt),
    };
  const updates = {
    prompt: mergeReviewTypesIntoPrompt(selectedPrompt, reviewTypes),
    sanitizedPrompt: mergeReviewTypesIntoPrompt(selectedSanitizedPrompt, reviewTypes),
    traceId: taskInput.traceId,
    workerType: selectedWorkerType,
    baseBranch: taskInput.baseBranch,
    reviewTypes,
    updatedAt,
    ...(taskInput.prBranch !== undefined && { prBranch: taskInput.prBranch }),
    ...(selectedLinearIssueId !== undefined && { linearIssueId: selectedLinearIssueId }),
    ...(taskInput.reviewCommitSha !== undefined && {
      reviewCommitSha: taskInput.reviewCommitSha,
    }),
    ...(dispatchSchedule !== undefined && {
      dispatchSchedule,
    }),
  };

  transaction.update(firestore.doc(`code_tasks/${task.id}`), updates);
  return { task: { ...task, ...updates }, promptPriority };
}

export async function reserveReviewTask(
  deps: ReserveReviewTaskDeps,
  input: ReserveReviewTaskInput,
): Promise<Result<ReserveReviewTaskResult, ReserveReviewTaskError>> {
  const { firestore, codeTaskRepo } = deps;
  const taskId = buildReviewTaskId(input.eventId);
  const slotPath = buildReviewTaskSlotPath(
    input.repository,
    input.prNumber,
    input.taskInput.userId,
  );
  const slotRef = firestore.doc(slotPath);
  const eventRef = firestore.doc(buildReviewTaskEventPath(slotPath, input.eventId));
  const incomingPriority = input.promptPriority ?? inferPromptPriority(input.taskInput.prompt);
  const maxQueueSize = input.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  try {
    return await firestore.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      if (eventSnapshot.exists) {
        const eventData = eventSnapshot.data() as Record<string, unknown> | undefined;
        const markerTaskId = eventData?.['taskId'];
        if (typeof markerTaskId !== 'string' || markerTaskId.length === 0) {
          return err(invalidReservation('event marker has no taskId'));
        }
        const markedTaskResult = await codeTaskRepo.findById(markerTaskId, { transaction });
        if (!markedTaskResult.ok) return err(markedTaskResult.error);
        if (!isMatchingReview(markedTaskResult.value, input)) {
          return err(invalidReservation('event marker points to a foreign task'));
        }
        if (isMatchingQueuedReview(markedTaskResult.value, input)) {
          const slotSnapshot = await transaction.get(slotRef);
          const slotData = slotSnapshot.exists
            ? slotSnapshot.data() as Record<string, unknown> | undefined
            : undefined;
          const refreshed = refreshQueuedReview(
            transaction,
            firestore,
            markedTaskResult.value,
            input.taskInput,
            readPromptPriority(slotData, markedTaskResult.value),
            incomingPriority,
          );
          writeSlot(
            transaction,
            slotRef,
            input,
            markedTaskResult.value.id,
            refreshed.promptPriority,
          );
          writeEventMarker(transaction, eventRef, input, markedTaskResult.value.id);
          return ok({ task: refreshed.task, created: false });
        }
        return ok({ task: markedTaskResult.value, created: false });
      }

      const eventTaskResult = await codeTaskRepo.findById(taskId, { transaction });
      if (eventTaskResult.ok) {
        if (!isMatchingReview(eventTaskResult.value, input)) {
          return err(invalidReservation('deterministic task id belongs to a foreign task'));
        }
        if (isMatchingQueuedReview(eventTaskResult.value, input)) {
          const slotSnapshot = await transaction.get(slotRef);
          const slotData = slotSnapshot.exists
            ? slotSnapshot.data() as Record<string, unknown> | undefined
            : undefined;
          const refreshed = refreshQueuedReview(
            transaction,
            firestore,
            eventTaskResult.value,
            input.taskInput,
            readPromptPriority(slotData, eventTaskResult.value),
            incomingPriority,
          );
          writeSlot(
            transaction,
            slotRef,
            input,
            eventTaskResult.value.id,
            refreshed.promptPriority,
          );
          writeEventMarker(transaction, eventRef, input, eventTaskResult.value.id);
          return ok({ task: refreshed.task, created: false });
        }
        writeEventMarker(transaction, eventRef, input, eventTaskResult.value.id);
        return ok({ task: eventTaskResult.value, created: false });
      }
      if (eventTaskResult.error.code !== 'NOT_FOUND') {
        return err(eventTaskResult.error);
      }

      const slotSnapshot = await transaction.get(slotRef);
      const slotData = slotSnapshot.exists
        ? slotSnapshot.data() as Record<string, unknown> | undefined
        : undefined;
      const slotTaskId = slotData?.['taskId'];
      if (typeof slotTaskId === 'string' && slotTaskId.length > 0) {
        const slotTaskResult = await codeTaskRepo.findById(slotTaskId, { transaction });
        if (slotTaskResult.ok) {
          if (isMatchingQueuedReview(slotTaskResult.value, input)) {
            const refreshed = refreshQueuedReview(
              transaction,
              firestore,
              slotTaskResult.value,
              input.taskInput,
              readPromptPriority(slotData, slotTaskResult.value),
              incomingPriority,
            );
            writeSlot(transaction, slotRef, input, slotTaskId, refreshed.promptPriority);
            writeEventMarker(transaction, eventRef, input, slotTaskId);
            return ok({ task: refreshed.task, created: false });
          }
        } else if (slotTaskResult.error.code !== 'NOT_FOUND') {
          return err(slotTaskResult.error);
        }
      }

      const legacyQueuedQuery = firestore.collection('code_tasks')
        .where('repository', '==', input.repository)
        .where('prNumber', '==', input.prNumber)
        .where('userId', '==', input.taskInput.userId)
        .where('agentType', '==', 'review')
        .where('status', '==', 'queued')
        .limit(maxQueueSize);
      const legacyQueuedSnapshot = await transaction.get(legacyQueuedQuery);
      const matchingLegacyTasks: CodeTask[] = [];
      for (const legacyDoc of legacyQueuedSnapshot.docs) {
        const legacyTaskResult = await codeTaskRepo.findById(legacyDoc.id, { transaction });
        if (legacyTaskResult.ok) {
          if (isMatchingQueuedReview(legacyTaskResult.value, input)) {
            matchingLegacyTasks.push(legacyTaskResult.value);
          }
        } else if (legacyTaskResult.error.code !== 'NOT_FOUND') {
          return err(legacyTaskResult.error);
        }
      }
      matchingLegacyTasks.sort(
        (left, right) => right.createdAt.toMillis() - left.createdAt.toMillis(),
      );
      const legacySurvivor = matchingLegacyTasks[0];
      if (legacySurvivor !== undefined) {
        const refreshed = refreshQueuedReview(
          transaction,
          firestore,
          legacySurvivor,
          input.taskInput,
          inferPromptPriority(legacySurvivor.prompt),
          incomingPriority,
        );
        writeSlot(
          transaction,
          slotRef,
          input,
          legacySurvivor.id,
          refreshed.promptPriority,
        );
        writeEventMarker(transaction, eventRef, input, legacySurvivor.id);
        return ok({ task: refreshed.task, created: false });
      }

      if (maxQueueSize <= 0) {
        return err({ code: 'QUEUE_FULL', message: 'Code task queue is full' });
      }
      const queuedSnapshot = await transaction.get(
        firestore.collection('code_tasks')
          .where('status', '==', 'queued')
          .limit(maxQueueSize),
      );
      if (queuedSnapshot.docs.length >= maxQueueSize) {
        return err({ code: 'QUEUE_FULL', message: 'Code task queue is full' });
      }

      const queuedAt = Timestamp.now();
      const createResult = await codeTaskRepo.create(
        {
          ...input.taskInput,
          id: taskId,
          initialStatus: 'queued',
          queuedAt,
        },
        { transaction, skipPromptDedup: true },
      );
      if (!createResult.ok) return createResult;

      writeSlot(transaction, slotRef, input, taskId, incomingPriority);
      writeEventMarker(transaction, eventRef, input, taskId);

      return ok({ task: createResult.value, created: true });
    });
  } catch (error) {
    return err(firestoreError(error));
  }
}
