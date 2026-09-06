import { describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusEvidenceService } from '../../../domain/matrixCorpus/evidenceService.js';
import type { MatrixCorpusSessionRepository } from '../../../domain/ports/sessionRepository.js';

const identity = {
  runId: 'run_1',
  scenarioId: 'scenario_001',
  sessionId: 'session_1',
  userId: 'auth0:user_1',
  leaseFence: '7',
} as const;

describe('Matrix corpus evidence service', () => {
  it('returns only closed tool and usage facts at the exact session revision', async () => {
    const repository = repositoryFixture([
      event(1, 'user_message', { text: 'PRIVATE_USER_MESSAGE', transportId: 'wa_private' }),
      event(2, 'matrix_corpus_execution_boundary', boundaryPayload()),
      event(3, 'tool_call_started', {
        runId: identity.runId,
        scenarioId: identity.scenarioId,
        turnIndex: 0,
        toolName: 'create_link',
        ordinal: 1,
        status: 'started',
        facts: [
          { name: 'hasUrl', value: true },
          { name: 'titleLength', value: 12 },
        ],
      }),
      event(4, 'llm_call_usage', {
        turnIndex: 0,
        stage: 'calendar_update_planning',
        callOrdinal: 1,
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        costNanoUsd: 99,
      }),
      event(5, 'tool_call_completed', {
        toolName: 'create_link',
        turnIndex: 0,
        ordinal: 1,
        status: 'mock_completed',
        facts: [{ name: 'hasUrl', value: true }],
      }),
      event(6, 'llm_usage_summary', {
        turnIndex: 0,
        status: 'complete',
        expectedCallCount: 1,
        reportedCallCount: 1,
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        costNanoUsd: 99,
      }),
      event(7, 'assistant_message', {
        text: 'PRIVATE_ASSISTANT_MESSAGE',
        sourceMessageId: 'matrix_private',
      }),
      event(8, 'turn_processing_completed', {
        turnIndex: 0,
        status: 'completed',
        replyCount: 1,
        replyDigests: ['c'.repeat(64)],
      }),
    ]);
    const service = createMatrixCorpusEvidenceService({ sessionRepository: repository });

    const result = await service.getExact({ identity, expectedEventRevision: 8 });

    expect(result).toEqual({
      ok: true,
      evidence: {
        version: 1,
        eventRevision: 8,
        toolEvidence: [
          {
            event: 'selected',
            toolName: 'create_link',
            turnIndex: 0,
            ordinal: 1,
            facts: [
              { name: 'hasUrl', value: true },
              { name: 'titleLength', value: 12 },
            ],
          },
          {
            event: 'mock_completed',
            toolName: 'create_link',
            turnIndex: 0,
            ordinal: 1,
            facts: [{ name: 'hasUrl', value: true }],
          },
        ],
        agentUsage: [
          {
            turnIndex: 0,
            stage: 'calendar_update_planning',
            callOrdinal: 1,
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            costNanoUsd: 99,
          },
        ],
        agentUsageTotals: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          costNanoUsd: 99,
        },
        sessionProof: {
          status: 'waiting_for_user',
          startReason: 'no_active_session',
          userMessageCount: 1,
          sessionStartedCount: 0,
          supersededSessionCount: 0,
        },
        turnTerminals: [
          {
            status: 'completed',
            turnIndex: 0,
            replyCount: 1,
            replyDigests: ['c'.repeat(64)],
            terminalMarkerDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
            recordedAt: '2026-07-20T10:00:00.000Z',
          },
        ],
        strictMockProof: {
          version: 1,
          status: 'passed',
          executionMode: 'strict_mock_tools',
          mockProfileDigest: 'b'.repeat(64),
          productionExecutorResolutions: 0,
          productionExecutorAdmissions: 0,
        },
      },
    });
    const serialized = JSON.stringify(result);
    for (const sentinel of [
      'PRIVATE_USER_MESSAGE',
      'PRIVATE_ASSISTANT_MESSAGE',
      'wa_private',
      'matrix_private',
      identity.sessionId,
      identity.userId,
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('proves an idle user-requested session without exposing or inventing a user message', async () => {
    const repository = repositoryFixture(
      [
        event(1, 'session_started', {
          reason: 'user_requested_new_session',
          explicit: true,
        }),
        event(2, 'matrix_corpus_execution_boundary', {
          ...boundaryPayload(),
          resolution: 'no_executor_required',
        }),
        event(3, 'llm_usage_summary', {
          turnIndex: 0,
          status: 'complete',
          expectedCallCount: 0,
          reportedCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costNanoUsd: 0,
        }),
        event(4, 'assistant_message', { text: 'PRIVATE_ASSISTANT_MESSAGE' }),
        event(5, 'turn_processing_completed', {
          turnIndex: 0,
          status: 'completed',
          replyCount: 1,
          replyDigests: ['d'.repeat(64)],
        }),
      ],
      {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }
    );
    const service = createMatrixCorpusEvidenceService({ sessionRepository: repository });

    const result = await service.getExact({ identity, expectedEventRevision: 5 });

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        sessionProof: {
          status: 'waiting_for_user',
          startReason: 'user_requested_new_session',
          userMessageCount: 0,
          sessionStartedCount: 1,
          supersededSessionCount: 0,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ASSISTANT_MESSAGE');
  });

  it.each([
    {
      name: 'missing session_started event',
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.slice(1).map((candidate, index) => ({ ...candidate, eventSequence: index + 1 })),
    },
    {
      name: 'mismatched start reason',
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.map((candidate, index) =>
          index === 0
            ? { ...candidate, payload: { reason: 'no_active_session', explicit: true } }
            : candidate
        ),
    },
    {
      name: 'non-explicit user request',
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                payload: { reason: 'user_requested_new_session', explicit: false },
              }
            : candidate
        ),
    },
    {
      name: 'extra private session-start field',
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                payload: {
                  reason: 'user_requested_new_session',
                  explicit: true,
                  private: true,
                },
              }
            : candidate
        ),
    },
    {
      name: 'duplicate session_started event',
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        [
          events[0] as ReturnType<typeof event>,
          {
            ...(events[0] as ReturnType<typeof event>),
            id: 'event_duplicate',
            eventSequence: 2,
          },
          ...events.slice(1).map((candidate, index) => ({
            ...candidate,
            eventSequence: index + 3,
          })),
        ],
    },
  ])('rejects idle session proof with $name', async ({ mutate }) => {
    const events = mutate(idleSessionEvents());
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }),
    });

    await expect(
      service.getExact({ identity, expectedEventRevision: events.length })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_EVIDENCE' });
  });

  it('rejects an orphan provider call outside every summarized terminal turn', async () => {
    const events = [
      event(1, 'session_started', {
        reason: 'user_requested_new_session',
        explicit: true,
      }),
      event(
        2,
        'matrix_corpus_execution_boundary',
        boundaryPayload({ resolution: 'no_executor_required' })
      ),
      event(3, 'llm_usage_summary', summaryPayload({ expectedCallCount: 0 })),
      event(4, 'llm_call_usage', { ...usagePayload(), turnIndex: 1 }),
      event(5, 'assistant_message', { text: 'PRIVATE_ASSISTANT_MESSAGE' }),
      event(6, 'turn_processing_completed', {
        turnIndex: 0,
        status: 'completed',
        replyCount: 1,
        replyDigests: ['d'.repeat(64)],
      }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 6 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('requires the no-executor boundary for an idle user-requested session', async () => {
    const events = idleSessionEvents().map((candidate) =>
      candidate.type === 'matrix_corpus_execution_boundary'
        ? {
            ...candidate,
            payload: boundaryPayload({ resolution: 'strict_mock_executor_resolved' }),
          }
        : candidate
    );
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 5 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('proves one validated logical supersession without exposing session identity', async () => {
    const events = [
      event(1, 'session_started', { reason: 'no_active_session', explicit: false }),
      event(2, 'user_message', { text: 'private first request' }),
      event(3, 'session_closed', {
        reason: 'superseded_by_user',
        status: 'superseded',
      }),
      event(4, 'session_started', {
        reason: 'user_requested_new_session',
        explicit: true,
      }),
      event(5, 'user_message', { text: 'private replacement request' }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 5 })).resolves.toMatchObject({
      ok: true,
      evidence: {
        sessionProof: {
          startReason: 'user_requested_new_session',
          userMessageCount: 2,
          sessionStartedCount: 2,
          supersededSessionCount: 1,
        },
      },
    });
  });

  it('rejects events inserted between session closure and replacement start', async () => {
    const events = [
      event(1, 'session_started', { reason: 'no_active_session', explicit: false }),
      event(2, 'user_message', { text: 'private first request' }),
      event(3, 'session_closed', {
        reason: 'superseded_by_user',
        status: 'superseded',
      }),
      event(4, 'assistant_message', { text: 'must not exist inside restart boundary' }),
      event(5, 'session_started', {
        reason: 'user_requested_new_session',
        explicit: true,
      }),
      event(6, 'user_message', { text: 'private replacement request' }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
        status: 'waiting_for_user',
      }),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 6 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it.each([
    { name: 'stale revision', revision: 4, mutate: (events: unknown[]): unknown[] => events },
    {
      name: 'sequence gap',
      revision: 5,
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.map((candidate, index) =>
          index === 2 ? { ...candidate, eventSequence: 8 } : candidate
        ),
    },
    {
      name: 'open or unknown tool fact',
      revision: 5,
      mutate: (events: ReturnType<typeof event>[]): ReturnType<typeof event>[] =>
        events.map((candidate, index) =>
          index === 1
            ? {
                ...candidate,
                payload: {
                  ...candidate.payload,
                  facts: [{ name: 'rawUrl', value: 'https://secret.example' }],
                },
              }
            : candidate
        ),
    },
  ])('fails closed for $name', async ({ revision, mutate }) => {
    const events = [
      event(1, 'user_message', { text: 'private' }),
      event(2, 'tool_call_started', {
        runId: identity.runId,
        scenarioId: identity.scenarioId,
        turnIndex: 0,
        toolName: 'create_link',
        ordinal: 1,
        status: 'started',
        facts: [{ name: 'hasUrl', value: true }],
      }),
      event(3, 'llm_call_usage', {
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      }),
      event(4, 'tool_call_completed', {
        toolName: 'create_link',
        turnIndex: 0,
        ordinal: 1,
        status: 'mock_completed',
        facts: [{ name: 'hasUrl', value: true }],
      }),
      event(5, 'assistant_message', { text: 'private' }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(mutate(events) as ReturnType<typeof event>[]),
    });

    await expect(service.getExact({ identity, expectedEventRevision: revision })).resolves.toEqual({
      ok: false,
      code: expect.stringMatching(/^(REVISION_MISMATCH|CORRUPT_EVIDENCE)$/u),
    });
  });

  it('rejects evidence events that omit their repository-assigned sequence', async () => {
    const events = [
      { ...event(1, 'user_message', { text: 'private' }), eventSequence: undefined },
      { ...event(2, 'assistant_message', { text: 'private' }), eventSequence: undefined },
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events as unknown as ReturnType<typeof event>[]),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 2 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('rejects safe provider calls whose aggregate usage overflows a safe integer', async () => {
    const events = [
      event(1, 'llm_call_usage', {
        ...usagePayload(),
        callOrdinal: 1,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
      event(2, 'llm_call_usage', {
        ...usagePayload(),
        callOrdinal: 2,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 2 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('rejects provider usage whose individually valid turn totals overflow across the session', async () => {
    const events = [
      event(1, 'matrix_corpus_execution_boundary', boundaryPayload()),
      event(2, 'llm_call_usage', {
        ...usagePayload(),
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
      event(3, 'llm_usage_summary', {
        ...summaryPayload(),
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
      event(4, 'turn_processing_completed', completedTerminalPayload()),
      event(5, 'matrix_corpus_execution_boundary', boundaryPayload({ turnIndex: 1 })),
      event(6, 'llm_call_usage', {
        ...usagePayload(),
        turnIndex: 1,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
      event(7, 'llm_usage_summary', {
        ...summaryPayload(),
        turnIndex: 1,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costNanoUsd: 0,
      }),
      event(8, 'turn_processing_completed', {
        ...completedTerminalPayload(),
        turnIndex: 1,
        replyDigests: ['d'.repeat(64)],
      }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 8 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('rejects a session containing more than the maximum twenty user messages', async () => {
    const events = Array.from({ length: 21 }, (_, index) =>
      event(index + 1, 'user_message', {
        text: `private message ${String(index + 1)}`,
        turnIndex: index % 20,
      })
    );
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 21 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('rejects a lifecycle whose final session-start reason disagrees with the session record', async () => {
    const events = [
      event(1, 'session_started', { reason: 'no_active_session', explicit: false }),
      event(2, 'user_message', { text: 'private request', turnIndex: 0 }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events, {
        startReason: 'user_requested_new_session',
      }),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 2 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('accepts closed failed-tool evidence without exposing its arguments', async () => {
    const events = [
      event(1, 'tool_call_failed', {
        toolName: 'create_link',
        turnIndex: 0,
        ordinal: 1,
        status: 'mock_failed',
        failureCode: 'CONFIGURED_FAILURE',
        facts: [{ name: 'hasUrl', value: true }],
      }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 1 })).resolves.toMatchObject({
      ok: true,
      evidence: {
        toolEvidence: [
          {
            event: 'mock_failed',
            toolName: 'create_link',
            turnIndex: 0,
            ordinal: 1,
            facts: [{ name: 'hasUrl', value: true }],
          },
        ],
      },
    });
  });

  it.each([
    {
      name: 'completed terminal without a usage summary',
      events: [
        event(1, 'turn_processing_completed', completedTerminalPayload()),
      ],
    },
    {
      name: 'summary totals that do not match their provider calls',
      events: [
        event(1, 'llm_call_usage', usagePayload()),
        event(2, 'llm_usage_summary', summaryPayload({ totalTokens: 99 })),
        event(3, 'turn_processing_completed', completedTerminalPayload()),
      ],
    },
    {
      name: 'duplicate summaries for one turn',
      events: [
        event(1, 'llm_call_usage', usagePayload()),
        event(2, 'llm_usage_summary', summaryPayload()),
        event(3, 'llm_usage_summary', summaryPayload()),
        event(4, 'turn_processing_completed', completedTerminalPayload()),
      ],
    },
    {
      name: 'failed terminal without a usage summary',
      events: [
        event(1, 'llm_call_usage', usagePayload()),
        event(2, 'turn_processing_failed', {
          turnIndex: 0,
          status: 'failed',
          failureCode: 'EXECUTION_REJECTED',
        }),
      ],
    },
  ])('rejects $name as corrupt evidence', async ({ events }) => {
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(
      service.getExact({ identity, expectedEventRevision: events.length })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_EVIDENCE' });
  });

  it('includes run-owned provider calls from a failed turn in exact totals', async () => {
    const events = [
      event(1, 'matrix_corpus_execution_boundary', boundaryPayload()),
      event(2, 'llm_call_usage', usagePayload()),
      event(3, 'llm_usage_summary', summaryPayload({ status: 'failed' })),
      event(4, 'turn_processing_failed', {
        turnIndex: 0,
        status: 'failed',
        failureCode: 'EXECUTION_REJECTED',
      }),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    const result = await service.getExact({ identity, expectedEventRevision: 4 });

    expect(result).toMatchObject({
      ok: true,
      evidence: {
        agentUsageTotals: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          costNanoUsd: 99,
        },
      },
    });
  });

  it('accepts a completed confirmation turn with an explicit zero-call summary', async () => {
    const events = [
      event(
        1,
        'matrix_corpus_execution_boundary',
        boundaryPayload({ resolution: 'no_executor_required' })
      ),
      event(2, 'llm_usage_summary', summaryPayload({ expectedCallCount: 0 })),
      event(3, 'turn_processing_completed', completedTerminalPayload()),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 3 })).resolves.toMatchObject({
      ok: true,
      evidence: {
        agentUsage: [],
        agentUsageTotals: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costNanoUsd: 0,
        },
      },
    });
  });

  it('rejects an otherwise complete terminal turn without an authoritative execution boundary', async () => {
    const events = [
      event(1, 'llm_call_usage', usagePayload()),
      event(2, 'llm_usage_summary', summaryPayload()),
      event(3, 'turn_processing_completed', completedTerminalPayload()),
    ];
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });

    await expect(service.getExact({ identity, expectedEventRevision: 3 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid requested revision %s before repository reads',
    async (expectedEventRevision) => {
      const repository = repositoryFixture([]);
      const service = createMatrixCorpusEvidenceService({ sessionRepository: repository });
      await expect(service.getExact({ identity, expectedEventRevision })).resolves.toEqual({
        ok: false,
        code: 'REVISION_MISMATCH',
      });
      expect(repository.getMatrixCorpusSessionExact).not.toHaveBeenCalled();
    }
  );

  it('maps either unavailable repository surface to not found', async () => {
    const missingSession = repositoryFixture([]);
    vi.mocked(missingSession.getMatrixCorpusSessionExact).mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      createMatrixCorpusEvidenceService({ sessionRepository: missingSession }).getExact({
        identity,
        expectedEventRevision: 0,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const corruptEvents = repositoryFixture([]);
    vi.mocked(corruptEvents.listMatrixCorpusEventsExact).mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_SESSION',
    });
    await expect(
      createMatrixCorpusEvidenceService({ sessionRepository: corruptEvents }).getExact({
        identity,
        expectedEventRevision: 0,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it.each([
    ['usage extra key', 'llm_call_usage', { ...usagePayload(), private: true }],
    ['usage invalid turn', 'llm_call_usage', { ...usagePayload(), turnIndex: 20 }],
    ['usage invalid stage', 'llm_call_usage', { ...usagePayload(), stage: 'private' }],
    ['usage zero ordinal', 'llm_call_usage', { ...usagePayload(), callOrdinal: 0 }],
    ['usage negative input', 'llm_call_usage', { ...usagePayload(), inputTokens: -1 }],
    ['usage fractional output', 'llm_call_usage', { ...usagePayload(), outputTokens: 1.5 }],
    ['usage unsafe total', 'llm_call_usage', { ...usagePayload(), totalTokens: 13 }],
    ['usage negative cost', 'llm_call_usage', { ...usagePayload(), costNanoUsd: -1 }],
    ['summary extra key', 'llm_usage_summary', { ...summaryPayload(), private: true }],
    ['summary invalid status', 'llm_usage_summary', { ...summaryPayload(), status: 'open' }],
    ['summary invalid turn', 'llm_usage_summary', { ...summaryPayload(), turnIndex: 20 }],
    [
      'summary excessive expected calls',
      'llm_usage_summary',
      { ...summaryPayload(), expectedCallCount: 61 },
    ],
    [
      'summary excessive reported calls',
      'llm_usage_summary',
      { ...summaryPayload(), reportedCallCount: 61 },
    ],
    [
      'complete summary count mismatch',
      'llm_usage_summary',
      { ...summaryPayload(), reportedCallCount: 0 },
    ],
    [
      'failed summary count overflow',
      'llm_usage_summary',
      { ...summaryPayload({ status: 'failed' }), reportedCallCount: 2 },
    ],
    ['summary negative input', 'llm_usage_summary', { ...summaryPayload(), inputTokens: -1 }],
    ['summary negative output', 'llm_usage_summary', { ...summaryPayload(), outputTokens: -1 }],
    ['summary bad total', 'llm_usage_summary', { ...summaryPayload(), totalTokens: 13 }],
    ['summary negative cost', 'llm_usage_summary', { ...summaryPayload(), costNanoUsd: -1 }],
    [
      'execution boundary wrong digest',
      'matrix_corpus_execution_boundary',
      boundaryPayload({ mockProfileDigest: 'd'.repeat(64) }),
    ],
    [
      'execution boundary admits production executor',
      'matrix_corpus_execution_boundary',
      boundaryPayload({ productionExecutorAdmissions: 1 }),
    ],
    [
      'completed terminal invalid turn',
      'turn_processing_completed',
      { ...completedTerminalPayload(), turnIndex: 20 },
    ],
    [
      'completed terminal extra key',
      'turn_processing_completed',
      { ...completedTerminalPayload(), private: true },
    ],
    [
      'completed terminal wrong status',
      'turn_processing_completed',
      { ...completedTerminalPayload(), status: 'failed' },
    ],
    [
      'completed terminal zero replies',
      'turn_processing_completed',
      { ...completedTerminalPayload(), replyCount: 0, replyDigests: [] },
    ],
    [
      'completed terminal digest count mismatch',
      'turn_processing_completed',
      { ...completedTerminalPayload(), replyCount: 2 },
    ],
    [
      'completed terminal invalid digest',
      'turn_processing_completed',
      { ...completedTerminalPayload(), replyDigests: ['invalid'] },
    ],
    [
      'completed terminal duplicate digests',
      'turn_processing_completed',
      {
        ...completedTerminalPayload(),
        replyCount: 2,
        replyDigests: ['c'.repeat(64), 'c'.repeat(64)],
      },
    ],
    [
      'failed terminal extra key',
      'turn_processing_failed',
      { turnIndex: 0, status: 'failed', failureCode: 'EXECUTION_REJECTED', private: true },
    ],
    [
      'failed terminal wrong status',
      'turn_processing_failed',
      { turnIndex: 0, status: 'completed', failureCode: 'EXECUTION_REJECTED' },
    ],
    [
      'failed terminal unknown code',
      'turn_processing_failed',
      { turnIndex: 0, status: 'failed', failureCode: 'PRIVATE' },
    ],
    [
      'started tool missing exact field',
      'tool_call_started',
      { runId: identity.runId, scenarioId: identity.scenarioId, turnIndex: 0, toolName: 'create_link', ordinal: 1, status: 'started' },
    ],
    [
      'started tool wrong status',
      'tool_call_started',
      { runId: identity.runId, scenarioId: identity.scenarioId, turnIndex: 0, toolName: 'create_link', ordinal: 1, status: 'open', facts: [] },
    ],
    [
      'completed tool wrong status',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'started', facts: [] },
    ],
    [
      'failed tool wrong status',
      'tool_call_failed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'open', failureCode: 'FAIL', facts: [] },
    ],
    [
      'failed tool non-string code',
      'tool_call_failed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_failed', failureCode: 3, facts: [] },
    ],
    [
      'failed tool empty code',
      'tool_call_failed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_failed', failureCode: '', facts: [] },
    ],
    [
      'failed tool oversized code',
      'tool_call_failed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_failed', failureCode: 'x'.repeat(65), facts: [] },
    ],
    [
      'tool unknown name',
      'tool_call_completed',
      { toolName: 'private_tool', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [] },
    ],
    [
      'tool invalid ordinal',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 0, status: 'mock_completed', facts: [] },
    ],
    [
      'tool non-array facts',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: {} },
    ],
    [
      'tool excessive facts',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: Array.from({ length: 17 }, () => ({ name: 'hasUrl', value: true })) },
    ],
    [
      'tool null fact',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [null] },
    ],
    [
      'tool array fact',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [[]] },
    ],
    [
      'tool fact extra key',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [{ name: 'hasUrl', value: true, private: true }] },
    ],
    [
      'tool fact unknown name',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [{ name: 'private', value: true }] },
    ],
    [
      'tool fact unsafe value',
      'tool_call_completed',
      { toolName: 'create_link', turnIndex: 0, ordinal: 1, status: 'mock_completed', facts: [{ name: 'titleLength', value: -1 }] },
    ],
  ] as const)('rejects malformed mapped evidence: %s', async (_name, type, payload) => {
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture([event(1, type, payload)]),
    });
    await expect(service.getExact({ identity, expectedEventRevision: 1 })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_EVIDENCE',
    });
  });

  it('rejects duplicate keys, usage ordinal gaps, and terminal-summary status mismatch', async () => {
    const cases = [
      [
        event(1, 'tool_call_completed', {
          toolName: 'create_link',
          turnIndex: 0,
          ordinal: 1,
          status: 'mock_completed',
          facts: [],
        }),
        event(2, 'tool_call_completed', {
          toolName: 'create_link',
          turnIndex: 0,
          ordinal: 1,
          status: 'mock_completed',
          facts: [],
        }),
      ],
      [
        event(1, 'llm_call_usage', { ...usagePayload(), callOrdinal: 2 }),
      ],
      [
        event(1, 'llm_usage_summary', summaryPayload({ status: 'failed' })),
        event(2, 'turn_processing_completed', completedTerminalPayload()),
      ],
      [
        event(1, 'llm_usage_summary', summaryPayload({ turnIndex: 1 })),
        event(2, 'turn_processing_completed', completedTerminalPayload()),
      ],
    ];
    for (const events of cases) {
      const service = createMatrixCorpusEvidenceService({
        sessionRepository: repositoryFixture(events),
      });
      await expect(
        service.getExact({ identity, expectedEventRevision: events.length })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_EVIDENCE' });
    }
  });

  it.each([
    ['tool evidence', 101, 'tool_call_completed'],
    ['usage calls', 61, 'llm_call_usage'],
    ['usage summaries', 21, 'llm_usage_summary'],
    ['turn terminals', 21, 'turn_processing_failed'],
  ] as const)('rejects excessive %s evidence', async (_name, count, type) => {
    const events = Array.from({ length: count }, (_, index) => {
      const turnIndex = index % 20;
      if (type === 'tool_call_completed')
        return event(index + 1, type, {
          toolName: 'create_link',
          turnIndex,
          ordinal: (index % 20) + 1,
          status: 'mock_completed',
          facts: [],
        });
      if (type === 'llm_call_usage')
        return event(index + 1, type, {
          ...usagePayload(),
          turnIndex,
          callOrdinal: Math.floor(index / 20) + 1,
        });
      if (type === 'llm_usage_summary')
        return event(index + 1, type, summaryPayload({ turnIndex }));
      return event(index + 1, type, {
        turnIndex,
        status: 'failed',
        failureCode: 'EXECUTION_REJECTED',
      });
    });
    const service = createMatrixCorpusEvidenceService({
      sessionRepository: repositoryFixture(events),
    });
    await expect(
      service.getExact({ identity, expectedEventRevision: events.length })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_EVIDENCE' });
  });
});

function usagePayload(): Record<string, unknown> {
  return {
    turnIndex: 0,
    stage: 'agent_generation',
    callOrdinal: 1,
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    costNanoUsd: 99,
  };
}

function summaryPayload(
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  const expectedCallCount = overrides['expectedCallCount'] ?? 1;
  return {
    turnIndex: 0,
    status: 'complete',
    expectedCallCount,
    reportedCallCount: expectedCallCount,
    inputTokens: expectedCallCount === 0 ? 0 : 10,
    outputTokens: expectedCallCount === 0 ? 0 : 2,
    totalTokens: expectedCallCount === 0 ? 0 : 12,
    costNanoUsd: expectedCallCount === 0 ? 0 : 99,
    ...overrides,
  };
}

function completedTerminalPayload(): Record<string, unknown> {
  return {
    turnIndex: 0,
    status: 'completed',
    replyCount: 1,
    replyDigests: ['c'.repeat(64)],
  };
}

function idleSessionEvents(): ReturnType<typeof event>[] {
  return [
    event(1, 'session_started', {
      reason: 'user_requested_new_session',
      explicit: true,
    }),
    event(
      2,
      'matrix_corpus_execution_boundary',
      boundaryPayload({ resolution: 'no_executor_required' })
    ),
    event(3, 'llm_usage_summary', summaryPayload({ expectedCallCount: 0 })),
    event(4, 'assistant_message', { text: 'PRIVATE_ASSISTANT_MESSAGE' }),
    event(5, 'turn_processing_completed', {
      turnIndex: 0,
      status: 'completed',
      replyCount: 1,
      replyDigests: ['d'.repeat(64)],
    }),
  ];
}

function boundaryPayload(
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    version: 1,
    turnIndex: 0,
    resolution: 'strict_mock_executor_resolved',
    executionMode: 'strict_mock_tools',
    mockProfileDigest: 'b'.repeat(64),
    productionExecutorResolutions: 0,
    productionExecutorAdmissions: 0,
    ...overrides,
  };
}

function repositoryFixture(
  events: ReturnType<typeof event>[],
  sessionOverrides: Readonly<{
    status?: 'active' | 'waiting_for_user';
    startReason?: 'no_active_session' | 'user_requested_new_session';
  }> = {}
): MatrixCorpusSessionRepository {
  return {
    createMatrixCorpusSession: vi.fn(),
    getMatrixCorpusSessionExact: vi.fn(async () => ({
      ok: true as const,
      session: {
        id: identity.sessionId,
        userId: identity.userId,
        channel: 'whatsapp' as const,
        status: sessionOverrides.status ?? ('waiting_for_user' as const),
        startedAt: '2026-07-20T10:00:00.000Z',
        lastUserMessageAt: '2026-07-20T10:00:00.000Z',
        startReason: sessionOverrides.startReason ?? ('no_active_session' as const),
        lastEventSequence: events.length,
        matrixCorpusProfile: {
          version: 1 as const,
          kind: 'matrix_corpus' as const,
          runtimeAudience: 'hetzner-prod' as const,
          leaseFence: identity.leaseFence,
          runId: identity.runId,
          scenarioId: identity.scenarioId,
          scenarioNumber: 1,
          scenarioLabel: 'Scenario 001/020',
          executionMode: 'strict_mock_tools' as const,
          agentModel: 'or:deepseek/deepseek-v4-flash' as const,
          evaluatorModel: 'or:minimax/minimax-m3' as const,
          promptPreferencesVersion: 0,
          promptPreferencesDigest: 'a'.repeat(64),
          userTimeZone: 'Europe/Warsaw',
          mockProfile: {
            version: 1 as const,
            calls: [],
            forbiddenSelections: [],
            unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
          },
          mockProfileDigest: 'b'.repeat(64),
          expectedToolSchedule: [],
        },
      },
    })),
    updateMatrixCorpusSessionExact: vi.fn(),
    appendMatrixCorpusEvent: vi.fn(),
    listMatrixCorpusEventsExact: vi.fn(async () => ({ ok: true as const, events })),
  };
}

function event(
  sequence: number,
  type: import('../../../domain/sessions/types.js').IntexAgentSessionEventType,
  payload: Record<string, unknown>
): import('../../../domain/sessions/types.js').IntexAgentSessionEvent {
  return {
    id: `event_${String(sequence)}`,
    sessionId: identity.sessionId,
    userId: identity.userId,
    type,
    payload,
    createdAt: '2026-07-20T10:00:00.000Z',
    eventSequence: sequence,
  };
}
