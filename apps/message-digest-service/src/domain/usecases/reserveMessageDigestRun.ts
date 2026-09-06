import { createHash } from 'node:crypto';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type {
  MessageDigestDeliveryReadiness,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import type {
  MessageDigestRunPreparationClaims,
  MessageDigestRunPreparationTokens,
} from '../ports/runPreparationTokens.js';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReserveMessageDigestRunInput {
  userId: string;
  definitionId: string;
  requestId: string;
  preparationToken: string;
}

export interface ReserveMessageDigestRunDependencies {
  store: Pick<MessageDigestStore, 'getOwnedRun' | 'getOwnedRunContext' | 'reserveRun'>;
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'getDeliveryReadiness'>;
  preparationTokens: Pick<MessageDigestRunPreparationTokens, 'read'>;
  now?: (() => string) | undefined;
}

export type ReserveMessageDigestRunResult =
  | {
      ok: true;
      disposition: 'reserved' | 'existing';
      run: MessageDigestRun;
    }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'NOT_FOUND'
        | 'NOT_ACTIVE'
        | 'RUN_IN_PROGRESS'
        | 'RUN_PREPARATION_STALE'
        | 'READINESS_UNAVAILABLE'
        | 'DELIVERY_NOT_READY';
      readinessStatus?: Exclude<MessageDigestDeliveryReadiness['status'], 'ready'> | undefined;
    };

export async function reserveMessageDigestRun(
  input: ReserveMessageDigestRunInput,
  dependencies: ReserveMessageDigestRunDependencies
): Promise<ReserveMessageDigestRunResult> {
  const normalized = normalizeInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_REQUEST' };
  const runId = createRunId(normalized.userId, normalized.definitionId, normalized.requestId);
  const requestIdDigest = digest([
    'message-digest-manual-run-request-v1',
    normalized.userId,
    normalized.definitionId,
    normalized.requestId,
  ]);
  const existing = await dependencies.store.getOwnedRun({
    userId: normalized.userId,
    definitionId: normalized.definitionId,
    runId,
  });
  if (existing !== null) {
    return existing.trigger === 'manual' && existing.requestIdDigest === requestIdDigest
      ? { ok: true, disposition: 'existing', run: existing }
      : { ok: false, code: 'RUN_PREPARATION_STALE' };
  }
  const confirmedAt = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (confirmedAt === null) return { ok: false, code: 'INVALID_REQUEST' };
  const prepared = dependencies.preparationTokens.read({
    token: normalized.preparationToken,
    binding: { userId: normalized.userId, definitionId: normalized.definitionId },
  });
  if (!prepared.ok) return { ok: false, code: 'RUN_PREPARATION_STALE' };

  const context = await dependencies.store.getOwnedRunContext(
    normalized.userId,
    normalized.definitionId
  );
  if (context === null) return { ok: false, code: 'NOT_FOUND' };
  const replayingSameRun =
    context.state.pendingWindow?.runId === runId &&
    context.state.pendingWindow.requestIdDigest === requestIdDigest;
  if (context.definition.status !== 'active') return { ok: false, code: 'NOT_ACTIVE' };
  if (context.state.pendingWindow !== null && !replayingSameRun) {
    return { ok: false, code: 'RUN_IN_PROGRESS' };
  }
  if (!replayingSameRun && !matchesPreparedContext(context, prepared.value)) {
    return { ok: false, code: 'RUN_PREPARATION_STALE' };
  }

  let readinessObservation = {
    observationVersion: prepared.value.preparedReadinessObservationVersion,
    observedAt: context.definition.delivery.readinessObservedAt,
  };
  if (!replayingSameRun) {
    const readiness = await dependencies.whatsappClient.getDeliveryReadiness(normalized.userId);
    if (!readiness.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };
    if (readiness.value.status !== 'ready') {
      return {
        ok: false,
        code: 'DELIVERY_NOT_READY',
        readinessStatus: readiness.value.status,
      };
    }
    if (readiness.value.observationVersion !== prepared.value.preparedReadinessObservationVersion) {
      return { ok: false, code: 'RUN_PREPARATION_STALE' };
    }
    readinessObservation = {
      observationVersion: readiness.value.observationVersion,
      observedAt: readiness.value.observedAt,
    };
  }

  const run = buildRun({
    runId,
    requestIdDigest,
    confirmedAt,
    context,
    prepared: prepared.value,
  });
  const payloadJson = JSON.stringify({
    type: 'message-digest.run',
    version: 1,
    userId: normalized.userId,
    definitionId: normalized.definitionId,
    runId,
    requestedAt: prepared.value.windowEnd,
  });
  const outboxId = getMessageDigestRunRequestOutboxId(runId);
  const reserved = await dependencies.store.reserveRun({
    userId: normalized.userId,
    definitionId: normalized.definitionId,
    expectedDefinitionRevision: prepared.value.definitionRevision,
    expectedStateRevision: prepared.value.stateRevision,
    expectedErasureEpoch: prepared.value.erasureEpoch,
    expectedReadinessObservationVersion: prepared.value.persistedReadinessObservationVersion,
    readinessObservation,
    nextRunAt: prepared.value.nextRunAt,
    run,
    outbox: {
      version: 1,
      outboxId,
      userId: normalized.userId,
      definitionId: normalized.definitionId,
      runId,
      kind: 'run_request',
      status: 'pending',
      payloadJson,
      payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
      attempts: 0,
      nextAttemptAt: confirmedAt,
      claim: null,
      publishedAt: null,
      terminalCode: null,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
      expiresAt: Math.floor((Date.parse(confirmedAt) + OUTBOX_RETENTION_MS) / 1000),
    },
  });
  if (reserved.ok) return reserved;
  return { ok: false, code: mapStoreFailure(reserved.code) };
}

export function getMessageDigestRunRequestOutboxId(runId: string): string {
  return `mdo_${digest(['message-digest-run-request-outbox-v1', runId]).slice(0, 48)}`;
}

function buildRun(input: {
  runId: string;
  requestIdDigest: string;
  confirmedAt: string;
  context: NonNullable<Awaited<ReturnType<MessageDigestStore['getOwnedRunContext']>>>;
  prepared: MessageDigestRunPreparationClaims;
}): MessageDigestRun {
  return {
    version: 1,
    runId: input.runId,
    userId: input.context.definition.userId,
    definitionId: input.context.definition.definitionId,
    definitionNameSnapshot: input.context.definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: input.prepared.definitionRevision,
    instructionRevision: input.context.definition.instructions.revision,
    trigger: 'manual',
    requestIdDigest: input.requestIdDigest,
    windowStart: input.prepared.windowStart,
    windowEnd: input.prepared.windowEnd,
    scheduledBoundary: input.prepared.windowEnd,
    generationStatus: 'queued',
    processingStage: 'queued',
    lease: null,
    attempts: 0,
    sourceSnapshot: input.context.definition.source,
    instructionsSnapshot: input.context.definition.instructions,
    scheduleSnapshot: input.context.definition.schedule,
    headline: null,
    summaryMarkdown: null,
    evidenceMessageRefs: [],
    continuityMemoryMarkdown: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary',
      status: 'not_sent',
      idempotencyKey: `message-digest:${input.runId}`,
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: input.confirmedAt,
    updatedAt: input.confirmedAt,
    completedAt: null,
  };
}

function matchesPreparedContext(
  context: NonNullable<Awaited<ReturnType<MessageDigestStore['getOwnedRunContext']>>>,
  prepared: {
    definitionRevision: number;
    stateRevision: number;
    erasureEpoch: number;
    windowStart: string;
    persistedReadinessObservationVersion: string;
  }
): boolean {
  return (
    context.definition.revision === prepared.definitionRevision &&
    context.state.revision === prepared.stateRevision &&
    context.definition.erasureEpoch === prepared.erasureEpoch &&
    context.definition.checkpointAt === prepared.windowStart &&
    context.state.checkpointAt === prepared.windowStart &&
    context.definition.delivery.readinessObservationVersion ===
      prepared.persistedReadinessObservationVersion
  );
}

function mapStoreFailure(
  code:
    | 'NOT_FOUND'
    | 'NOT_ACTIVE'
    | 'REVISION_CONFLICT'
    | 'READINESS_CHANGED'
    | 'RUN_IN_PROGRESS'
    | 'RUN_CONFLICT'
): Exclude<ReserveMessageDigestRunResult, { ok: true }>['code'] {
  if (code === 'NOT_FOUND' || code === 'NOT_ACTIVE' || code === 'RUN_IN_PROGRESS') return code;
  return 'RUN_PREPARATION_STALE';
}

function normalizeInput(input: ReserveMessageDigestRunInput): ReserveMessageDigestRunInput | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const requestId = input.requestId.trim();
  const preparationToken = input.preparationToken.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    definitionId === '' ||
    definitionId.length > 256 ||
    requestId.length < 8 ||
    requestId.length > 256 ||
    preparationToken === '' ||
    preparationToken.length > 16_384
  ) {
    return null;
  }
  return { userId, definitionId, requestId, preparationToken };
}

function createRunId(userId: string, definitionId: string, requestId: string): string {
  return `mdr_${digest(['message-digest-manual-run-id-v1', userId, definitionId, requestId]).slice(
    0,
    48
  )}`;
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
