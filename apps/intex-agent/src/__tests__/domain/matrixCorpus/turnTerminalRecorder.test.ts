import { describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusTurnTerminalRecorder } from '../../../domain/matrixCorpus/turnTerminalRecorder.js';
import type { MatrixCorpusSessionRepository } from '../../../domain/ports/sessionRepository.js';
import type { IntexAgentSessionEvent } from '../../../domain/sessions/types.js';
import type { MatrixCorpusIngestReceipt } from '../../../domain/matrixCorpus/ports/ingestReceiptRepository.js';

const now = '2026-07-20T10:00:00.000Z';
const userId = 'auth0:user_1';

describe('Matrix corpus turn terminal recorder', () => {
  it('appends an idempotent completed marker with only closed reply evidence', async () => {
    const repository = repositoryFixture('applied');
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(recorder.recordTerminal({ receipt: completedReceipt(), userId })).resolves.toEqual(
      { ok: true, disposition: 'applied' }
    );

    expect(repository.appendMatrixCorpusEvent).toHaveBeenCalledWith({
      identity: {
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        userId,
        leaseFence: '7',
      },
      event: {
        id: expect.stringMatching(/^imc_terminal_[0-9a-f]{32}$/u),
        sessionId: 'session_1',
        userId,
        type: 'turn_processing_completed',
        payload: {
          turnIndex: 0,
          status: 'completed',
          replyCount: 1,
          replyDigests: ['a'.repeat(64)],
        },
        createdAt: now,
      },
      now,
    });
  });

  it('propagates an already-applied failed marker', async () => {
    const repository = repositoryFixture('already_applied');
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(
      recorder.recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: true, disposition: 'already_applied' });
    expect(repository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'turn_processing_failed',
          payload: {
            turnIndex: 0,
            status: 'failed',
            failureCode: 'EXECUTION_REJECTED',
          },
        }),
      })
    );
  });

  it.each(['MATRIX_CORPUS_NOT_READY', 'MATRIX_CORPUS_PREPARATION_REJECTED'] as const)(
    'does not append a marker when no Matrix session exists for %s',
    async (failureCode) => {
      const repository = repositoryFixture('applied');
      const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

      await expect(
        recorder.recordTerminal({ receipt: failedReceipt(failureCode), userId })
      ).resolves.toEqual({ ok: true, disposition: 'not_applicable' });
      expect(repository.appendMatrixCorpusEvent).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      receipt: { ...completedReceipt(), state: 'processing' as const },
      name: 'non-terminal state',
    },
    {
      receipt: { ...completedReceipt(), state: 'failed' as const },
      name: 'terminal kind does not match receipt state',
    },
    {
      receipt: { ...failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'), state: 'completed' as const },
      name: 'failed terminal kind does not match completed state',
    },
    {
      receipt: {
        ...completedReceipt(),
        publication: { ...completedReceipt().publication, terminal: null },
      },
      name: 'missing terminal publication',
    },
  ])('rejects $name without appending an event', async ({ receipt }) => {
    const repository = repositoryFixture('applied');
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(recorder.recordTerminal({ receipt, userId })).resolves.toEqual({
      ok: false,
      disposition: 'rejected',
    });
    expect(repository.appendMatrixCorpusEvent).not.toHaveBeenCalled();
  });

  it('rejects a repository append failure', async () => {
    const repository = repositoryFixture('rejected');
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(recorder.recordTerminal({ receipt: completedReceipt(), userId })).resolves.toEqual(
      { ok: false, disposition: 'rejected' }
    );
  });

  it('writes an exact zero-call failed summary before a failed terminal when execution never started', async () => {
    const repository = repositoryFixture('applied', []);
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(
      recorder.recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: true, disposition: 'applied' });

    expect(repository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'llm_usage_summary',
          payload: {
            turnIndex: 0,
            status: 'failed',
            expectedCallCount: 0,
            reportedCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costNanoUsd: 0,
          },
        }),
      })
    );
    expect(repository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: expect.objectContaining({ type: 'turn_processing_failed' }),
      })
    );
  });

  it('rejects a completed terminal without a durable complete usage summary', async () => {
    const repository = repositoryFixture('applied', []);
    const recorder = createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository });

    await expect(recorder.recordTerminal({ receipt: completedReceipt(), userId })).resolves.toEqual(
      { ok: false, disposition: 'rejected' }
    );
    expect(repository.appendMatrixCorpusEvent).not.toHaveBeenCalled();
  });

  it('rejects failed terminal recording when event listing or usage-summary persistence fails', async () => {
    const listFailure = repositoryFixture('applied');
    listFailure.listMatrixCorpusEventsExact = vi.fn(async () => ({
      ok: false as const,
      code: 'NOT_FOUND' as const,
    }));
    await expect(
      createMatrixCorpusTurnTerminalRecorder({ sessionRepository: listFailure }).recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: false, disposition: 'rejected' });

    const appendFailure = repositoryFixture('rejected', []);
    await expect(
      createMatrixCorpusTurnTerminalRecorder({ sessionRepository: appendFailure }).recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: false, disposition: 'rejected' });
    expect(appendFailure.appendMatrixCorpusEvent).toHaveBeenCalledOnce();
  });

  it('rejects duplicate summaries and every malformed raw usage event', async () => {
    const duplicate = repositoryFixture('applied', [usageSummaryEvent(), usageSummaryEvent()]);
    await expect(
      createMatrixCorpusTurnTerminalRecorder({ sessionRepository: duplicate }).recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: false, disposition: 'rejected' });

    const base = usageCallEvent();
    for (const payload of [
      { ...base.payload, extra: true },
      { ...base.payload, inputTokens: -1 },
      { ...base.payload, outputTokens: -1 },
      { ...base.payload, totalTokens: -1 },
      { ...base.payload, totalTokens: 3 },
      { ...base.payload, costNanoUsd: -1 },
      { ...base.payload, callOrdinal: 0 },
      { ...base.payload, stage: 'invalid' },
    ]) {
      const repository = repositoryFixture('applied', [{ ...base, payload }]);
      await expect(
        createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository }).recordTerminal({
          receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
          userId,
        })
      ).resolves.toEqual({ ok: false, disposition: 'rejected' });
    }
  });

  it.each([
    'intent_classification',
    'calendar_update_planning',
    'agent_generation',
    'response_schema_repair',
  ] as const)(
    'aggregates a valid %s usage record before a failed terminal',
    async (stage) => {
      const repository = repositoryFixture('applied', [
        usageCallEvent({ payload: { ...usageCallEvent().payload, stage } }),
      ]);
      await expect(
        createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository }).recordTerminal({
          receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
          userId,
        })
      ).resolves.toEqual({ ok: true, disposition: 'applied' });
      expect(repository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'llm_usage_summary',
            payload: expect.objectContaining({
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              costNanoUsd: 1,
            }),
          }),
        })
      );
    }
  );

  it('rejects unsafe aggregate usage overflow', async () => {
    const repository = repositoryFixture('applied', [
      usageCallEvent({
        payload: {
          ...usageCallEvent().payload,
          inputTokens: Number.MAX_SAFE_INTEGER - 1,
          outputTokens: 0,
          totalTokens: Number.MAX_SAFE_INTEGER - 1,
        },
      }),
      usageCallEvent({
        payload: {
          ...usageCallEvent().payload,
          callOrdinal: 2,
          inputTokens: 2,
          outputTokens: 0,
          totalTokens: 2,
        },
      }),
    ]);
    await expect(
      createMatrixCorpusTurnTerminalRecorder({ sessionRepository: repository }).recordTerminal({
        receipt: failedReceipt('MATRIX_CORPUS_EXECUTION_REJECTED'),
        userId,
      })
    ).resolves.toEqual({ ok: false, disposition: 'rejected' });
  });
});

function repositoryFixture(
  disposition: 'applied' | 'already_applied' | 'rejected',
  events: IntexAgentSessionEvent[] = [usageSummaryEvent()]
): MatrixCorpusSessionRepository {
  return {
    createMatrixCorpusSession: vi.fn(),
    getMatrixCorpusSessionExact: vi.fn(),
    updateMatrixCorpusSessionExact: vi.fn(),
    listMatrixCorpusEventsExact: vi.fn(async () => ({ ok: true as const, events })),
    appendMatrixCorpusEvent: vi.fn(async () =>
      disposition === 'rejected'
        ? { ok: false as const, code: 'CORRUPT_EVENT' as const }
        : { ok: true as const, disposition, sequence: 7 }
    ),
  };
}

function usageSummaryEvent(): IntexAgentSessionEvent {
  return {
    id: 'usage_summary_1',
    sessionId: 'session_1',
    userId,
    type: 'llm_usage_summary',
    payload: {
      turnIndex: 0,
      status: 'complete',
      expectedCallCount: 0,
      reportedCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costNanoUsd: 0,
    },
    createdAt: now,
  };
}

function usageCallEvent(
  overrides: Partial<IntexAgentSessionEvent> = {}
): IntexAgentSessionEvent {
  return {
    id: 'usage_call_1',
    sessionId: 'session_1',
    userId,
    type: 'llm_call_usage',
    payload: {
      turnIndex: 0,
      stage: 'agent_generation',
      callOrdinal: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costNanoUsd: 1,
    },
    createdAt: now,
    ...overrides,
  };
}

function completedReceipt(): MatrixCorpusIngestReceipt {
  return {
    ...receiptBase(),
    state: 'completed',
    failureCode: null,
    publication: {
      version: 1,
      phase: 'closed',
      expectedReplyDigests: ['a'.repeat(64)],
      replies: [
        {
          replyIndex: 0,
          replyDigest: 'a'.repeat(64),
          idempotencyKeyDigest: 'b'.repeat(64),
          state: 'accepted',
          publicationReceiptDigest: 'c'.repeat(64),
          reservedAt: now,
          acceptedAt: now,
        },
      ],
      terminal: {
        kind: 'completed',
        replyCount: 1,
        replyDigests: ['a'.repeat(64)],
        publicationReceiptDigests: ['c'.repeat(64)],
        closedAt: now,
      },
    },
  };
}

function failedReceipt(
  failureCode: MatrixCorpusIngestReceipt['failureCode']
): MatrixCorpusIngestReceipt {
  const terminalCode =
    failureCode === 'MATRIX_CORPUS_EXECUTION_REJECTED'
      ? 'EXECUTION_REJECTED'
      : 'AMBIGUOUS_EXTERNAL_EFFECT';
  return {
    ...receiptBase(),
    state: 'failed',
    failureCode,
    publication: {
      version: 1,
      phase: 'closed',
      expectedReplyDigests: null,
      replies: [],
      terminal: { kind: 'failed', code: terminalCode, closedAt: now },
    },
  };
}

function receiptBase(): Omit<MatrixCorpusIngestReceipt, 'state' | 'failureCode' | 'publication'> {
  return {
    version: 1,
    ingestReceiptId: 'ingest_1',
    runId: 'run_1',
    scenarioId: 'scenario_001',
    turnIndex: 0,
    leaseFence: '7',
    payloadDigest: 'd'.repeat(64),
    sessionId: 'session_1',
    eventId: 'event_1',
    toolCallId: 'tool_1',
    replyId: 'reply_1',
    createdAt: now,
    updatedAt: now,
  };
}
