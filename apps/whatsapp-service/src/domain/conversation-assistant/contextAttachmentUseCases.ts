import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Logger } from '@intexuraos/common-core';
import type {
  ContextAttachmentPreparationFence,
  ConversationAssistantContextAttachmentCreationDeps,
  ConversationAssistantContextAttachmentPreparationDeps,
  ConversationAssistantContextAttachmentRetryDeps,
} from './contextAttachmentPorts.js';
import type {
  ConversationAssistantContextAttachment,
  CreateConversationAssistantContextAttachmentInput,
  CreateConversationAssistantContextAttachmentResult,
  PrepareConversationAssistantContextAttachmentInput,
  PrepareConversationAssistantContextAttachmentResult,
  PublicConversationAssistantContextAttachment,
  PublicConversationAssistantContextAttachmentError,
  RetryConversationAssistantContextAttachmentPreparationInput,
  RetryConversationAssistantContextAttachmentPreparationResult,
} from './types.js';
import {
  recordConversationAssistantTelemetry,
  type ConversationAssistantTelemetryInput,
  type ConversationAssistantTelemetryOutcome,
} from './operationalTelemetry.js';

export const CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS = 400;
export const CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_PREPARATION_LEASE_MS =
  5 * 60 * 1000;

interface AttachmentPreparationTelemetryState {
  estimatedBytes?: number;
  includedCount?: number;
  omittedCount?: number;
  correctedCount?: number;
  redactedCount?: number;
  newlyAvailableCount?: number;
  lateIngestedCount?: number;
  estimatedTokens?: number;
  orphanCleanupCount?: number;
}

export async function createConversationAssistantContextAttachment(
  input: CreateConversationAssistantContextAttachmentInput,
  deps: ConversationAssistantContextAttachmentCreationDeps,
  logger: Logger
): Promise<CreateConversationAssistantContextAttachmentResult> {
  const startedAt = performance.now();
  try {
    const result = await createConversationAssistantContextAttachmentWithoutTelemetry(
      input,
      deps,
      logger
    );
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'attachment_preparation',
      outcome: creationTelemetryOutcome(result),
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'attachment_preparation',
      outcome: 'failed',
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}

async function createConversationAssistantContextAttachmentWithoutTelemetry(
  input: CreateConversationAssistantContextAttachmentInput,
  deps: ConversationAssistantContextAttachmentCreationDeps,
  logger: Logger
): Promise<CreateConversationAssistantContextAttachmentResult> {
  const normalized = normalizeCreateInput(input);
  if (normalized.kind === 'invalid') return normalized;

  const resolved = await deps.repository.resolveContextAttachmentSession({
    userId: normalized.userId,
    sessionId: normalized.sessionId,
  });
  if (resolved.status !== 'found') {
    return resolved.status === 'not_found'
      ? { kind: 'not_found' }
      : { kind: 'unsupported', reason: resolved.reason };
  }

  const attachmentId = deriveConversationAssistantContextAttachmentId({
    sessionId: normalized.sessionId,
    sessionGenerationId: resolved.sessionGenerationId,
    preparationRequestId: normalized.requestId,
  });
  const preparationRequestFingerprint =
    createConversationAssistantContextAttachmentRequestFingerprint({
      userId: normalized.userId,
      sessionId: normalized.sessionId,
      preparationRequestId: normalized.requestId,
      ...(normalized.replacesAttachmentId === undefined
        ? {}
        : { replacesAttachmentId: normalized.replacesAttachmentId }),
    });
  const captured = await deps.repository.captureContextAttachment({
    attachmentId,
    userId: normalized.userId,
    sessionId: normalized.sessionId,
    expectedSessionGenerationId: resolved.sessionGenerationId,
    preparationRequestId: normalized.requestId,
    preparationRequestFingerprint,
    ...(normalized.replacesAttachmentId === undefined
      ? {}
      : { replacesAttachmentId: normalized.replacesAttachmentId }),
  });
  logger.info({ outcome: captured.status }, 'Conversation Assistant context attachment capture');
  switch (captured.status) {
    case 'created':
    case 'replay': {
      const publication = await deps.preparationPublisher.publish({
        type: 'whatsapp.conversation-assistant.context-attachment.prepare',
        userId: captured.attachment.userId,
        sessionId: captured.attachment.sessionId,
        sessionGenerationId: captured.attachment.sessionGenerationId,
        attachmentId: captured.attachment.id,
        attempt: captured.attachment.preparationAttempt,
      });
      if (publication.ok) {
        return { kind: captured.status, attachment: captured.attachment };
      }
      const failed = await deps.repository.failQueuedContextAttachmentPreparation({
        userId: captured.attachment.userId,
        sessionId: captured.attachment.sessionId,
        attachmentId: captured.attachment.id,
        expectedSessionGenerationId: captured.attachment.sessionGenerationId,
        attempt: captured.attachment.preparationAttempt,
        error: publication.error,
      });
      logger.warn(
        { outcome: failed.status, errorCode: publication.error.code },
        'Conversation Assistant context attachment preparation publication'
      );
      return {
        kind: captured.status,
        attachment:
          failed.status === 'not_found' ? captured.attachment : failed.attachment,
      };
    }
    case 'conflict':
      return { kind: 'conflict', code: 'REQUEST_BODY_CONFLICT' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unsupported':
      return { kind: 'unsupported', reason: captured.reason };
    case 'stale':
      return { kind: 'stale' };
  }
}

export async function prepareConversationAssistantContextAttachment(
  input: PrepareConversationAssistantContextAttachmentInput,
  deps: ConversationAssistantContextAttachmentPreparationDeps,
  logger: Logger
): Promise<PrepareConversationAssistantContextAttachmentResult> {
  const startedAt = performance.now();
  const telemetryState: AttachmentPreparationTelemetryState = {};
  try {
    const result = await prepareConversationAssistantContextAttachmentWithoutTelemetry(
      input,
      deps,
      logger,
      telemetryState
    );
    await recordConversationAssistantTelemetry(
      deps.telemetry,
      preparationTelemetryInput(result, telemetryState, performance.now() - startedAt)
    );
    return result;
  } catch (error) {
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'attachment_preparation',
      outcome: 'failed',
      durationMs: performance.now() - startedAt,
      ...(telemetryState.estimatedBytes === undefined
        ? {}
        : { estimatedBytes: telemetryState.estimatedBytes }),
    });
    throw error;
  }
}

async function prepareConversationAssistantContextAttachmentWithoutTelemetry(
  input: PrepareConversationAssistantContextAttachmentInput,
  deps: ConversationAssistantContextAttachmentPreparationDeps,
  logger: Logger,
  telemetryState: AttachmentPreparationTelemetryState
): Promise<PrepareConversationAssistantContextAttachmentResult> {
  if (
    input.userId.trim() === '' ||
    input.sessionId.trim() === '' ||
    input.attachmentId.trim() === '' ||
    input.sessionGenerationId.trim() === '' ||
    input.claimId.trim() === '' ||
    !Number.isInteger(input.attempt) ||
    input.attempt < 1
  ) {
    return {
      kind: 'invalid',
      code: 'INVALID_REQUEST',
      message: 'Invalid context attachment preparation request',
    };
  }
  const now = deps.clock.now();
  const fence: ContextAttachmentPreparationFence = {
    userId: input.userId.trim(),
    sessionId: input.sessionId.trim(),
    attachmentId: input.attachmentId.trim(),
    expectedSessionGenerationId: input.sessionGenerationId.trim(),
    attempt: input.attempt,
    claimId: input.claimId.trim(),
  };
  const claim = await deps.repository.claimContextAttachmentPreparation({
    ...fence,
    now,
    leaseExpiresAt: new Date(
      Date.parse(now) + CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_PREPARATION_LEASE_MS
    ).toISOString(),
  });
  if (claim.status !== 'claimed') {
    logger.info(
      { outcome: claim.status },
      'Conversation Assistant context attachment preparation claim'
    );
    return { kind: claim.status };
  }

  const delta = await deps.deltaBuilder
    .buildExactCutoffDelta({ attachment: claim.attachment })
    .catch(() => null);
  if (delta === null) {
    logger.error(
      { outcome: 'failed', errorCode: 'ATTACHMENT_PREPARATION_FAILED' },
      'Conversation Assistant context attachment preparation'
    );
    return await failClaimedContextAttachmentPreparation({
      fence,
      error: {
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      },
      deps,
      logger,
    });
  }
  if (!delta.ok) {
    return await failClaimedContextAttachmentPreparation({
      fence,
      error: delta.error,
      deps,
      logger,
    });
  }
  telemetryState.estimatedBytes = Buffer.byteLength(JSON.stringify(delta.value), 'utf8');
  telemetryState.includedCount = delta.value.counts.included;
  telemetryState.omittedCount = delta.value.counts.omitted;
  telemetryState.correctedCount =
    delta.value.counts.completedTranscriptions +
    delta.value.counts.edited +
    delta.value.counts.reactionsChanged;
  telemetryState.redactedCount = delta.value.counts.redacted + delta.value.counts.deleted;
  telemetryState.newlyAvailableCount = delta.value.counts.newlyAvailable;
  telemetryState.lateIngestedCount = delta.value.counts.lateIngested;
  telemetryState.estimatedTokens = delta.value.estimatedInputTokens;
  const snapshotId = deriveConversationAssistantContextAttachmentSnapshotId({
    attachmentId: claim.attachment.id,
    sessionGenerationId: fence.expectedSessionGenerationId,
    attempt: input.attempt,
    claimId: fence.claimId,
  });
  const persisted = await deps.repository.persistContextAttachmentPreparedSnapshot({
    ...fence,
    snapshotId,
    prepared: delta.value,
    maxChunkCount: CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS,
    now: deps.clock.now(),
  });
  if (persisted.status === 'too_large') {
    return await failClaimedContextAttachmentPreparation({
      fence,
      error: {
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'This context attachment exceeds the 400 chunk limit',
      },
      deps,
      logger,
    });
  }
  if (persisted.status !== 'saved') {
    return { kind: persisted.status };
  }
  if (persisted.manifest.chunkCount > CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS) {
    await cleanupPreparedSnapshot(
      { fence, snapshotId, chunkIds: persisted.manifest.chunkIds },
      deps,
      telemetryState
    );
    return await failClaimedContextAttachmentPreparation({
      fence,
      error: {
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'This context attachment exceeds the 400 chunk limit',
      },
      deps,
      logger,
    });
  }
  if (persisted.manifest.chunkIds.length !== persisted.manifest.chunkCount) {
    await cleanupPreparedSnapshot(
      { fence, snapshotId, chunkIds: persisted.manifest.chunkIds },
      deps,
      telemetryState
    );
    return await failClaimedContextAttachmentPreparation({
      fence,
      error: {
        code: 'ATTACHMENT_SNAPSHOT_INCOMPLETE',
        message: 'The context attachment snapshot is incomplete',
      },
      deps,
      logger,
    });
  }
  const completed = await deps.repository.completeContextAttachmentPreparation({
    ...fence,
    snapshotId,
    manifest: persisted.manifest,
    prepared: delta.value,
    now: deps.clock.now(),
  });
  if (completed.status !== 'ready') {
    await cleanupPreparedSnapshot(
      { fence, snapshotId, chunkIds: persisted.manifest.chunkIds },
      deps,
      telemetryState
    );
    if (completed.status === 'missing_chunks') {
      return await failClaimedContextAttachmentPreparation({
        fence,
        error: {
          code: 'ATTACHMENT_SNAPSHOT_INCOMPLETE',
          message: 'The context attachment snapshot is incomplete',
        },
        deps,
        logger,
      });
    }
    return { kind: completed.status };
  }
  logger.info(
    { outcome: 'ready', included: completed.attachment.counts.included },
    'Conversation Assistant context attachment preparation'
  );
  return { kind: 'ready', attachment: completed.attachment };
}

function creationTelemetryOutcome(
  result: CreateConversationAssistantContextAttachmentResult
): ConversationAssistantTelemetryOutcome {
  switch (result.kind) {
    case 'created':
      return result.attachment.status === 'failed' ? 'failed' : 'created';
    case 'replay':
      return 'replay';
    case 'conflict':
      return 'conflict';
    case 'stale':
      return 'stale';
    case 'invalid':
    case 'not_found':
    case 'unsupported':
      return 'rejected';
  }
}

function preparationTelemetryInput(
  result: PrepareConversationAssistantContextAttachmentResult,
  state: AttachmentPreparationTelemetryState,
  durationMs: number
): ConversationAssistantTelemetryInput {
  const outcome = preparationTelemetryOutcome(result);
  return {
    operation: 'attachment_preparation',
    outcome,
    durationMs,
    ...(state.estimatedBytes === undefined ? {} : { estimatedBytes: state.estimatedBytes }),
    ...(result.kind === 'ready' ? { count: result.attachment.counts.included } : {}),
    ...(state.includedCount === undefined ? {} : { includedCount: state.includedCount }),
    ...(state.omittedCount === undefined ? {} : { omittedCount: state.omittedCount }),
    ...(state.correctedCount === undefined ? {} : { correctedCount: state.correctedCount }),
    ...(state.redactedCount === undefined ? {} : { redactedCount: state.redactedCount }),
    ...(state.newlyAvailableCount === undefined
      ? {}
      : { newlyAvailableCount: state.newlyAvailableCount }),
    ...(state.lateIngestedCount === undefined
      ? {}
      : { lateIngestedCount: state.lateIngestedCount }),
    ...(state.estimatedTokens === undefined ? {} : { estimatedTokens: state.estimatedTokens }),
    ...(state.orphanCleanupCount === undefined
      ? {}
      : { orphanCleanupCount: state.orphanCleanupCount }),
  };
}

async function cleanupPreparedSnapshot(
  input: {
    fence: ContextAttachmentPreparationFence;
    snapshotId: string;
    chunkIds: string[];
  },
  deps: ConversationAssistantContextAttachmentPreparationDeps,
  telemetryState: AttachmentPreparationTelemetryState
): Promise<void> {
  await deps.repository.deleteContextAttachmentPreparedSnapshot({
    ...input.fence,
    snapshotId: input.snapshotId,
    chunkIds: input.chunkIds,
  });
  telemetryState.orphanCleanupCount =
    (telemetryState.orphanCleanupCount ?? 0) + input.chunkIds.length;
}

function preparationTelemetryOutcome(
  result: PrepareConversationAssistantContextAttachmentResult
): ConversationAssistantTelemetryOutcome {
  switch (result.kind) {
    case 'ready':
      return result.attachment.counts.included === 0 ? 'zero' : 'ready';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'stale':
      return 'stale';
    case 'busy':
      return 'conflict';
    case 'invalid':
    case 'not_found':
      return 'rejected';
  }
}

export async function retryConversationAssistantContextAttachmentPreparation(
  input: RetryConversationAssistantContextAttachmentPreparationInput,
  deps: ConversationAssistantContextAttachmentRetryDeps,
  logger: Logger
): Promise<RetryConversationAssistantContextAttachmentPreparationResult> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const attachmentId = input.attachmentId.trim();
  const sessionGenerationId = input.sessionGenerationId.trim();
  if (
    userId === '' ||
    sessionId === '' ||
    attachmentId === '' ||
    sessionGenerationId === ''
  ) {
    return {
      kind: 'invalid',
      code: 'INVALID_REQUEST',
      message: 'Invalid context attachment retry request',
    };
  }

  const requeued = await deps.repository.requeueContextAttachmentPreparation({
    userId,
    sessionId,
    attachmentId,
    expectedSessionGenerationId: sessionGenerationId,
    updatedAt: deps.clock.now(),
  });
  logger.info(
    { outcome: requeued.status },
    'Conversation Assistant context attachment preparation retry'
  );
  return requeued.status === 'queued'
    ? { kind: 'queued', attachment: requeued.attachment }
    : { kind: requeued.status };
}

async function failClaimedContextAttachmentPreparation(input: {
  fence: ContextAttachmentPreparationFence;
  error: { code: string; message: string };
  deps: ConversationAssistantContextAttachmentPreparationDeps;
  logger: Logger;
}): Promise<PrepareConversationAssistantContextAttachmentResult> {
  const failed = await input.deps.repository.failContextAttachmentPreparation({
    ...input.fence,
    error: input.error,
    now: input.deps.clock.now(),
  });
  if (failed.status !== 'failed') {
    return { kind: failed.status };
  }
  input.logger.warn(
    { outcome: 'failed', errorCode: input.error.code },
    'Conversation Assistant context attachment preparation'
  );
  return { kind: 'failed', attachment: failed.attachment };
}

export function deriveConversationAssistantContextAttachmentId(input: {
  sessionId: string;
  sessionGenerationId: string;
  preparationRequestId: string;
}): string {
  const digest = sha256({
    version: 1,
    sessionId: input.sessionId,
    sessionGenerationId: input.sessionGenerationId,
    preparationRequestId: input.preparationRequestId,
  });
  return `whatsapp_conv_context_attachment_${digest.slice(0, 40)}`;
}

export function createConversationAssistantContextAttachmentRequestFingerprint(input: {
  userId: string;
  sessionId: string;
  preparationRequestId: string;
  replacesAttachmentId?: string;
}): string {
  return sha256({
    version: 1,
    userId: input.userId,
    sessionId: input.sessionId,
    preparationRequestId: input.preparationRequestId,
    replacesAttachmentId: input.replacesAttachmentId ?? null,
  });
}

export function deriveConversationAssistantContextAttachmentSnapshotId(input: {
  attachmentId: string;
  sessionGenerationId: string;
  attempt: number;
  claimId: string;
}): string {
  const digest = sha256({
    version: 1,
    attachmentId: input.attachmentId,
    sessionGenerationId: input.sessionGenerationId,
    attempt: input.attempt,
    claimId: input.claimId,
  });
  return `whatsapp_conv_context_snapshot_${digest.slice(0, 40)}`;
}

export function toPublicConversationAssistantContextAttachment(
  attachment: ConversationAssistantContextAttachment,
  input: {
    compatibility: 'current' | 'stale';
    newerAvailableCount: number;
    newerAvailableCorrectionCount: number;
  }
): PublicConversationAssistantContextAttachment {
  return {
    id: attachment.id,
    status: attachment.status === 'queued' ? 'preparing' : attachment.status,
    compatibility: input.compatibility,
    capturedAt: attachment.capturedAt,
    captureRange: { ...attachment.captureRange },
    ...(attachment.eventRange === undefined ? {} : { eventRange: { ...attachment.eventRange } }),
    counts: {
      included: attachment.counts.included,
      excluded: attachment.counts.omitted,
      completedTranscriptions: attachment.counts.completedTranscriptions,
      edited: attachment.counts.edited,
      // The production Matrix bridge exposes content removal only as
      // m.room.redaction. Fold the compatibility-only deleted bucket into the
      // one truthful public redaction semantic.
      redacted: attachment.counts.redacted + attachment.counts.deleted,
      reactionsChanged: attachment.counts.reactionsChanged,
      lateIngested: attachment.counts.lateIngested,
    },
    omitted: { ...attachment.omitted },
    requiresConfirmation: attachment.requiresConfirmation,
    ...(attachment.confirmationToken === undefined
      ? {}
      : { confirmationToken: attachment.confirmationToken }),
    ...(attachment.preparationError === undefined
      ? {}
      : { error: toPublicContextAttachmentError(attachment.preparationError.code) }),
    ...(attachment.expiresAt === undefined ? {} : { expiresAt: attachment.expiresAt }),
    newerAvailableCount: input.newerAvailableCount,
    newerAvailableCorrectionCount: input.newerAvailableCorrectionCount,
  };
}

function toPublicContextAttachmentError(
  internalCode: string
): PublicConversationAssistantContextAttachmentError {
  switch (internalCode) {
    case 'ATTACHMENT_TOO_LARGE':
      return {
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'This update is too large to include in one question.',
      };
    case 'SOURCE_UNAVAILABLE':
      return {
        code: 'PREPARATION_FAILED',
        message: 'The source conversation is unavailable',
      };
    default:
      return {
        code: 'PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      };
  }
}

function sha256(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeCreateInput(
  input: CreateConversationAssistantContextAttachmentInput
):
  | {
      kind: 'valid';
      userId: string;
      sessionId: string;
      requestId: string;
      replacesAttachmentId?: string;
    }
  | Extract<CreateConversationAssistantContextAttachmentResult, { kind: 'invalid' }> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const requestId = input.requestId.trim();
  const replacesAttachmentId = input.replacesAttachmentId?.trim();
  if (userId === '' || sessionId === '' || requestId === '') {
    return { kind: 'invalid', code: 'INVALID_REQUEST', message: 'Request id is required' };
  }
  if (replacesAttachmentId === '') {
    return {
      kind: 'invalid',
      code: 'INVALID_REQUEST',
      message: 'Replacement attachment id must not be empty',
    };
  }
  return {
    kind: 'valid',
    userId,
    sessionId,
    requestId,
    ...(replacesAttachmentId === undefined ? {} : { replacesAttachmentId }),
  };
}
