import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type {
  MessageDigestOutboundDeliveryState,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';

export interface ReconcileMessageDigestDeliveryInput {
  userId: string;
  definitionId: string;
  runId: string;
}

export interface ReconcileMessageDigestDeliveryDependencies {
  store: Pick<
    MessageDigestStore,
    | 'getOwnedDefinition'
    | 'getOwnedRun'
    | 'recordRunDeliveryState'
    | 'recordRunDeliveryObservation'
  >;
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'getOutboundDeliveryState'>;
  now?: (() => string) | undefined;
}

const RECONCILIATION_BASE_DELAY_MS = 60_000;
const RECONCILIATION_MAX_DELAY_MS = 60 * 60 * 1_000;
const MISSING_RECEIPT_DEADLINE_MS = 6 * 60 * 60 * 1_000;
const PENDING_RECEIPT_DEADLINE_MS = 24 * 60 * 60 * 1_000;

export type ReconcileMessageDigestDeliveryResult =
  | {
      ok: true;
      disposition: 'pending' | 'sent' | 'ambiguous' | 'failed';
      run: MessageDigestRun;
    }
  | { ok: true; disposition: 'deferred' }
  | {
      ok: false;
      code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'NOT_RECONCILABLE' | 'DELIVERY_STATE_UNAVAILABLE';
    };

export async function reconcileMessageDigestDelivery(
  input: ReconcileMessageDigestDeliveryInput,
  dependencies: ReconcileMessageDigestDeliveryDependencies
): Promise<ReconcileMessageDigestDeliveryResult> {
  const normalized = normalizeInput(input);
  const observedAt = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (normalized === null || observedAt === null) return { ok: false, code: 'INVALID_REQUEST' };

  const [definition, run] = await Promise.all([
    dependencies.store.getOwnedDefinition(normalized.userId, normalized.definitionId),
    dependencies.store.getOwnedRun(normalized),
  ]);
  if (definition === null || run === null) return { ok: false, code: 'NOT_FOUND' };
  if (definition.status === 'deleting' || definition.status === 'migrating') {
    return { ok: true, disposition: 'deferred' };
  }
  if (run.generationStatus !== 'completed') {
    return { ok: false, code: 'NOT_RECONCILABLE' };
  }
  if (run.delivery.status !== 'pending') return projectTerminal(run);

  const receipt = await dependencies.whatsappClient.getOutboundDeliveryState({
    userId: normalized.userId,
    idempotencyKey: run.delivery.idempotencyKey,
  });
  if (!receipt.ok) {
    const observation = await persistNonTerminalObservation(
      normalized,
      definition.erasureEpoch,
      run,
      observedAt,
      'unavailable',
      dependencies
    );
    if (!observation.ok) return observation;
    if (observation.disposition === 'deferred') return observation;
    return { ok: false, code: 'DELIVERY_STATE_UNAVAILABLE' };
  }

  let terminalDelivery: Exclude<
    MessageDigestOutboundDeliveryState,
    { status: 'pending' | 'missing' }
  >;
  if (isTerminalReceipt(receipt.value)) {
    terminalDelivery = receipt.value;
  } else {
    const overdue = overdueDeliveryForObservation(run, receipt.value, observedAt);
    if (overdue === null) {
      return await persistNonTerminalObservation(
        normalized,
        definition.erasureEpoch,
        run,
        observedAt,
        receipt.value.status,
        dependencies
      );
    }
    terminalDelivery = overdue;
  }

  const recorded = await dependencies.store.recordRunDeliveryState({
    userId: normalized.userId,
    definitionId: normalized.definitionId,
    runId: normalized.runId,
    expectedErasureEpoch: definition.erasureEpoch,
    observedAt,
    delivery: terminalDelivery,
  });
  if (!recorded.ok) {
    if (recorded.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, disposition: 'deferred' };
  }
  return projectTerminal(recorded.run);
}

async function persistNonTerminalObservation(
  input: ReconcileMessageDigestDeliveryInput,
  expectedErasureEpoch: number,
  run: MessageDigestRun,
  observedAt: string,
  observation: 'pending' | 'missing' | 'unavailable',
  dependencies: ReconcileMessageDigestDeliveryDependencies
): Promise<ReconcileMessageDigestDeliveryResult> {
  const recorded = await dependencies.store.recordRunDeliveryObservation({
    userId: input.userId,
    definitionId: input.definitionId,
    runId: input.runId,
    expectedErasureEpoch,
    expectedReconciliationAttempts: run.delivery.reconciliationAttempts,
    observedAt,
    nextCheckAt: nextReconciliationCheckAt(
      observedAt,
      run.delivery.reconciliationAttempts
    ),
    observation,
  });
  if (!recorded.ok) {
    if (recorded.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, disposition: 'deferred' };
  }
  return { ok: true, disposition: 'pending', run: recorded.run };
}

function overdueDeliveryForObservation(
  run: MessageDigestRun,
  receipt: Extract<MessageDigestOutboundDeliveryState, { status: 'pending' | 'missing' }>,
  observedAt: string
): Exclude<MessageDigestOutboundDeliveryState, { status: 'pending' | 'missing' }> | null {
  if (
    receipt.status === 'missing' &&
    run.delivery.missingSince !== null &&
    deadlineReached(run.delivery.missingSince, observedAt, MISSING_RECEIPT_DEADLINE_MS)
  ) {
    return {
      status: 'failed',
      failedAt: observedAt,
      failureCode: 'DELIVERY_RECEIPT_MISSING',
    };
  }
  if (
    receipt.status === 'pending' &&
    run.completedAt !== null &&
    deadlineReached(run.completedAt, observedAt, PENDING_RECEIPT_DEADLINE_MS)
  ) {
    return { status: 'ambiguous' };
  }
  return null;
}

function deadlineReached(since: string, observedAt: string, deadlineMs: number): boolean {
  return Date.parse(observedAt) - Date.parse(since) >= deadlineMs;
}

function nextReconciliationCheckAt(observedAt: string, completedAttempts: number): string {
  const exponent = Math.min(completedAttempts, 6);
  const delayMs = Math.min(
    RECONCILIATION_BASE_DELAY_MS * 2 ** exponent,
    RECONCILIATION_MAX_DELAY_MS
  );
  return new Date(Date.parse(observedAt) + delayMs).toISOString();
}

function isTerminalReceipt(
  receipt: MessageDigestOutboundDeliveryState
): receipt is Exclude<MessageDigestOutboundDeliveryState, { status: 'pending' | 'missing' }> {
  return (
    receipt.status === 'sent' || receipt.status === 'ambiguous' || receipt.status === 'failed'
  );
}

function projectTerminal(run: MessageDigestRun): ReconcileMessageDigestDeliveryResult {
  if (
    run.delivery.status === 'sent' ||
    run.delivery.status === 'ambiguous' ||
    run.delivery.status === 'failed'
  ) {
    return { ok: true, disposition: run.delivery.status, run };
  }
  return { ok: true, disposition: 'pending', run };
}

function normalizeInput(
  input: ReconcileMessageDigestDeliveryInput
): ReconcileMessageDigestDeliveryInput | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const runId = input.runId.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    !/^md_[A-Za-z0-9_-]{3,120}$/u.test(definitionId) ||
    !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(runId)
  ) {
    return null;
  }
  return { userId, definitionId, runId };
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
