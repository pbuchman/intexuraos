import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import {
  retryMessageDigestRun,
  type RetryMessageDigestRunDependencies,
} from './retryMessageDigestRun.js';

const NOW = '2026-07-27T12:30:00.000Z';

describe('retryMessageDigestRun', () => {
  it.each([
    'SOURCE_NOT_FOUND',
    'SOURCE_UNAVAILABLE',
    'SOURCE_CHANGED',
    'READINESS_UNAVAILABLE',
    'DELIVERY_NOT_READY',
    'READINESS_CHANGED',
    'LLM_UNAVAILABLE',
  ])('retries the same frozen generation run after retryable %s', async (safeFailureCode) => {
    const harness = createHarness({ run: failedRun(safeFailureCode) });

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      disposition: 'retried',
      stage: 'generation',
      run: {
        runId: 'mdr_run_001',
        windowStart: '2026-07-26T07:00:00.000Z',
        windowEnd: '2026-07-27T07:00:00.000Z',
        generationStatus: 'queued',
      },
    });
    const transition = harness.retryFailedGeneration.mock.calls[0]?.[0];
    expect(transition).toMatchObject({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      retriedAt: NOW,
      outbox: {
        kind: 'run_request',
        status: 'pending',
      },
    });
    expect(transition?.outbox.payloadJson).toBe(
      JSON.stringify({
        type: 'message-digest.run',
        version: 1,
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        requestedAt: '2026-07-27T07:00:00.000Z',
      })
    );
    expect(transition?.outbox.payloadDigest).toBe(
      createHash('sha256').update(transition.outbox.payloadJson, 'utf8').digest('hex')
    );
    expect(harness.dispatchOutbox).toHaveBeenCalledWith(transition?.outbox.outboxId);
    expect(harness.retryFailedDelivery).not.toHaveBeenCalled();
  });

  it('replays one stable client request without creating or reserving another run', async () => {
    const harness = createHarness({ generationDisposition: 'existing' });

    const first = await retryMessageDigestRun(input(), harness.dependencies);
    const second = await retryMessageDigestRun(input(), harness.dependencies);

    expect(first).toMatchObject({ ok: true, disposition: 'existing', stage: 'generation' });
    expect(second).toMatchObject({ ok: true, disposition: 'existing', stage: 'generation' });
    expect(harness.retryFailedGeneration.mock.calls[0]?.[0].outbox).toEqual(
      harness.retryFailedGeneration.mock.calls[1]?.[0].outbox
    );
    expect(harness.retryFailedGeneration.mock.calls[0]?.[0].outbox.runId).toBe('mdr_run_001');
  });

  it.each(['INVALID_REQUEST', 'SOURCE_TOO_LARGE', 'INVALID_AGGREGATE', 'DELIVERY_FORMAT_INVALID'])(
    'refuses non-retryable generation failure %s',
    async (safeFailureCode) => {
      const harness = createHarness({ run: failedRun(safeFailureCode) });

      await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'NOT_RETRYABLE',
      });
      expect(harness.retryFailedGeneration).not.toHaveBeenCalled();
      expect(harness.dispatchOutbox).not.toHaveBeenCalled();
    }
  );

  it('returns owner-safe not found and validates request identity before any write', async () => {
    const missing = createHarness({ run: null });
    await expect(retryMessageDigestRun(input(), missing.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    for (const invalid of [
      input({ userId: ' ' }),
      input({ definitionId: 'invalid' }),
      input({ runId: 'invalid' }),
      input({ requestId: 'short' }),
      input({ requestId: 'x'.repeat(257) }),
    ]) {
      const harness = createHarness();
      await expect(retryMessageDigestRun(invalid, harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.getOwnedRun).not.toHaveBeenCalled();
    }
  });

  it.each(['deleting', 'migrating'] as const)(
    'refuses retry while the definition is %s',
    async (status) => {
      const harness = createHarness();
      vi.mocked(harness.dependencies.store.getOwnedDefinition).mockResolvedValueOnce({
        ...definition(),
        status,
      });

      await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'RESERVATION_LOST',
      });
      expect(harness.retryFailedGeneration).not.toHaveBeenCalled();
    }
  );

  it('rejects an invalid retry clock before any owner read', async () => {
    const harness = createHarness();
    harness.dependencies.now = (): string => 'not-an-instant';

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(harness.getOwnedRun).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', 'RUN_IN_PROGRESS'],
    ['processing', 'RUN_IN_PROGRESS'],
    ['completed', 'NOT_RETRYABLE'],
    ['skipped_no_activity', 'NOT_RETRYABLE'],
  ] as const)('refuses a generation run in %s as %s', async (generationStatus, code) => {
    const harness = createHarness({
      run: failedRun('LLM_UNAVAILABLE', {
        generationStatus,
        processingStage:
          generationStatus === 'queued'
            ? 'queued'
            : generationStatus === 'processing'
              ? 'aggregating'
              : generationStatus,
        safeFailureCode: null,
      }),
    });

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code,
    });
  });

  it.each(['RESERVATION_LOST', 'RUN_IN_PROGRESS', 'RETRY_CONFLICT'] as const)(
    'forwards generation transition race %s without dispatch',
    async (code) => {
      const harness = createHarness();
      harness.retryFailedGeneration.mockResolvedValueOnce({ ok: false, code });

      await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code,
      });
      expect(harness.dispatchOutbox).not.toHaveBeenCalled();
    }
  );

  it('serializes simultaneous retry attempts so only one transition dispatches', async () => {
    const harness = createHarness();
    harness.retryFailedGeneration
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'retried',
        run: queuedRun(),
      })
      .mockResolvedValueOnce({ ok: false, code: 'RUN_IN_PROGRESS' });

    const results = await Promise.all([
      retryMessageDigestRun(input({ requestId: 'client-retry-0001' }), harness.dependencies),
      retryMessageDigestRun(input({ requestId: 'client-retry-0002' }), harness.dependencies),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: 'RUN_IN_PROGRESS' },
    ]);
    expect(harness.dispatchOutbox).toHaveBeenCalledOnce();
  });

  it.each([
    'MAPPING_MISSING',
    'DISCONNECTED',
    'DELIVERY_DISABLED',
    'PROVIDER_REJECTED',
    'DELIVERY_AUTHORIZATION_UNAVAILABLE',
  ])(
    'retries definitive pre-provider delivery failure %s with byte-identical payload',
    async (failureCode) => {
      const original = deliveryOutbox();
      const harness = createHarness({
        run: completedFailedDelivery(failureCode),
        deliveryOutbox: original,
      });

      await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toMatchObject({
        ok: true,
        disposition: 'retried',
        stage: 'delivery',
        run: { runId: 'mdr_run_001', generationStatus: 'completed' },
      });
      expect(harness.getDeliveryReadiness).toHaveBeenCalledWith('synthetic-user-001');
      expect(harness.authorizeOutboundDeliveryRetry).toHaveBeenCalledWith({
        userId: 'synthetic-user-001',
        idempotencyKey: 'message-digest:mdr_run_001',
        payloadDigest: original.payloadDigest,
      });
      const retry = harness.retryFailedDelivery.mock.calls[0]?.[0].outbox;
      expect(retry.payloadJson).toBe(original.payloadJson);
      expect(retry.payloadDigest).toBe(original.payloadDigest);
      expect(JSON.parse(retry.payloadJson)).toMatchObject({
        idempotencyKey: 'message-digest:mdr_run_001',
        timestamp: '2026-07-27T07:02:00.000Z',
      });
      expect(harness.dispatchOutbox).toHaveBeenCalledWith(retry.outboxId);
    }
  );

  it.each([
    ['sent', null],
    ['pending', null],
    ['ambiguous', null],
    ['failed', 'DELIVERY_RECEIPT_MISSING'],
    ['failed', 'DELIVERY_AUTHORIZATION_REVOKED'],
  ] as const)('does not offer a delivery retry for %s / %s', async (status, failureCode) => {
    const harness = createHarness({
      run: completedFailedDelivery(failureCode ?? 'MAPPING_MISSING', {
        delivery: {
          ...completedFailedDelivery('MAPPING_MISSING').delivery,
          status,
          failureCode,
        },
      }),
    });

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_RETRYABLE',
    });
    expect(harness.authorizeOutboundDeliveryRetry).not.toHaveBeenCalled();
    expect(harness.retryFailedDelivery).not.toHaveBeenCalled();
  });

  it.each(['mapping_missing', 'disconnected', 'delivery_disabled'] as const)(
    'requires restored delivery readiness before authorizing retry: %s',
    async (readinessStatus) => {
      const harness = createHarness({ run: completedFailedDelivery('MAPPING_MISSING') });
      harness.getDeliveryReadiness.mockResolvedValueOnce({
        ok: true,
        value: { readinessStatus, status: readinessStatus } as never,
      });

      await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'DELIVERY_NOT_READY',
      });
      expect(harness.authorizeOutboundDeliveryRetry).not.toHaveBeenCalled();
    }
  );

  it('fails delivery retry safely when readiness cannot be observed', async () => {
    const harness = createHarness({ run: completedFailedDelivery('MAPPING_MISSING') });
    harness.getDeliveryReadiness.mockResolvedValueOnce({
      ok: false,
      code: 'UNAVAILABLE',
    } as never);

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'READINESS_UNAVAILABLE',
    });
    expect(harness.authorizeOutboundDeliveryRetry).not.toHaveBeenCalled();
  });

  it('fails delivery retry safely when the original frozen outbox is missing', async () => {
    const harness = createHarness({
      run: completedFailedDelivery('MAPPING_MISSING'),
      deliveryOutbox: null,
    });

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RESERVATION_LOST',
    });
    expect(harness.authorizeOutboundDeliveryRetry).not.toHaveBeenCalled();
  });

  it('fails delivery retry safely when WhatsApp authorization is unavailable', async () => {
    const harness = createHarness({ run: completedFailedDelivery('MAPPING_MISSING') });
    harness.authorizeOutboundDeliveryRetry.mockResolvedValueOnce({
      ok: false,
      code: 'UNAVAILABLE',
    } as never);

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_RETRY_UNAVAILABLE',
    });
    expect(harness.retryFailedDelivery).not.toHaveBeenCalled();
  });

  it('forwards a delivery retry transition conflict without dispatch', async () => {
    const harness = createHarness({ run: completedFailedDelivery('MAPPING_MISSING') });
    harness.retryFailedDelivery.mockResolvedValueOnce({
      ok: false,
      code: 'RETRY_CONFLICT',
    });

    await expect(retryMessageDigestRun(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RETRY_CONFLICT',
    });
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
  });
});

interface HarnessOptions {
  run?: MessageDigestRun | null;
  deliveryOutbox?: MessageDigestDispatchOutbox | null;
  generationDisposition?: 'retried' | 'existing';
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: RetryMessageDigestRunDependencies;
  getOwnedRun: ReturnType<typeof vi.fn>;
  getDeliveryReadiness: ReturnType<typeof vi.fn>;
  authorizeOutboundDeliveryRetry: ReturnType<typeof vi.fn>;
  retryFailedGeneration: ReturnType<typeof vi.fn>;
  retryFailedDelivery: ReturnType<typeof vi.fn>;
  dispatchOutbox: ReturnType<typeof vi.fn>;
} {
  const currentRun = options.run === undefined ? failedRun('LLM_UNAVAILABLE') : options.run;
  const getOwnedDefinition = vi.fn(async () => definition());
  const getOwnedRun = vi.fn(async () => currentRun);
  const getOwnedDispatch = vi.fn(async () =>
    options.deliveryOutbox === undefined ? deliveryOutbox() : options.deliveryOutbox
  );
  const retryFailedGeneration = vi.fn(async () => ({
    ok: true as const,
    disposition: options.generationDisposition ?? ('retried' as const),
    run: queuedRun(),
  }));
  const retryFailedDelivery = vi.fn(async () => ({
    ok: true as const,
    disposition: 'retried' as const,
    run: {
      ...completedFailedDelivery('MAPPING_MISSING'),
      delivery: { ...completedFailedDelivery('MAPPING_MISSING').delivery, status: 'pending' as const },
    },
  }));
  const getDeliveryReadiness = vi.fn(async () => ({
    ok: true as const,
    value: {
      status: 'ready' as const,
      observationVersion: 'readiness-v2',
      observedAt: NOW,
    },
  }));
  const authorizeOutboundDeliveryRetry = vi.fn(async () => ({ ok: true as const }));
  const dispatchOutbox = vi.fn(async () => ({ ok: true }));
  return {
    dependencies: {
      store: {
        getOwnedDefinition,
        getOwnedRun,
        getOwnedDispatch,
        retryFailedGeneration,
        retryFailedDelivery,
      },
      whatsappClient: { getDeliveryReadiness, authorizeOutboundDeliveryRetry },
      dispatchOutbox,
      now: (): string => NOW,
    },
    getOwnedRun,
    getDeliveryReadiness,
    authorizeOutboundDeliveryRetry,
    retryFailedGeneration,
    retryFailedDelivery,
    dispatchOutbox,
  };
}

function input(
  overrides: Partial<{
    userId: string;
    definitionId: string;
    runId: string;
    requestId: string;
  }> = {}
): { userId: string; definitionId: string; runId: string; requestId: string } {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    requestId: 'client-retry-0001',
    ...overrides,
  };
}

function definition(): MessageDigestDefinition {
  const run = baseRun();
  return {
    version: 1,
    definitionId: run.definitionId,
    userId: run.userId,
    name: 'Synthetic digest',
    nameSortKey: 'synthetic digest',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 3,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: true,
    source: run.sourceSnapshot,
    instructions: run.instructionsSnapshot,
    schedule: run.scheduleSnapshot,
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-v1',
      readinessObservedAt: '2026-07-27T07:00:00.000Z',
    },
    checkpointAt: run.windowStart,
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'f'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-26T07:00:00.000Z',
    updatedAt: NOW,
  };
}

function baseRun(): MessageDigestRun {
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    definitionNameSnapshot: 'Synthetic daily',
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: 3,
    instructionRevision: '2',
    trigger: 'scheduled',
    requestIdDigest: 'a'.repeat(64),
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    scheduledBoundary: '2026-07-27T07:00:00.000Z',
    generationStatus: 'failed',
    processingStage: 'failed',
    lease: null,
    attempts: 1,
    sourceSnapshot: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Synthetic group',
      sourceRevision: 'synthetic-source-revision',
    },
    instructionsSnapshot: {
      templateId: 'custom',
      text: 'Summarize only the bounded synthetic facts from this exact frozen source window.',
      revision: '2',
    },
    scheduleSnapshot: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
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
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: 'LLM_UNAVAILABLE',
    createdAt: '2026-07-27T07:01:00.000Z',
    updatedAt: '2026-07-27T07:02:00.000Z',
    completedAt: null,
  };
}

function failedRun(
  safeFailureCode: string,
  overrides: Partial<MessageDigestRun> = {}
): MessageDigestRun {
  return { ...baseRun(), safeFailureCode, ...overrides };
}

function queuedRun(): MessageDigestRun {
  return {
    ...baseRun(),
    generationStatus: 'queued',
    processingStage: 'queued',
    safeFailureCode: null,
    updatedAt: NOW,
  };
}

function completedFailedDelivery(
  failureCode: string,
  overrides: Partial<MessageDigestRun> = {}
): MessageDigestRun {
  const run: MessageDigestRun = {
    ...baseRun(),
    generationStatus: 'completed',
    processingStage: 'completed',
    headline: 'Synthetic digest',
    summaryMarkdown: '- One bounded fact.',
    evidenceMessageRefs: ['b'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      ...baseRun().delivery,
      status: 'failed',
      failedAt: '2026-07-27T07:03:00.000Z',
      failureCode,
    },
    safeFailureCode: null,
    completedAt: '2026-07-27T07:02:00.000Z',
  };
  return { ...run, ...overrides };
}

function deliveryOutbox(): MessageDigestDispatchOutbox {
  const payloadJson = JSON.stringify({
    type: 'whatsapp.message.send',
    version: 1,
    userId: 'synthetic-user-001',
    idempotencyKey: 'message-digest:mdr_run_001',
    timestamp: '2026-07-27T07:02:00.000Z',
    message: { text: 'Synthetic digest' },
  });
  return {
    version: 1,
    outboxId: 'mdo_delivery_original_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    kind: 'whatsapp_delivery',
    status: 'published',
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 1,
    nextAttemptAt: '2026-07-27T07:02:00.000Z',
    claim: null,
    publishedAt: '2026-07-27T07:02:01.000Z',
    terminalCode: null,
    createdAt: '2026-07-27T07:02:00.000Z',
    updatedAt: '2026-07-27T07:02:01.000Z',
    expiresAt: 1_777_000_000,
  };
}
