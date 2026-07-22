import { fileURLToPath } from 'node:url';

import type { WhatsAppServiceClient } from '@intexuraos/internal-clients';
import { describe, expect, it, vi } from 'vitest';

import { loadCanonicalMatrixCorpus } from '../matrixCorpus/catalog.js';
import {
  activateMatrixCorpusRunWithReconciliation,
  buildMatrixCorpusTurnChecks,
  buildMatrixCorpusTechnicalFacts,
  PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS,
  PRODUCTION_MATRIX_CORPUS_LEASE_TTL_MS,
  PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS,
  runWithMatrixCorpusDeadline,
  sendMatrixMessageWithReconciliation,
} from '../matrixCorpus/liveExecution.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('production Matrix corpus technical facts', () => {
  it('gives slow DeepSeek replies more time without outliving a renewed production lease', () => {
    expect(PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS).toBe(3 * 60 * 1000);
    expect(PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS).toBe(4 * 60 * 1000);
    expect(PRODUCTION_MATRIX_CORPUS_LEASE_TTL_MS).toBe(5 * 60 * 1000);
    expect(PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS).toBeGreaterThan(
      PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS
    );
    expect(PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS).toBeLessThan(
      PRODUCTION_MATRIX_CORPUS_LEASE_TTL_MS
    );
  });

  it('keeps the default reply deadline alive past 180 seconds and aborts at 240 seconds', async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const pending = runWithMatrixCorpusDeadline(
        PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS,
        async (signal) => {
          observedSignal = signal;
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return signal.aborted;
        }
      );
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS);
      expect(observedSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(
        PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS - PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS
      );
      await expect(pending).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors an explicit short Matrix deadline override', async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const pending = runWithMatrixCorpusDeadline(5, async (signal) => {
        observedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return signal.aborted;
      });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(4);
      expect(observedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists closed expected/actual evidence for every deterministic assertion', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const scenario = catalog.scenarios[0]?.scenario;
    if (scenario === undefined) throw new Error('missing fixture scenario');
    const expectation = scenario.expected.turns[1];
    if (expectation === undefined) throw new Error('missing fixture expectation');

    const checks = buildMatrixCorpusTurnChecks({
      turnIndex: 1,
      expectation,
      actualReplyCount: 1,
      actualTransition: 'continued',
      actualLifecycle: 'completed',
      toolEvidence: [
        {
          event: 'selected',
          toolName: 'create_note',
          turnIndex: 1,
          ordinal: 1,
          facts: [{ name: 'contentLength', value: 21 }],
        },
        {
          event: 'mock_completed',
          toolName: 'create_note',
          turnIndex: 1,
          ordinal: 1,
          facts: [],
        },
      ],
      expectedTransition: 'continued',
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reply_count',
          status: 'passed',
          evidence: expect.objectContaining({ expectedCount: 1, actualCount: 1 }),
        }),
        expect.objectContaining({
          code: 'tool_name',
          status: 'passed',
          evidence: expect.objectContaining({
            expectedToolName: 'create_note',
            actualToolName: 'create_note',
          }),
        }),
        expect.objectContaining({
          code: 'tool_count',
          status: 'passed',
          evidence: expect.objectContaining({ expectedCount: 1, actualCount: 1 }),
        }),
        expect.objectContaining({
          code: 'tool_turn',
          status: 'passed',
          evidence: expect.objectContaining({ expectedTurnIndex: 1, actualTurnIndex: 1 }),
        }),
        expect.objectContaining({
          code: 'tool_fact',
          status: 'passed',
          evidence: expect.objectContaining({
            expectedFacts: [{ name: 'contentLength', operator: 'exists', value: null }],
            actualFacts: [{ name: 'contentLength', value: 21 }],
          }),
        }),
        expect.objectContaining({
          code: 'session_transition',
          evidence: expect.objectContaining({
            expectedTransition: 'continued',
            actualTransition: 'continued',
          }),
        }),
      ])
    );
  });

  it('never copies catalog expectations into fields not exposed by safe live evidence', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const scenario = catalog.scenarios[0]?.scenario;
    if (scenario === undefined) throw new Error('missing fixture scenario');

    const facts = buildMatrixCorpusTechnicalFacts(scenario, 0, true, 1, [], []);

    expect(facts.turnPassed).toBe(true);
    expect(facts.failureCodes).toEqual([]);
    expect(facts.transition).toMatchObject({
      expectedAction: 'started',
      outcome: 'not_observed',
    });
    expect(facts.transition).not.toHaveProperty('actualAction');
    expect(facts.session.outcome).toBe('not_observed');
    expect(facts.session).not.toHaveProperty('actualStatus');
    expect(facts.timeline.required.every((entry) => entry.outcome === 'not_observed')).toBe(true);
    expect(
      facts.timeline.payloadGroups.every(
        (entry) =>
          entry.outcome === 'not_observed' && entry.syntheticMarkerEvidence === 'not_observed'
      )
    ).toBe(true);
  });

  it('projects an observed extra reply as a closed deterministic failure', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const scenario = catalog.scenarios[0]?.scenario;
    if (scenario === undefined) throw new Error('missing fixture scenario');

    const facts = buildMatrixCorpusTechnicalFacts(scenario, 0, false, 2, [], []);

    expect(facts.turnPassed).toBe(false);
    expect(facts.failureCodes).toEqual(['assistant_reply_unexpected']);
  });
});

describe('Matrix corpus activation reconciliation', () => {
  const operation = {
    runId: 'run_1',
    leaseFence: '7',
    idempotencyKey: 'activate_key_1',
  } as const;

  it('accepts an exact active status after the activation response is lost', async () => {
    const activateMatrixCorpusRun = vi.fn(async () => activationFailure());
    const getMatrixCorpusTransportStatus = vi.fn(async () => transportStatus('active'));

    await expect(
      activateMatrixCorpusRunWithReconciliation({
        whatsapp: { activateMatrixCorpusRun, getMatrixCorpusTransportStatus },
        ...operation,
      })
    ).resolves.toBe(true);

    expect(activateMatrixCorpusRun).toHaveBeenCalledOnce();
    expect(getMatrixCorpusTransportStatus).toHaveBeenCalledWith({
      runId: operation.runId,
      leaseFence: operation.leaseFence,
    });
  });

  it('retries only a still-provisioning run with the same idempotency key and reconciles again', async () => {
    const activateMatrixCorpusRun = vi.fn(async () => activationFailure());
    const getMatrixCorpusTransportStatus = vi
      .fn()
      .mockResolvedValueOnce(transportStatus('provisioning'))
      .mockResolvedValueOnce(transportStatus('active'));

    await expect(
      activateMatrixCorpusRunWithReconciliation({
        whatsapp: { activateMatrixCorpusRun, getMatrixCorpusTransportStatus },
        ...operation,
      })
    ).resolves.toBe(true);

    expect(activateMatrixCorpusRun).toHaveBeenCalledTimes(2);
    expect(activateMatrixCorpusRun).toHaveBeenNthCalledWith(1, operation);
    expect(activateMatrixCorpusRun).toHaveBeenNthCalledWith(2, operation);
    expect(getMatrixCorpusTransportStatus).toHaveBeenCalledTimes(2);
  });

  it('fails closed without retry when the transport has left provisioning but is not active', async () => {
    const activateMatrixCorpusRun = vi.fn(async () => activationFailure());
    const getMatrixCorpusTransportStatus = vi.fn(async () => transportStatus('quiescing'));

    await expect(
      activateMatrixCorpusRunWithReconciliation({
        whatsapp: { activateMatrixCorpusRun, getMatrixCorpusTransportStatus },
        ...operation,
      })
    ).resolves.toBe(false);
    expect(activateMatrixCorpusRun).toHaveBeenCalledOnce();
  });
});

describe('Matrix outbound send reconciliation', () => {
  const request = {
    userId: 'user_1',
    text: 'private fixture',
    idempotencyKey: 'matrix_send_key_1',
  } as const;

  it('retries an ambiguous result once with the exact same idempotency key', async () => {
    const sendPrivateOutboundMatrixMessage = vi
      .fn<WhatsAppServiceClient['sendPrivateOutboundMatrixMessage']>()
      .mockResolvedValueOnce({ ok: false, error: new Error('timeout') })
      .mockResolvedValueOnce({
        ok: true,
        value: { status: 'sent', matrixEventId: '$event-1' },
      });

    await expect(
      sendMatrixMessageWithReconciliation({ sendPrivateOutboundMatrixMessage }, request)
    ).resolves.toEqual({ matrixEventId: '$event-1' });
    expect(sendPrivateOutboundMatrixMessage).toHaveBeenNthCalledWith(1, request);
    expect(sendPrivateOutboundMatrixMessage).toHaveBeenNthCalledWith(2, request);
  });

  it('fails closed after two ambiguous results', async () => {
    const sendPrivateOutboundMatrixMessage = vi
      .fn<WhatsAppServiceClient['sendPrivateOutboundMatrixMessage']>()
      .mockResolvedValue({ ok: false, error: new Error('timeout') });

    await expect(
      sendMatrixMessageWithReconciliation({ sendPrivateOutboundMatrixMessage }, request)
    ).resolves.toBeNull();
    expect(sendPrivateOutboundMatrixMessage).toHaveBeenCalledTimes(2);
  });
});

function activationFailure(): Awaited<
  ReturnType<WhatsAppServiceClient['activateMatrixCorpusRun']>
> {
  return { ok: false as const, error: { code: 'timeout' as const } };
}

function transportStatus(
  phase:
    | 'provisioning'
    | 'active'
    | 'quiescing'
    | 'release_pending'
    | 'abandon_pending'
    | 'released'
    | 'abandoned'
): Awaited<ReturnType<WhatsAppServiceClient['getMatrixCorpusTransportStatus']>> {
  return {
    ok: true as const,
    value: {
      code: 'TRANSPORT_STATUS' as const,
      runId: 'run_1',
      leaseFence: '7',
      phase,
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      nonterminalIngestOutboxCount: 0,
      drained: false,
    },
  };
}
