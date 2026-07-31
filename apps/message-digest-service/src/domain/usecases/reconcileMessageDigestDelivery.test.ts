import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type {
  MessageDigestOutboundDeliveryState,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { reconcileMessageDigestDelivery } from './reconcileMessageDigestDelivery.js';

const NOW = '2026-07-27T12:04:00.000Z';

describe('reconcileMessageDigestDelivery', () => {
  it('persists sent acceptance under the current erasure fence', async () => {
    const harness = createHarness({
      receipt: { status: 'sent', acceptedAt: '2026-07-27T12:03:00.000Z' },
    });

    await expect(reconcileMessageDigestDelivery(validInput(), harness.dependencies)).resolves.toEqual(
      {
        ok: true,
        disposition: 'sent',
        run: expect.objectContaining({ delivery: expect.objectContaining({ status: 'sent' }) }),
      }
    );
    expect(harness.getOutboundDeliveryState).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      idempotencyKey: 'message-digest:mdr_run_001',
    });
    expect(harness.recordRunDeliveryState).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      expectedErasureEpoch: 2,
      observedAt: NOW,
      delivery: { status: 'sent', acceptedAt: '2026-07-27T12:03:00.000Z' },
    });
  });

  it.each(['pending', 'missing'] as const)(
    'persists a later check for a fresh non-terminal %s receipt',
    async (status) => {
      const harness = createHarness({ receipt: { status } });

      await expect(
        reconcileMessageDigestDelivery(validInput(), harness.dependencies)
      ).resolves.toMatchObject({ ok: true, disposition: 'pending' });
      expect(harness.recordRunDeliveryState).not.toHaveBeenCalled();
      expect(harness.recordRunDeliveryObservation).toHaveBeenCalledWith({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        expectedErasureEpoch: 2,
        expectedReconciliationAttempts: 0,
        observedAt: NOW,
        nextCheckAt: '2026-07-27T12:05:00.000Z',
        observation: status,
      });
    }
  );

  it('terminalizes a receipt that remains missing beyond its first-missing deadline', async () => {
    const harness = createHarness({
      receipt: { status: 'missing' },
      reconciliationAttempts: 3,
      missingSince: '2026-07-27T06:03:59.000Z',
    });

    await expect(
      reconcileMessageDigestDelivery(validInput(), harness.dependencies)
    ).resolves.toMatchObject({ ok: true, disposition: 'failed' });
    expect(harness.recordRunDeliveryState).toHaveBeenCalledWith(
      expect.objectContaining({
        observedAt: NOW,
        delivery: {
          status: 'failed',
          failedAt: NOW,
          failureCode: 'DELIVERY_RECEIPT_MISSING',
        },
      })
    );
    expect(harness.recordRunDeliveryObservation).not.toHaveBeenCalled();
  });

  it('terminalizes a receipt that remains pending beyond its delivery deadline as ambiguous', async () => {
    const harness = createHarness({
      receipt: { status: 'pending' },
      completedAt: '2026-07-26T12:03:59.000Z',
    });

    await expect(
      reconcileMessageDigestDelivery(validInput(), harness.dependencies)
    ).resolves.toMatchObject({ ok: true, disposition: 'ambiguous' });
    expect(harness.recordRunDeliveryState).toHaveBeenCalledWith(
      expect.objectContaining({ observedAt: NOW, delivery: { status: 'ambiguous' } })
    );
    expect(harness.recordRunDeliveryObservation).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'ambiguous' as const }, 'ambiguous'],
    [
      {
        status: 'failed' as const,
        failedAt: '2026-07-27T12:03:00.000Z',
        failureCode: 'DELIVERY_DISABLED',
      },
      'failed',
    ],
  ] as const)('terminalizes %s without initiating another delivery', async (receipt, disposition) => {
    const harness = createHarness({ receipt });

    await expect(
      reconcileMessageDigestDelivery(validInput(), harness.dependencies)
    ).resolves.toMatchObject({ ok: true, disposition });
    expect(harness.recordRunDeliveryState).toHaveBeenCalledOnce();
  });

  it('returns an existing terminal state without another owner-service read', async () => {
    const harness = createHarness({ existingStatus: 'ambiguous' });

    await expect(
      reconcileMessageDigestDelivery(validInput(), harness.dependencies)
    ).resolves.toMatchObject({ ok: true, disposition: 'ambiguous' });
    expect(harness.getOutboundDeliveryState).not.toHaveBeenCalled();
    expect(harness.recordRunDeliveryState).not.toHaveBeenCalled();
  });

  it('fails safely on owner-service errors and defers after an erasure fence loss', async () => {
    const unavailable = createHarness({ receiptFailure: true });
    await expect(
      reconcileMessageDigestDelivery(validInput(), unavailable.dependencies)
    ).resolves.toEqual({ ok: false, code: 'DELIVERY_STATE_UNAVAILABLE' });
    expect(unavailable.recordRunDeliveryState).not.toHaveBeenCalled();
    expect(unavailable.recordRunDeliveryObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observation: 'unavailable',
        nextCheckAt: '2026-07-27T12:05:00.000Z',
      })
    );

    const erased = createHarness({
      receipt: { status: 'sent', acceptedAt: '2026-07-27T12:03:00.000Z' },
      storeFailure: 'RESERVATION_LOST',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), erased.dependencies)
    ).resolves.toEqual({ ok: true, disposition: 'deferred' });

    const unavailableAfterFenceLoss = createHarness({
      receiptFailure: true,
      observationStoreFailure: 'RESERVATION_LOST',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), unavailableAfterFenceLoss.dependencies)
    ).resolves.toEqual({ ok: true, disposition: 'deferred' });

    const unavailableAfterMissingRun = createHarness({
      receiptFailure: true,
      observationStoreFailure: 'NOT_FOUND',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), unavailableAfterMissingRun.dependencies)
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('maps non-terminal observation persistence failures without claiming progress', async () => {
    const missing = createHarness({
      receipt: { status: 'pending' },
      observationStoreFailure: 'NOT_FOUND',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), missing.dependencies)
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const contended = createHarness({
      receipt: { status: 'missing' },
      observationStoreFailure: 'DELIVERY_CONFLICT',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), contended.dependencies)
    ).resolves.toEqual({ ok: true, disposition: 'deferred' });
  });

  it('rejects malformed identity and time before reading state', async () => {
    const valid = validInput();
    for (const input of [
      { ...valid, userId: ' ' },
      { ...valid, userId: 'x'.repeat(257) },
      { ...valid, definitionId: 'invalid' },
      { ...valid, runId: 'invalid' },
    ]) {
      const harness = createHarness();
      await expect(
        reconcileMessageDigestDelivery(input, harness.dependencies)
      ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    }
    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(
      reconcileMessageDigestDelivery(valid, invalidNow.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });

    const defaultClock = createHarness();
    defaultClock.dependencies.now = undefined;
    await expect(
      reconcileMessageDigestDelivery({ ...valid, userId: ' ' }, defaultClock.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('uses the same not-found result if either owner-scoped record is missing', async () => {
    for (const missing of ['definition', 'run'] as const) {
      const harness = createHarness({ missing });
      await expect(
        reconcileMessageDigestDelivery(validInput(), harness.dependencies)
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }
  });

  it.each(['deleting', 'migrating'] as const)(
    'defers reconciliation while the definition is %s',
    async (definitionStatus) => {
      const harness = createHarness({ definitionStatus });
      await expect(
        reconcileMessageDigestDelivery(validInput(), harness.dependencies)
      ).resolves.toEqual({ ok: true, disposition: 'deferred' });
      expect(harness.getOutboundDeliveryState).not.toHaveBeenCalled();
    }
  );

  it('rejects non-completed runs and handles every already-persisted delivery state', async () => {
    const processing = createHarness({ generationStatus: 'processing' });
    await expect(
      reconcileMessageDigestDelivery(validInput(), processing.dependencies)
    ).resolves.toEqual({ ok: false, code: 'NOT_RECONCILABLE' });

    for (const existingStatus of ['sent', 'failed'] as const) {
      const terminal = createHarness({ existingStatus });
      await expect(
        reconcileMessageDigestDelivery(validInput(), terminal.dependencies)
      ).resolves.toMatchObject({ ok: true, disposition: existingStatus });
    }
    const unsent = createHarness({ existingStatus: 'not_sent' });
    await expect(
      reconcileMessageDigestDelivery(validInput(), unsent.dependencies)
    ).resolves.toMatchObject({ ok: true, disposition: 'pending' });
  });

  it('maps a missing run during terminal persistence to not found', async () => {
    const harness = createHarness({
      receipt: { status: 'sent', acceptedAt: '2026-07-27T12:03:00.000Z' },
      storeFailure: 'NOT_FOUND',
    });
    await expect(
      reconcileMessageDigestDelivery(validInput(), harness.dependencies)
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

interface HarnessOptions {
  receipt?: MessageDigestOutboundDeliveryState;
  receiptFailure?: boolean;
  existingStatus?: 'not_sent' | 'sent' | 'ambiguous' | 'failed';
  storeFailure?: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT';
  observationStoreFailure?: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT';
  missing?: 'definition' | 'run';
  definitionStatus?: 'deleting' | 'migrating';
  generationStatus?: MessageDigestRun['generationStatus'];
  reconciliationAttempts?: number;
  missingSince?: string | null;
  completedAt?: string;
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: Parameters<typeof reconcileMessageDigestDelivery>[1];
  getOutboundDeliveryState: ReturnType<
    typeof vi.fn<MessageDigestWhatsAppClient['getOutboundDeliveryState']>
  >;
  recordRunDeliveryState: ReturnType<typeof vi.fn<MessageDigestStore['recordRunDeliveryState']>>;
  recordRunDeliveryObservation: ReturnType<
    typeof vi.fn<MessageDigestStore['recordRunDeliveryObservation']>
  >;
} {
  const definition = activeDefinition();
  const run = completedRun(options.existingStatus ?? 'pending');
  if (options.definitionStatus !== undefined) definition.status = options.definitionStatus;
  if (options.generationStatus !== undefined) run.generationStatus = options.generationStatus;
  if (options.reconciliationAttempts !== undefined) {
    run.delivery.reconciliationAttempts = options.reconciliationAttempts;
  }
  if (options.missingSince !== undefined) run.delivery.missingSince = options.missingSince;
  if (options.completedAt !== undefined) run.completedAt = options.completedAt;
  const getOwnedDefinition = vi.fn<MessageDigestStore['getOwnedDefinition']>(async () =>
    options.missing === 'definition' ? null : definition
  );
  const getOwnedRun = vi.fn<MessageDigestStore['getOwnedRun']>(async () =>
    options.missing === 'run' ? null : run
  );
  const getOutboundDeliveryState = vi.fn<MessageDigestWhatsAppClient['getOutboundDeliveryState']>(
    async () =>
      options.receiptFailure === true
        ? { ok: false, code: 'unavailable' }
        : { ok: true, value: options.receipt ?? { status: 'pending' } }
  );
  const recordRunDeliveryState = vi.fn<MessageDigestStore['recordRunDeliveryState']>(async (input) =>
    options.storeFailure === undefined
      ? {
          ok: true,
          disposition: 'updated',
          run: {
            ...run,
            delivery: {
              ...run.delivery,
              status: input.delivery.status,
              acceptedAt:
                input.delivery.status === 'sent' || input.delivery.status === 'ambiguous'
                  ? (input.delivery.acceptedAt ?? null)
                  : null,
              failedAt: input.delivery.status === 'failed' ? input.delivery.failedAt : null,
              failureCode: input.delivery.status === 'failed' ? input.delivery.failureCode : null,
            },
          },
        }
      : { ok: false, code: options.storeFailure }
  );
  const recordRunDeliveryObservation = vi.fn<
    MessageDigestStore['recordRunDeliveryObservation']
  >(async (input) =>
    options.observationStoreFailure === undefined
      ? {
          ok: true,
          disposition: 'updated',
          run: {
            ...run,
            delivery: {
              ...run.delivery,
              reconciliationAttempts: input.expectedReconciliationAttempts + 1,
              nextCheckAt: input.nextCheckAt,
              missingSince:
                input.observation === 'missing'
                  ? (run.delivery.missingSince ?? input.observedAt)
                  : input.observation === 'pending'
                    ? null
                    : run.delivery.missingSince,
            },
            updatedAt: input.observedAt,
          },
        }
      : { ok: false, code: options.observationStoreFailure }
  );
  return {
    dependencies: {
      store: {
        getOwnedDefinition,
        getOwnedRun,
        recordRunDeliveryState,
        recordRunDeliveryObservation,
      },
      whatsappClient: { getOutboundDeliveryState },
      now: (): string => NOW,
    },
    getOutboundDeliveryState,
    recordRunDeliveryState,
    recordRunDeliveryObservation,
  };
}

function validInput(): { userId: string; definitionId: string; runId: string } {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
  };
}

function activeDefinition(): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic digest',
    nameSortKey: 'synthetic digest',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 2,
    activeErasureRequestId: null,
    hasRuns: true,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Synthetic chat',
      sourceRevision: 'synthetic-source-revision',
    },
    instructions: {
      templateId: 'custom',
      text: 'Create a bounded digest from this synthetic conversation source.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-v1',
      readinessObservedAt: '2026-07-27T12:00:00.000Z',
    },
    checkpointAt: '2026-07-27T12:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: '2026-07-27T12:02:00.000Z',
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T12:02:00.000Z',
  };
}

function completedRun(
  deliveryStatus: MessageDigestRun['delivery']['status']
): MessageDigestRun {
  const definition = activeDefinition();
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: definition.userId,
    definitionId: definition.definitionId,
    definitionNameSnapshot: definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: 1,
    instructionRevision: '1',
    trigger: 'manual',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    scheduledBoundary: '2026-07-27T12:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: definition.source,
    instructionsSnapshot: definition.instructions,
    scheduleSnapshot: definition.schedule,
    headline: 'Synthetic digest',
    summaryMarkdown: '- A bounded fact.',
    evidenceMessageRefs: ['c'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: deliveryStatus,
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: deliveryStatus === 'sent' ? '2026-07-27T12:03:00.000Z' : null,
      failedAt: deliveryStatus === 'failed' ? '2026-07-27T12:03:00.000Z' : null,
      failureCode: deliveryStatus === 'failed' ? 'DELIVERY_DISABLED' : null,
      reconciliationAttempts: 0,
      nextCheckAt:
        deliveryStatus === 'pending' ? '2026-07-27T12:02:00.000Z' : null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:01:00.000Z',
    updatedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:02:00.000Z',
  };
}
