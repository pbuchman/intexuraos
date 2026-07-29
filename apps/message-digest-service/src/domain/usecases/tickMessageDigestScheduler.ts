import { createHash } from 'node:crypto';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { getNextMessageDigestBoundary } from '../schedules/messageDigestSchedule.js';
import { recoverMessageDigestWork } from './recoverMessageDigestWork.js';
import type {
  ReconcileMessageDigestDeliveryInput,
  ReconcileMessageDigestDeliveryResult,
} from './reconcileMessageDigestDelivery.js';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DUE_PAGES = 3;

export interface TickMessageDigestSchedulerInput {
  workerId: string;
  limit: number;
  cursor?: string | undefined;
}

export interface TickMessageDigestSchedulerDependencies {
  store: Pick<
    MessageDigestStore,
    | 'listReadyDispatches'
    | 'listPendingDeliveryRuns'
    | 'listDueDefinitions'
    | 'getOwnedRunContext'
    | 'updateDefinition'
    | 'reserveRun'
  >;
  whatsappClient: Pick<
    MessageDigestWhatsAppClient,
    'validateSource' | 'getDeliveryReadiness'
  >;
  dispatchOutbox(outboxId: string): Promise<unknown>;
  reconcileDelivery(
    input: ReconcileMessageDigestDeliveryInput
  ): Promise<ReconcileMessageDigestDeliveryResult>;
  now?: (() => string) | undefined;
}

export type TickMessageDigestSchedulerResult =
  | {
      ok: true;
      recoveredDispatches: number;
      reconciledDeliveries: number;
      reservedRuns: number;
      deferredDefinitions: number;
      nextCursor: string | null;
    }
  | { ok: false; code: 'INVALID_REQUEST' };

export async function tickMessageDigestScheduler(
  input: TickMessageDigestSchedulerInput,
  dependencies: TickMessageDigestSchedulerDependencies
): Promise<TickMessageDigestSchedulerResult> {
  const workerId = input.workerId.trim();
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (
    workerId === '' ||
    workerId.length > 256 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    now === null
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const recovery = await recoverMessageDigestWork(
    { now, limit: input.limit },
    {
      store: dependencies.store,
      dispatchOutbox: async (outboxId) => await dependencies.dispatchOutbox(outboxId),
      reconcileDelivery: async (reconcileInput) =>
        await dependencies.reconcileDelivery(reconcileInput),
    }
  );
  const successfulRecovery = recovery as Extract<typeof recovery, { ok: true }>;

  let reservedRuns = 0;
  let deferredDefinitions = 0;
  let cursor = input.cursor;
  let nextCursor: string | null = null;
  const seenDefinitions = new Set<string>();
  for (let pageNumber = 0; pageNumber < MAX_DUE_PAGES; pageNumber += 1) {
    const due = await dependencies.store.listDueDefinitions({
      now,
      limit: input.limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const candidate of due.items) {
      const candidateKey = `${candidate.userId}:${candidate.definitionId}`;
      if (seenDefinitions.has(candidateKey)) continue;
      seenDefinitions.add(candidateKey);
      const disposition = await reserveDueDefinition(candidate, now, dependencies);
      if (disposition === null) {
        deferredDefinitions += 1;
        continue;
      }
      reservedRuns += 1;
      await dependencies.dispatchOutbox(disposition.outboxId);
    }
    nextCursor = due.nextCursor;
    if (nextCursor === null) break;
    cursor = nextCursor;
  }

  return {
    ok: true,
    recoveredDispatches: successfulRecovery.recoveredDispatches,
    reconciledDeliveries: successfulRecovery.reconciledDeliveries,
    reservedRuns,
    deferredDefinitions,
    nextCursor,
  };
}

async function reserveDueDefinition(
  candidate: MessageDigestDefinition,
  now: string,
  dependencies: TickMessageDigestSchedulerDependencies
): Promise<{ outboxId: string } | null> {
  const context = await dependencies.store.getOwnedRunContext(
    candidate.userId,
    candidate.definitionId
  );
  if (
    context?.definition.status !== 'active' ||
    context.state.pendingWindow !== null ||
    context.definition.nextRunAt > now ||
    context.state.checkpointAt >= context.definition.nextRunAt
  ) {
    return null;
  }
  const nextBoundary = getNextMessageDigestBoundary(
    context.definition.schedule,
    context.definition.nextRunAt
  );
  if (!nextBoundary.ok) return null;
  const source = await dependencies.whatsappClient.validateSource({
    userId: candidate.userId,
    chatId: context.definition.source.chatId,
    expectedGenerationId: context.definition.source.generationId,
  });
  if (!source.ok) {
    if (source.code === 'not_found' || source.code === 'source_changed') {
      await moveDefinitionToAttention(
        context.definition,
        source.code === 'not_found' ? 'SOURCE_NOT_FOUND' : 'SOURCE_CHANGED',
        now,
        dependencies
      );
    }
    return null;
  }
  if (
    source.value.sourceAccountId !== context.definition.source.sourceAccountId ||
    source.value.generationId !== context.definition.source.generationId ||
    source.value.chatId !== context.definition.source.chatId ||
    source.value.chatType !== context.definition.source.chatType
  ) {
    await moveDefinitionToAttention(
      context.definition,
      'SOURCE_CHANGED',
      now,
      dependencies
    );
    return null;
  }
  const readiness = await dependencies.whatsappClient.getDeliveryReadiness(candidate.userId);
  if (!readiness.ok) return null;
  if (readiness.value.status !== 'ready') {
    await moveDefinitionToAttention(
      context.definition,
      'DELIVERY_SETUP_REQUIRED',
      now,
      dependencies
    );
    return null;
  }

  const run = buildScheduledRun(context.definition, context.state.checkpointAt, now);
  const outbox = buildRunRequestOutbox(run, now);
  const reservation = await dependencies.store.reserveRun({
    userId: context.definition.userId,
    definitionId: context.definition.definitionId,
    expectedDefinitionRevision: context.definition.revision,
    expectedStateRevision: context.state.revision,
    expectedErasureEpoch: context.definition.erasureEpoch,
    expectedReadinessObservationVersion:
      context.definition.delivery.readinessObservationVersion,
    readinessObservation: {
      observationVersion: readiness.value.observationVersion,
      observedAt: readiness.value.observedAt,
    },
    nextRunAt: nextBoundary.value,
    run,
    outbox,
  });
  return reservation.ok ? { outboxId: outbox.outboxId } : null;
}

async function moveDefinitionToAttention(
  definition: MessageDigestDefinition,
  attentionCode: 'SOURCE_NOT_FOUND' | 'SOURCE_CHANGED' | 'DELIVERY_SETUP_REQUIRED',
  updatedAt: string,
  dependencies: TickMessageDigestSchedulerDependencies
): Promise<void> {
  await dependencies.store.updateDefinition({
    userId: definition.userId,
    definitionId: definition.definitionId,
    expectedRevision: definition.revision,
    updatedAt,
    patch: {
      status: 'paused',
      listStatus: 'needs_attention',
      attentionCode,
    },
  });
}

function buildScheduledRun(
  definition: MessageDigestDefinition,
  windowStart: string,
  createdAt: string
): MessageDigestRun {
  const scheduledBoundary = definition.nextRunAt;
  const runId = `mdr_${digest([
    'message-digest-scheduled-run-id-v1',
    definition.userId,
    definition.definitionId,
    scheduledBoundary,
  ]).slice(0, 48)}`;
  return {
    version: 1,
    runId,
    userId: definition.userId,
    definitionId: definition.definitionId,
    definitionNameSnapshot: definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: definition.revision,
    instructionRevision: definition.instructions.revision,
    trigger: 'scheduled',
    requestIdDigest: digest([
      'message-digest-scheduled-run-request-v1',
      definition.userId,
      definition.definitionId,
      scheduledBoundary,
    ]),
    windowStart,
    windowEnd: scheduledBoundary,
    scheduledBoundary,
    generationStatus: 'queued',
    processingStage: 'queued',
    lease: null,
    attempts: 0,
    sourceSnapshot: definition.source,
    instructionsSnapshot: definition.instructions,
    scheduleSnapshot: definition.schedule,
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
      idempotencyKey: `message-digest:${runId}`,
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  };
}

function buildRunRequestOutbox(
  run: MessageDigestRun,
  createdAt: string
): MessageDigestDispatchOutbox {
  const payloadJson = JSON.stringify({
    type: 'message-digest.run',
    version: 1,
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    requestedAt: run.scheduledBoundary,
  });
  return {
    version: 1,
    outboxId: `mdo_${digest([
      'message-digest-run-request-outbox-v1',
      run.runId,
    ]).slice(0, 48)}`,
    userId: run.userId,
    definitionId: run.definitionId,
    runId: run.runId,
    kind: 'run_request',
    status: 'pending',
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 0,
    nextAttemptAt: createdAt,
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: Math.floor((Date.parse(createdAt) + OUTBOX_RETENTION_MS) / 1000),
  };
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
