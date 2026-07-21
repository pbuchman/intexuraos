import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppErasureRequest,
  PrivateWhatsAppErasureWorkItem,
} from '../models/PrivateWhatsAppErasure.js';
import type {
  PrivateWhatsAppErasurePublisher,
  PrivateWhatsAppErasureRepository,
} from '../ports/privateWhatsAppErasure.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import {
  recordConversationAssistantTelemetry,
  type ConversationAssistantOperationalTelemetry,
  type ConversationAssistantTelemetryOutcome,
} from '../../conversation-assistant/operationalTelemetry.js';

const ERASURE_BATCH_SIZE = 20;

export interface PrivateWhatsAppErasureDeps {
  repository: PrivateWhatsAppErasureRepository;
  publisher: PrivateWhatsAppErasurePublisher;
  mediaStorage: Pick<MediaStoragePort, 'deletePrivateMediaBatch'>;
  now(): string;
  telemetry?: ConversationAssistantOperationalTelemetry;
}

export type RequestPrivateWhatsAppErasureResult =
  | { status: 'accepted'; request: PrivateWhatsAppErasureRequest }
  | { status: 'not_found' }
  | { status: 'conflict' };

function toWorkItem(request: PrivateWhatsAppErasureRequest): PrivateWhatsAppErasureWorkItem {
  return {
    type: 'whatsapp.private-account.erasure',
    sourceAccountId: request.sourceAccountId,
    userId: request.userId,
    erasureRequestId: request.erasureRequestId,
    attempt: request.attempt,
  };
}

async function publishPending(
  deps: PrivateWhatsAppErasureDeps,
  request: PrivateWhatsAppErasureRequest
): Promise<Result<void, WhatsAppError>> {
  if (request.status === 'completed' || request.status === 'failed') return ok(undefined);
  return await deps.publisher.publishPrivateWhatsAppErasure(toWorkItem(request));
}

function deletedCount(request: PrivateWhatsAppErasureRequest | undefined): number {
  if (request === undefined) return 0;
  const keys = Object.keys(request.counts) as (keyof typeof request.counts)[];
  return keys.reduce((total, key) => total + request.counts[key], 0);
}

async function recordErasureTelemetry(
  deps: PrivateWhatsAppErasureDeps,
  outcome: ConversationAssistantTelemetryOutcome,
  startedAt: number,
  request?: PrivateWhatsAppErasureRequest
): Promise<void> {
  await recordConversationAssistantTelemetry(deps.telemetry, {
    operation: 'privacy_erasure',
    outcome,
    durationMs: performance.now() - startedAt,
    count: deletedCount(request),
  });
}

export async function requestPrivateWhatsAppErasure(
  input: { sourceAccountId: string; userId: string; erasureRequestId: string },
  deps: PrivateWhatsAppErasureDeps
): Promise<Result<RequestPrivateWhatsAppErasureResult, WhatsAppError>> {
  const startedAt = performance.now();
  const started = await deps.repository.start({ ...input, now: deps.now() });
  if (!started.ok) {
    await recordErasureTelemetry(deps, 'failed', startedAt);
    return started;
  }
  if (started.value.status === 'not_found' || started.value.status === 'conflict') {
    await recordErasureTelemetry(
      deps,
      started.value.status === 'conflict' ? 'conflict' : 'stale',
      startedAt
    );
    return ok({ status: started.value.status });
  }

  const published = await publishPending(deps, started.value.request);
  if (!published.ok) {
    await recordErasureTelemetry(deps, 'failed', startedAt, started.value.request);
    return err(published.error);
  }
  await recordErasureTelemetry(
    deps,
    started.value.status === 'created' ? 'created' : 'replay',
    startedAt,
    started.value.request
  );
  return ok({ status: 'accepted', request: started.value.request });
}

export async function processPrivateWhatsAppErasureBatch(
  event: PrivateWhatsAppErasureWorkItem,
  deps: PrivateWhatsAppErasureDeps
): Promise<
  Result<
    { status: 'advanced' | 'replayed' | 'completed' | 'failed' | 'stale' | 'not_found' },
    WhatsAppError
  >
> {
  const startedAt = performance.now();
  const advanced = await deps.repository.advanceOneBatch({
    sourceAccountId: event.sourceAccountId,
    userId: event.userId,
    erasureRequestId: event.erasureRequestId,
    expectedAttempt: event.attempt,
    batchSize: ERASURE_BATCH_SIZE,
    now: deps.now(),
  });
  if (!advanced.ok) {
    await recordErasureTelemetry(deps, 'failed', startedAt);
    return advanced;
  }
  let progress = advanced.value;
  if (progress.status === 'private_media') {
    const deleted = await deps.mediaStorage.deletePrivateMediaBatch({
      userId: event.userId,
      ...(progress.cursor === undefined ? {} : { cursor: progress.cursor }),
      limit: ERASURE_BATCH_SIZE,
    });
    if (!deleted.ok) {
      await recordErasureTelemetry(deps, 'failed', startedAt, progress.request);
      return deleted;
    }
    const committed = await deps.repository.commitPrivateMediaBatch({
      sourceAccountId: event.sourceAccountId,
      userId: event.userId,
      erasureRequestId: event.erasureRequestId,
      expectedAttempt: event.attempt,
      ...(progress.cursor === undefined ? {} : { expectedCursor: progress.cursor }),
      batch: deleted.value,
      now: deps.now(),
    });
    if (!committed.ok) {
      await recordErasureTelemetry(deps, 'failed', startedAt, progress.request);
      return committed;
    }
    progress = committed.value;
  }
  if (progress.status === 'not_found') {
    await recordErasureTelemetry(deps, 'stale', startedAt);
    return ok({ status: 'not_found' });
  }
  if (progress.status === 'stale') {
    const current = await deps.repository.get({
      sourceAccountId: event.sourceAccountId,
      erasureRequestId: event.erasureRequestId,
    });
    if (!current.ok) {
      await recordErasureTelemetry(deps, 'failed', startedAt);
      return err(current.error);
    }
    if (current.value?.userId !== event.userId) {
      await recordErasureTelemetry(deps, 'stale', startedAt);
      return ok({ status: 'stale' });
    }
    if (current.value.status === 'completed' || current.value.status === 'failed') {
      await recordErasureTelemetry(deps, 'stale', startedAt, current.value);
      return ok({ status: 'stale' });
    }
    const replayed = await publishPending(deps, current.value);
    if (!replayed.ok) {
      await recordErasureTelemetry(deps, 'failed', startedAt, current.value);
      return err(replayed.error);
    }
    await recordErasureTelemetry(deps, 'replay', startedAt, current.value);
    return ok({ status: 'replayed' });
  }
  if (progress.status === 'completed') {
    await recordErasureTelemetry(deps, 'completed', startedAt, progress.request);
    return ok({ status: 'completed' });
  }
  if (progress.status === 'failed') {
    await recordErasureTelemetry(deps, 'failed', startedAt, progress.request);
    return ok({ status: 'failed' });
  }

  const published = await publishPending(deps, progress.request);
  if (!published.ok) {
    await recordErasureTelemetry(deps, 'failed', startedAt, progress.request);
    return err(published.error);
  }
  await recordErasureTelemetry(deps, 'partial', startedAt, progress.request);
  return ok({ status: 'advanced' });
}
