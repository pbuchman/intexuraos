import { createHash } from 'node:crypto';
import { getMessageDigestDeliveryOutboxId } from '../messageDigestIds.js';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { isRetryableMessageDigestGenerationFailure } from './messageDigestRetryPolicy.js';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETRYABLE_DELIVERY_FAILURES = new Set([
  'MAPPING_MISSING',
  'DISCONNECTED',
  'DELIVERY_DISABLED',
  'PROVIDER_REJECTED',
  'DELIVERY_AUTHORIZATION_UNAVAILABLE',
]);

export interface RetryMessageDigestRunInput {
  userId: string;
  definitionId: string;
  runId: string;
  requestId: string;
}

export interface RetryMessageDigestRunDependencies {
  store: Pick<
    MessageDigestStore,
    | 'getOwnedDefinition'
    | 'getOwnedRun'
    | 'getOwnedDispatch'
    | 'retryFailedGeneration'
    | 'retryFailedDelivery'
  >;
  whatsappClient: Pick<
    MessageDigestWhatsAppClient,
    'getDeliveryReadiness' | 'authorizeOutboundDeliveryRetry'
  >;
  dispatchOutbox(outboxId: string): Promise<unknown>;
  now?: (() => string) | undefined;
}

export type RetryMessageDigestRunResult =
  | {
      ok: true;
      disposition: 'retried' | 'existing';
      stage: 'generation' | 'delivery';
      run: MessageDigestRun;
    }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'NOT_FOUND'
        | 'NOT_RETRYABLE'
        | 'RUN_IN_PROGRESS'
        | 'RESERVATION_LOST'
        | 'RETRY_CONFLICT'
        | 'READINESS_UNAVAILABLE'
        | 'DELIVERY_NOT_READY'
        | 'DELIVERY_RETRY_UNAVAILABLE';
    };

export async function retryMessageDigestRun(
  input: RetryMessageDigestRunInput,
  dependencies: RetryMessageDigestRunDependencies
): Promise<RetryMessageDigestRunResult> {
  const normalized = normalizeInput(input);
  const retriedAt = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (normalized === null || retriedAt === null) return { ok: false, code: 'INVALID_REQUEST' };
  const [definition, run] = await Promise.all([
    dependencies.store.getOwnedDefinition(normalized.userId, normalized.definitionId),
    dependencies.store.getOwnedRun({
      userId: normalized.userId,
      definitionId: normalized.definitionId,
      runId: normalized.runId,
    }),
  ]);
  if (definition === null || run === null) return { ok: false, code: 'NOT_FOUND' };
  if (definition.status === 'deleting' || definition.status === 'migrating') {
    return { ok: false, code: 'RESERVATION_LOST' };
  }
  if (run.generationStatus === 'queued' || run.generationStatus === 'processing') {
    return { ok: false, code: 'RUN_IN_PROGRESS' };
  }
  const requestDigest = digest([
    'message-digest-run-retry-request-v1',
    normalized.userId,
    normalized.definitionId,
    normalized.runId,
    normalized.requestId,
  ]);
  if (run.generationStatus === 'failed') {
    return await retryGeneration(run, requestDigest, retriedAt, dependencies);
  }
  if (
    run.generationStatus === 'completed' &&
    run.delivery.status === 'failed' &&
    run.delivery.failureCode !== null &&
    RETRYABLE_DELIVERY_FAILURES.has(run.delivery.failureCode)
  ) {
    return await retryDelivery(run, requestDigest, retriedAt, dependencies);
  }
  return { ok: false, code: 'NOT_RETRYABLE' };
}

async function retryGeneration(
  run: MessageDigestRun,
  requestDigest: string,
  retriedAt: string,
  dependencies: RetryMessageDigestRunDependencies
): Promise<RetryMessageDigestRunResult> {
  if (
    run.safeFailureCode === null ||
    !isRetryableMessageDigestGenerationFailure(run.safeFailureCode)
  ) {
    return { ok: false, code: 'NOT_RETRYABLE' };
  }
  const payloadJson = JSON.stringify({
    type: 'message-digest.run',
    version: 1,
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    requestedAt: run.windowEnd,
  });
  const outbox = buildRetryOutbox({
    run,
    requestDigest,
    retriedAt,
    kind: 'run_request',
    payloadJson,
  });
  const transitioned = await dependencies.store.retryFailedGeneration({
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    retriedAt,
    outbox,
  });
  if (!transitioned.ok) return transitioned;
  await dependencies.dispatchOutbox(outbox.outboxId);
  return { ok: true, disposition: transitioned.disposition, stage: 'generation', run: transitioned.run };
}

async function retryDelivery(
  run: MessageDigestRun,
  requestDigest: string,
  retriedAt: string,
  dependencies: RetryMessageDigestRunDependencies
): Promise<RetryMessageDigestRunResult> {
  const readiness = await dependencies.whatsappClient.getDeliveryReadiness(run.userId);
  if (!readiness.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };
  if (readiness.value.status !== 'ready') return { ok: false, code: 'DELIVERY_NOT_READY' };
  const originalOutboxId = getMessageDigestDeliveryOutboxId(run.runId);
  const original = await dependencies.store.getOwnedDispatch({
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    outboxId: originalOutboxId,
  });
  if (original?.kind !== 'whatsapp_delivery') {
    return { ok: false, code: 'RESERVATION_LOST' };
  }
  const authorized = await dependencies.whatsappClient.authorizeOutboundDeliveryRetry({
    userId: run.userId,
    idempotencyKey: run.delivery.idempotencyKey,
    payloadDigest: original.payloadDigest,
  });
  if (!authorized.ok) return { ok: false, code: 'DELIVERY_RETRY_UNAVAILABLE' };
  const outbox = buildRetryOutbox({
    run,
    requestDigest,
    retriedAt,
    kind: 'whatsapp_delivery',
    payloadJson: original.payloadJson,
    payloadDigest: original.payloadDigest,
  });
  const transitioned = await dependencies.store.retryFailedDelivery({
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    retriedAt,
    originalOutboxId,
    outbox,
  });
  if (!transitioned.ok) return transitioned;
  await dependencies.dispatchOutbox(outbox.outboxId);
  return { ok: true, disposition: transitioned.disposition, stage: 'delivery', run: transitioned.run };
}

function buildRetryOutbox(input: {
  run: MessageDigestRun;
  requestDigest: string;
  retriedAt: string;
  kind: MessageDigestDispatchOutbox['kind'];
  payloadJson: string;
  payloadDigest?: string | undefined;
}): MessageDigestDispatchOutbox {
  return {
    version: 1,
    outboxId: `mdo_${digest([
      'message-digest-retry-outbox-v1',
      input.kind,
      input.run.runId,
      input.requestDigest,
    ]).slice(0, 48)}`,
    userId: input.run.userId,
    definitionId: input.run.definitionId,
    runId: input.run.runId,
    kind: input.kind,
    status: 'pending',
    payloadJson: input.payloadJson,
    payloadDigest:
      input.payloadDigest ?? createHash('sha256').update(input.payloadJson, 'utf8').digest('hex'),
    attempts: 0,
    nextAttemptAt: input.retriedAt,
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: input.retriedAt,
    updatedAt: input.retriedAt,
    expiresAt: Math.floor((Date.parse(input.retriedAt) + OUTBOX_RETENTION_MS) / 1000),
  };
}

function normalizeInput(input: RetryMessageDigestRunInput): RetryMessageDigestRunInput | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const runId = input.runId.trim();
  const requestId = input.requestId.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    !/^md_[A-Za-z0-9_-]{3,120}$/u.test(definitionId) ||
    !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(runId) ||
    requestId.length < 8 ||
    requestId.length > 256
  ) {
    return null;
  }
  return { userId, definitionId, runId, requestId };
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}
