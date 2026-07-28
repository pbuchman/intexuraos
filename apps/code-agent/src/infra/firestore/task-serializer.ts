/**
 * Serialization helpers for CodeTask Firestore documents.
 *
 * Responsibilities:
 *  - Convert raw Firestore document snapshots into domain `CodeTask` objects,
 *    stripping legacy Linear fields.
 *  - Build task payloads for Firestore writes (create/update), applying the
 *    correct Timestamp conversions and omitting undefined fields.
 */

/* eslint-disable */

import { FieldValue, Timestamp } from '@google-cloud/firestore';
import type {
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from '@google-cloud/firestore';
import { withSchemaVersion, type SchemaVersionedFields } from '@intexuraos/infra-firestore';
import type {
  CodeTask,
  CodeTaskCallbackState,
  DispatchSchedule,
  ExecutionMemoryContext,
  ExecutionMemoryPostRun,
} from '../../domain/models/codeTask.js';
import {
  isArchivalTaskStatus,
  isCompletionTaskStatus,
  normalizeTaskLifecycleTimestamp,
  resolveMissingTaskCompletionTime,
  resolveTaskLifecycleTime,
} from '../../domain/models/taskLifecycleTime.js';
import { resolveCompletedTaskStatus } from '../../domain/utils/resolveCompletedTaskStatus.js';
import type {
  CreateTaskInput,
  CodeTaskCallbackStateCreateInput,
  DispatchScheduleCreateInput,
  ExecutionMemoryContextCreateInput,
  ExecutionMemoryPostRunCreateInput,
  UpdateTaskInput,
} from '../../domain/repositories/codeTaskRepository.js';
import type { DocLike } from './task-constants.js';

// Re-export shared DocLike for existing importers.
export type { DocLike };

/**
 * Drop legacy Linear-issue fields that were removed from the CodeTask model.
 * Older documents in Firestore may still carry these keys; strip them before
 * returning a task to callers.
 */
export function stripLegacyLinearFields(
  data: Record<string, unknown>
): Record<string, unknown> {
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

/**
 * Convert a Firestore document (or document-like object used by the fake)
 * into a domain CodeTask. Legacy Linear fields are stripped. Accepts
 * `QueryDocumentSnapshot` (data is always populated), `DocumentSnapshot`
 * (callers must guard with `.exists` — when present, data is populated),
 * or a test-only `DocLike`. `data()` returning undefined for a missing doc
 * is treated as empty to preserve a safe domain shape.
 */
export function fromFirestoreDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot | DocLike
): CodeTask {
  const raw = (doc.data() ?? {}) as Record<string, unknown>;
  const data = stripLegacyLinearFields(raw) as Record<string, unknown> & {
    createdAt?: Timestamp;
    statusChangedAt?: Timestamp;
    updatedAt?: Timestamp;
  };
  const statusChangedAt =
    raw['status'] !== undefined && raw['createdAt'] !== undefined
      ? resolveTaskLifecycleTime(raw as unknown as CodeTask).at
      : data.statusChangedAt;
  const status = data['status'] === 'completed'
    ? resolveCompletedTaskStatus(data['agentType'] as CodeTask['agentType'])
    : data['status'];
  return {
    ...data,
    id: doc.id,
    ...(status !== undefined && { status }),
    createdAt: data['createdAt'] as Timestamp,
    ...(statusChangedAt !== undefined && { statusChangedAt }),
    updatedAt: data['updatedAt'] as Timestamp,
  } as CodeTask;
}

/** Coerce a Date or Timestamp into a Firestore Timestamp; returns undefined otherwise. */
export function toTimestamp(value: unknown): Timestamp | undefined {
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

export function serializeExecutionMemoryContext(
  input: ExecutionMemoryContextCreateInput
): ExecutionMemoryContext {
  const { matchedAt: _matchedAt, ...rest } = input;
  const matchedAt = toTimestamp(input.matchedAt);

  return {
    ...rest,
    ...(matchedAt !== undefined && { matchedAt }),
  };
}

export function serializeExecutionMemoryPostRun(
  input: ExecutionMemoryPostRunCreateInput
): ExecutionMemoryPostRun {
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

/**
 * Serialize a DispatchSchedule write-input into the persisted shape (INT-1468).
 * Converts `Date → Timestamp`; existing `Timestamp` values pass through
 * unchanged. Optional fields are included conditionally so
 * `exactOptionalPropertyTypes` is honored.
 */
export function serializeDispatchSchedule(
  input: DispatchScheduleCreateInput
): DispatchSchedule {
  const notBeforeAt =
    input.notBeforeAt instanceof Timestamp
      ? input.notBeforeAt
      : Timestamp.fromDate(input.notBeforeAt);
  return {
    notBeforeAt,
    source: input.source,
    derivedBy: input.derivedBy,
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.localDateTime !== undefined && { localDateTime: input.localDateTime }),
    ...(input.sourceText !== undefined && { sourceText: input.sourceText }),
    ...(input.derivedFromTaskId !== undefined && {
      derivedFromTaskId: input.derivedFromTaskId,
    }),
  };
}

export function serializeCallbackState(
  input: CodeTaskCallbackStateCreateInput
): CodeTaskCallbackState {
  const configuredAt = toTimestamp(input.configuredAt) ?? Timestamp.fromDate(new Date());
  const lastSuccessAt = toTimestamp(input.lastSuccessAt);
  const lastFailureOccurredAt = toTimestamp(input.lastFailure?.occurredAt);

  return {
    webhookUrl: input.webhookUrl,
    callbackBaseUrl: input.callbackBaseUrl,
    owner: input.owner,
    configuredAt,
    ...(lastSuccessAt !== undefined && { lastSuccessAt }),
    ...(input.lastSuccessEndpoint !== undefined && {
      lastSuccessEndpoint: input.lastSuccessEndpoint,
    }),
    ...(input.lastFailure !== undefined && lastFailureOccurredAt !== undefined && {
      lastFailure: {
        endpoint: input.lastFailure.endpoint,
        ...(input.lastFailure.status !== undefined && { status: input.lastFailure.status }),
        message: input.lastFailure.message,
        occurredAt: lastFailureOccurredAt,
      },
    }),
  };
}

/**
 * Build the Firestore document for a new task.
 *
 * The dedupKey and taskId are computed by the caller (so dedup can run against
 * the same key before the document is written inside the transaction).
 */
export function toFirestoreDoc(
  input: CreateTaskInput,
  opts: { taskId: string; dedupKey: string; now: Date }
): CodeTask & SchemaVersionedFields {
  const taskTimestamp = Timestamp.fromDate(opts.now);
  const taskData: CodeTask = {
    id: opts.taskId,
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
    dedupKey: opts.dedupKey,
    callbackReceived: false,
    createdAt: taskTimestamp,
    statusChangedAt: taskTimestamp,
    updatedAt: taskTimestamp,
  };

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
    taskData.executionMemoryContext = serializeExecutionMemoryContext(
      input.executionMemoryContext
    );
  }
  if (input.executionMemoryPostRun !== undefined) {
    taskData.executionMemoryPostRun = serializeExecutionMemoryPostRun(
      input.executionMemoryPostRun
    );
  }
  if (input.failedWorkerLocation !== undefined) {
    taskData.failedWorkerLocation = input.failedWorkerLocation;
  }
  if (input.autoRetryAttempt !== undefined) {
    taskData.autoRetryAttempt = input.autoRetryAttempt;
  }
  if (input.dispatchSchedule !== undefined) {
    taskData.dispatchSchedule = serializeDispatchSchedule(input.dispatchSchedule);
  }
  if (input.timeoutHours !== undefined) {
    taskData.timeoutHours = input.timeoutHours;
  }
  if (input.sentryIssue !== undefined) {
    taskData.sentryIssue = input.sentryIssue;
  }

  return withSchemaVersion(taskData, 2, taskTimestamp);
}

/**
 * Build the Firestore update payload from an UpdateTaskInput.
 *
 * Uses FieldValue.delete() sentinels for fields that support null-to-delete
 * semantics. The returned payload is safe to pass to transaction.update() or
 * docRef.update(). Always sets `updatedAt` (uses the provided input.updatedAt
 * or a freshly-generated "now" Timestamp).
 */
export function buildUpdateData(
  existingTask: CodeTask,
  input: UpdateTaskInput,
  now: Date
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  const writeTimestamp = Timestamp.fromDate(now);
  const statusChanged = input.status !== undefined && input.status !== existingTask.status;
  const existingCompletedAt = normalizeTaskLifecycleTimestamp(existingTask.completedAt);

  // Allow explicit updatedAt for metadata/heartbeat writes (INT-372). Real
  // lifecycle transitions always advance the technical clock to this write.
  if (!statusChanged && input.updatedAt !== undefined) {
    updateData['updatedAt'] = Timestamp.fromDate(input.updatedAt);
  } else {
    updateData['updatedAt'] = writeTimestamp;
  }

  if (input.status !== undefined) {
    updateData['status'] = input.status;
  }
  if (input.result !== undefined) {
    updateData['result'] = input.result;
  }
  if (input.error !== undefined) {
    updateData['error'] = input.error === null ? FieldValue.delete() : input.error;
  }
  if (input.dispatchStatus !== undefined) {
    updateData['dispatchStatus'] =
      input.dispatchStatus === null ? FieldValue.delete() : input.dispatchStatus;
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
  if (input.callbackState !== undefined) {
    updateData['callbackState'] = serializeCallbackState(input.callbackState);
  }
  if (input.queuedAt !== undefined) {
    updateData['queuedAt'] = Timestamp.fromDate(input.queuedAt);
  }
  if (input.dispatchedAt !== undefined) {
    updateData['dispatchedAt'] = Timestamp.fromDate(input.dispatchedAt);
  }
  if (input.logChunksDropped !== undefined) {
    updateData['logChunksDropped'] = input.logChunksDropped;
  }
  if (input.lastHeartbeat !== undefined) {
    updateData['lastHeartbeat'] = Timestamp.fromDate(input.lastHeartbeat);
  }
  if (input.cancelNonce !== undefined) {
    updateData['cancelNonce'] =
      input.cancelNonce === null ? FieldValue.delete() : input.cancelNonce;
  }
  if (input.cancelNonceExpiresAt !== undefined) {
    updateData['cancelNonceExpiresAt'] =
      input.cancelNonceExpiresAt === null
        ? FieldValue.delete()
        : input.cancelNonceExpiresAt;
  }
  if (input.pendingUserMessages !== undefined) {
    updateData['pendingUserMessages'] = input.pendingUserMessages;
  }
  if (input.implementationTaskId !== undefined) {
    updateData['implementationTaskId'] =
      input.implementationTaskId === null
        ? FieldValue.delete()
        : input.implementationTaskId;
  }
  if (input.fanOutChildTaskIds !== undefined) {
    updateData['fanOutChildTaskIds'] =
      input.fanOutChildTaskIds === null
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
  if (input.prClosedAt !== undefined) {
    updateData['prClosedAt'] = Timestamp.fromDate(input.prClosedAt);
  }
  if (input.executionMemoryContext !== undefined) {
    updateData['executionMemoryContext'] = serializeExecutionMemoryContext(
      input.executionMemoryContext
    );
  }
  if (input.executionMemoryPostRun !== undefined) {
    updateData['executionMemoryPostRun'] = serializeExecutionMemoryPostRun(
      input.executionMemoryPostRun
    );
  }
  if (input.requiresReReview !== undefined) {
    updateData['requiresReReview'] = input.requiresReReview;
  }
  if (input.prUrlValidationFailed !== undefined) {
    updateData['prUrlValidationFailed'] = input.prUrlValidationFailed;
  }
  if (input.prUrlValidationErrors !== undefined) {
    updateData['prUrlValidationErrors'] = input.prUrlValidationErrors;
  }
  if (input.dispatchSchedule !== undefined) {
    updateData['dispatchSchedule'] = serializeDispatchSchedule(input.dispatchSchedule);
  }

  if (statusChanged && input.status !== undefined) {
    if (isCompletionTaskStatus(input.status)) {
      if (isArchivalTaskStatus(existingTask.status)) {
        updateData['statusChangedAt'] = writeTimestamp;
        if (existingCompletedAt === undefined) {
          updateData['completedAt'] = resolveMissingTaskCompletionTime(
            existingTask,
            input.completedAt !== undefined
              ? { explicitCompletedAt: input.completedAt }
              : {},
          ).at;
        }
      } else {
        const completedAt =
          input.completedAt !== undefined
            ? resolveMissingTaskCompletionTime(existingTask, {
              explicitCompletedAt: input.completedAt,
            }).at
            : writeTimestamp;
        updateData['statusChangedAt'] = completedAt;
        updateData['completedAt'] = completedAt;
      }
    } else if (isArchivalTaskStatus(input.status)) {
      updateData['statusChangedAt'] = writeTimestamp;
      if (existingCompletedAt === undefined) {
        updateData['completedAt'] = resolveMissingTaskCompletionTime(existingTask, {
          ...(input.completedAt !== undefined && {
            explicitCompletedAt: input.completedAt,
          }),
          activeFallbackAt: writeTimestamp,
        }).at;
      }
    } else {
      const explicitStatusTime =
        input.status === 'queued'
          ? input.queuedAt
          : input.status === 'dispatched'
            ? input.dispatchedAt
            : undefined;
      updateData['statusChangedAt'] =
        explicitStatusTime !== undefined
          ? Timestamp.fromDate(explicitStatusTime)
          : writeTimestamp;
      updateData['completedAt'] = FieldValue.delete();
    }
  } else if (isArchivalTaskStatus(existingTask.status) && existingCompletedAt === undefined) {
    updateData['completedAt'] = resolveMissingTaskCompletionTime(
      existingTask,
      input.completedAt !== undefined
        ? { explicitCompletedAt: input.completedAt }
        : {},
    ).at;
  } else if (
    isCompletionTaskStatus(existingTask.status)
    && existingCompletedAt === undefined
    && input.completedAt !== undefined
  ) {
    updateData['completedAt'] = resolveMissingTaskCompletionTime(existingTask, {
      explicitCompletedAt: input.completedAt,
    }).at;
  }

  return withSchemaVersion(updateData, 2, writeTimestamp);
}

/**
 * Merge an UpdateTaskInput payload into already-read document data for callers
 * that update inside an external transaction and cannot read-after-write.
 *
 * Strips FieldValue.delete() sentinels so the returned object has a clean shape.
 */
export function mergeUpdateForTransaction(
  existing: Record<string, unknown>,
  updateData: Record<string, unknown>
): Record<string, unknown> {
  const mergedData: Record<string, unknown> = { ...existing, ...updateData };
  for (const [key, value] of Object.entries(mergedData)) {
    if (value instanceof FieldValue) {
      delete mergedData[key];
    }
  }
  return mergedData;
}
