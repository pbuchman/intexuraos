import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type MatrixCorpusAttestationClaimsV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createMatrixCorpusExecutionService,
  type MatrixCorpusExecutionServiceDeps,
} from '../../../domain/matrixCorpus/matrixCorpusExecutionService.js';
import type { MatrixCorpusContextService } from '../../../domain/matrixCorpus/contextService.js';
import type {
  IngestReceiptRepository,
  MatrixCorpusIngestReceipt,
} from '../../../domain/matrixCorpus/ports/ingestReceiptRepository.js';
import type { TestConfirmationRepository } from '../../../domain/matrixCorpus/ports/testConfirmationRepository.js';
import type { MatrixCorpusSessionRepository } from '../../../domain/ports/sessionRepository.js';
import type { IntexAgentRunner } from '../../../domain/messages/handleIncomingMessage.js';
import type { IntexAgentSession } from '../../../domain/sessions/types.js';

const now = '2026-07-20T10:00:00.000Z';
const stableKeys = {
  sessionId: 'matrix_session_1',
  eventId: 'matrix_event_1',
  toolCallId: 'matrix_tool_1',
  replyId: 'matrix_reply_1',
} as const;

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function profile(toolName: 'create_note' | 'query_calendar_events'): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [
      toolName === 'create_note'
        ? {
            turnIndex: 0,
            toolName,
            ordinal: 1,
            outcome: {
              kind: 'success',
              result: { toolName, status: 'completed', message: 'Synthetic note saved' },
            },
          }
        : {
            turnIndex: 0,
            toolName,
            ordinal: 1,
            outcome: {
              kind: 'success',
              result: { toolName, status: 'completed', mode: 'count', count: 0 },
            },
          },
    ],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function emptyProfile(): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function claims(
  toolName: 'create_note' | 'query_calendar_events',
  overrides: Readonly<Record<string, unknown>> = {}
): IngestClaims {
  const mockProfile = profile(toolName);
  const payload = {
    version: 1 as const,
    kind: 'matrix_corpus_ingest_payload' as const,
    ordinaryIngest: {
      type: 'intex.message.ingest' as const,
      userId: 'auth0:user_1',
      messageId: 'transport_message_1',
      text: 'Synthetic Matrix request',
      sourceType: 'whatsapp_text' as const,
      timestamp: now,
    },
    context: {
      version: 1 as const,
      kind: 'matrix_corpus' as const,
      runtimeAudience: 'hetzner-prod' as const,
      leaseFence: '7',
      ingestReceiptId: 'receipt_1',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      turnIndex: 0,
      phase: 'start' as const,
      startNewSession: true,
      promptNormalizationVersion: 1 as const,
      promptDigest: '1'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile,
      mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile)),
      expectedToolSchedule: [{ turnIndex: 0, toolName, ordinal: 1 }],
      currentDateTime: now,
      timeZone: 'Europe/Warsaw',
      ...overrides,
    },
  };
  return {
    version: 1,
    kind: 'matrix_corpus_ingest',
    issuer: 'whatsapp-service',
    audience: 'intex-agent',
    runtimeAudience: 'hetzner-prod',
    keyVersion: 'key_v1',
    eventId: 'receipt_1',
    leaseFence: '7',
    payloadDigest: sha256(canonicalMatrixCorpusIngestPayloadV1(payload)),
    issuedAt: now,
    expiresAt: '2026-07-20T10:05:00.000Z',
    payload,
  };
}

function idleNewSessionClaims(): IngestClaims {
  const strictMockProfile = emptyProfile();
  const base = claims('create_note');
  const payload = {
    ...base.payload,
    ordinaryIngest: {
      ...base.payload.ordinaryIngest,
      text: 'new session',
    },
    context: {
      ...base.payload.context,
      scenarioId: 'intex-eval-009',
      scenarioNumber: 9,
      scenarioLabel: 'Scenario 009/020',
      mockProfile: strictMockProfile,
      mockProfileDigest: sha256(
        canonicalMatrixCorpusStrictToolMockProfileV1(strictMockProfile)
      ),
      expectedToolSchedule: [],
    },
  };
  return {
    ...base,
    payloadDigest: sha256(canonicalMatrixCorpusIngestPayloadV1(payload)),
    payload,
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred mocks are asserted directly
function fixture(
  runner: IntexAgentRunner,
  options: Readonly<{
    mockProfile?: StrictToolMockProfileV1;
    expectedToolSchedule?: NonNullable<
      IntexAgentSession['matrixCorpusProfile']
    >['expectedToolSchedule'];
    scenarioId?: string;
    scenarioNumber?: number;
    scenarioLabel?: string;
    agentModel?: string;
    sessionOverrides?: Partial<IntexAgentSession>;
  }> = {}
) {
  const mockProfile = options.mockProfile ?? profile('query_calendar_events');
  const expectedToolSchedule = options.expectedToolSchedule ?? [
    { turnIndex: 0, toolName: 'query_calendar_events' as const, ordinal: 1 },
  ];
  const session: IntexAgentSession = {
    id: stableKeys.sessionId,
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: now,
    lastUserMessageAt: now,
    startReason: 'no_active_session',
    matrixCorpusProfile: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      runId: 'run_1',
      scenarioId: options.scenarioId ?? 'scenario_001',
      scenarioNumber: options.scenarioNumber ?? 1,
      scenarioLabel: options.scenarioLabel ?? 'Scenario 001/020',
      executionMode: 'strict_mock_tools',
      agentModel: (options.agentModel ?? 'or:deepseek/deepseek-v4-flash') as never,
      evaluatorModel: 'or:minimax/minimax-m3',
      promptPreferencesVersion: 0,
      promptPreferencesDigest: 'a'.repeat(64),
      userTimeZone: 'Europe/Warsaw',
      mockProfile,
      mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile)),
      expectedToolSchedule,
    },
    lastEventSequence: 1,
    ...options.sessionOverrides,
  };
  const sessionRepository = {
    getMatrixCorpusSessionExact: vi.fn<
      MatrixCorpusSessionRepository['getMatrixCorpusSessionExact']
    >(async () => ({ ok: true as const, session: session as never })),
    listMatrixCorpusEventsExact: vi.fn<
      MatrixCorpusSessionRepository['listMatrixCorpusEventsExact']
    >(async () => ({
      ok: true as const,
      events: [
        {
          id: stableKeys.eventId,
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'user_message' as const,
          payload: { text: 'Synthetic Matrix request' },
          createdAt: now,
          eventSequence: 1,
        },
      ],
    })),
    appendMatrixCorpusEvent: vi.fn<MatrixCorpusSessionRepository['appendMatrixCorpusEvent']>(
      async () => ({ ok: true as const, disposition: 'applied' as const, sequence: 2 })
    ),
  };
  const overlay = { read: vi.fn(), mutate: vi.fn() };
  const contextService = {
    loadScenarioPromptContext: vi.fn<MatrixCorpusContextService['loadScenarioPromptContext']>(
      async () => ({
        ok: true as const,
        promptContext: '{"version":1,"userPreferences":null}',
        overlayVersion: 0,
        overlayDigest: 'b'.repeat(64),
      })
    ),
    createPreferenceOverlay: vi.fn(() => overlay),
  };
  const confirmationRepository = {
    createOrGet: vi.fn<TestConfirmationRepository['createOrGet']>(),
    getExact: vi.fn<TestConfirmationRepository['getExact']>(),
  };
  const createRunner = vi.fn<MatrixCorpusExecutionServiceDeps['createRunner']>(() => runner);
  const receiptRepository = {
    beginReplyCompletion: vi.fn<IngestReceiptRepository['beginReplyCompletion']>(async () => ({
      ok: true,
      disposition: 'applied',
      receipt: {} as never,
    })),
    reserveReplyPublication: vi.fn<IngestReceiptRepository['reserveReplyPublication']>(
      async () => ({ ok: true, disposition: 'applied', receipt: {} as never })
    ),
    acceptReplyPublication: vi.fn<IngestReceiptRepository['acceptReplyPublication']>(async () => ({
      ok: true,
      disposition: 'applied',
      receipt: {} as never,
    })),
  };
  const replyPublisher = {
    publishReplyWithReceipt: vi.fn(async () => ({ publicationReceiptId: 'pubsub_message_1' })),
  };
  const deps = {
    contextService,
    sessionRepository,
    confirmationRepository,
    receiptRepository,
    createRunner,
    replyPublisher,
  } as unknown as MatrixCorpusExecutionServiceDeps;
  return {
    session,
    sessionRepository,
    contextService,
    confirmationRepository,
    receiptRepository,
    createRunner,
    replyPublisher,
    service: createMatrixCorpusExecutionService(deps),
  };
}

function resolvedConfirmation(
  overrides: Readonly<Record<string, unknown>> = {}
): Awaited<ReturnType<TestConfirmationRepository['getExact']>> {
  return {
    ok: true,
    confirmation: {
      version: 1,
      lane: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      confirmationId: 'confirmation_1',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      leaseFence: '7',
      state: 'resolved',
      toolName: 'create_note',
      toolArgs: { content: 'raw synthetic argument' },
      selectionTurnIndex: 0,
      selectionOrdinal: 1,
      createdAt: now,
      expiresAt: '2026-07-20T10:05:00.000Z',
      decision: 'confirm',
      resolutionMessageId: 'transport_message_1',
      resolvedAt: now,
      ...overrides,
    },
  } as Awaited<ReturnType<TestConfirmationRepository['getExact']>>;
}

function reservedReceipt(verified: IngestClaims, reply: string): MatrixCorpusIngestReceipt {
  const replyDigest = sha256(
    JSON.stringify({ kind: 'matrix_corpus_reply', replyIndex: 0, text: reply, version: 1 })
  );
  const idempotencyKey = `imc_reply_publish_${sha256('receipt_1:0').slice(0, 32)}`;
  return {
    version: 1,
    ingestReceiptId: verified.eventId,
    runId: 'run_1',
    scenarioId: 'scenario_001',
    turnIndex: 0,
    leaseFence: '7',
    payloadDigest: verified.payloadDigest,
    ...stableKeys,
    state: 'llm_in_flight',
    failureCode: null,
    publication: {
      version: 1,
      phase: 'completing',
      expectedReplyDigests: [replyDigest],
      replies: [
        {
          replyIndex: 0,
          replyDigest,
          idempotencyKeyDigest: sha256(idempotencyKey),
          state: 'reserved',
          publicationReceiptDigest: null,
          reservedAt: now,
          acceptedAt: null,
        },
      ],
      terminal: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function matrixProfile(
  session: IntexAgentSession
): NonNullable<IntexAgentSession['matrixCorpusProfile']> {
  if (session.matrixCorpusProfile === undefined) throw new Error('missing Matrix profile fixture');
  return session.matrixCorpusProfile;
}

describe('Matrix corpus execution service', () => {
  it('answers an idle explicit new-session command deterministically without constructing an LLM runner', async () => {
    const runner = {
      run: vi.fn(),
      executeConfirmed: vi.fn(),
    };
    const { service, sessionRepository, createRunner, replyPublisher } = fixture(runner, {
      mockProfile: emptyProfile(),
      expectedToolSchedule: [],
      scenarioId: 'intex-eval-009',
      scenarioNumber: 9,
      scenarioLabel: 'Scenario 009/020',
      sessionOverrides: {
        status: 'active',
        startReason: 'user_requested_new_session',
      },
    });
    sessionRepository.listMatrixCorpusEventsExact.mockResolvedValue({
      ok: true,
      events: [
        {
          id: stableKeys.eventId,
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'session_started',
          payload: { reason: 'user_requested_new_session', explicit: true },
          createdAt: now,
          eventSequence: 1,
        },
      ],
    });

    await expect(
      service.executeVerifiedIngest({
        claims: idleNewSessionClaims(),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });

    expect(createRunner).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(
      sessionRepository.appendMatrixCorpusEvent.mock.calls.map(
        (call) => call[0].event.type
      )
    ).toEqual([
      'matrix_corpus_execution_boundary',
      'llm_usage_summary',
      'assistant_message',
    ]);
    expect(
      sessionRepository.appendMatrixCorpusEvent.mock.calls[0]?.[0].event.payload
    ).toMatchObject({
      resolution: 'no_executor_required',
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    });
    expect(
      sessionRepository.appendMatrixCorpusEvent.mock.calls[1]?.[0].event.payload
    ).toMatchObject({
      status: 'complete',
      expectedCallCount: 0,
      reportedCallCount: 0,
      totalTokens: 0,
      costNanoUsd: 0,
    });
    expect(replyPublisher.publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('What would you like me to help with?'),
      })
    );
  });

  it('runs a verified normal turn through the catalog-bound Matrix runner and persists its reply', async () => {
    const runner = {
      run: vi.fn(async () => ({
        outcome: 'completed' as const,
        reply: 'No events.',
        toolName: 'query_calendar_events' as const,
        toolResult: { toolName: 'query_calendar_events', status: 'completed', count: 0 },
        toolSelection: { turnIndex: 0, ordinal: 1 },
      })),
      executeConfirmed: vi.fn(),
    };
    const { service, sessionRepository, createRunner, replyPublisher, receiptRepository } =
      fixture(runner);

    await expect(
      service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });
    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth0:user_1',
        userPreferences: '{"version":1,"userPreferences":null}',
        execution: expect.objectContaining({
          flow: 'normal',
          expectedSchedule: [{ turnIndex: 0, toolName: 'query_calendar_events', ordinal: 1 }],
        }),
      })
    );
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [],
        message: 'Synthetic Matrix request',
        timeZone: 'Europe/Warsaw',
      })
    );
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'tool_call_completed',
          payload: {
            toolName: 'query_calendar_events',
            turnIndex: 0,
            ordinal: 1,
            status: 'mock_completed',
            facts: [{ name: 'resultCount', value: 0 }],
          },
        }),
      })
    );
    expect(replyPublisher.publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No events.', idempotencyKey: expect.any(String) })
    );
    expect(receiptRepository.beginReplyCompletion).toHaveBeenCalledOnce();
    expect(receiptRepository.reserveReplyPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        replyIndex: 0,
        replyDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      })
    );
    expect(receiptRepository.acceptReplyPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        replyIndex: 0,
        publicationReceiptDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      })
    );
  });

  it('passes the immutable MiniMax agent model from the session profile to the runner factory', async () => {
    const runner = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'No action.' })),
      executeConfirmed: vi.fn(),
    };
    const { service, createRunner } = fixture(runner, {
      agentModel: 'or:minimax/minimax-m3',
    });

    await expect(
      service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });
    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        agentModel: 'or:minimax/minimax-m3',
      })
    );
  });

  it('isolates runner history after the latest logical session start', async () => {
    const runner = {
      run: vi.fn(async () => ({
        outcome: 'completed' as const,
        reply: 'No events.',
        toolName: 'query_calendar_events' as const,
        toolResult: { toolName: 'query_calendar_events', status: 'completed', count: 0 },
        toolSelection: { turnIndex: 0, ordinal: 1 },
      })),
      executeConfirmed: vi.fn(),
    };
    const { service, sessionRepository } = fixture(runner, {
      sessionOverrides: { startReason: 'user_requested_new_session' },
    });
    sessionRepository.listMatrixCorpusEventsExact.mockResolvedValue({
      ok: true,
      events: [
        {
          id: 'initial_start',
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'session_started',
          payload: { reason: 'no_active_session', explicit: false },
          createdAt: now,
          eventSequence: 1,
        },
        {
          id: 'old_user',
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'user_message',
          payload: { text: 'Old calendar request' },
          createdAt: now,
          eventSequence: 2,
        },
        {
          id: 'old_assistant',
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'assistant_message',
          payload: { text: 'Which date?' },
          createdAt: now,
          eventSequence: 3,
        },
        {
          id: 'old_closed',
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'session_closed',
          payload: { reason: 'superseded_by_user', status: 'superseded' },
          createdAt: now,
          eventSequence: 4,
        },
        {
          id: 'replacement_start',
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'session_started',
          payload: { reason: 'user_requested_new_session', explicit: true },
          createdAt: now,
          eventSequence: 5,
        },
        {
          id: stableKeys.eventId,
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'user_message',
          payload: { text: 'Synthetic Matrix request' },
          createdAt: now,
          eventSequence: 6,
        },
      ],
    });
    const verified = claims('query_calendar_events', {
      phase: 'turn',
      turnIndex: 1,
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
    });

    await expect(
      service.executeVerifiedIngest({ claims: verified, stableKeys })
    ).resolves.toEqual({ ok: true });

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [],
        message: 'Synthetic Matrix request',
      })
    );
  });

  it('returns a closed publication failure after reservation without accepting a fake receipt', async () => {
    const runner = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
      executeConfirmed: vi.fn(),
    };
    const { service, replyPublisher, receiptRepository } = fixture(runner);
    replyPublisher.publishReplyWithReceipt.mockRejectedValue(new Error('private provider error'));

    await expect(
      service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'REPLY_PUBLICATION_REJECTED' });
    expect(receiptRepository.reserveReplyPublication).toHaveBeenCalledOnce();
    expect(receiptRepository.acceptReplyPublication).not.toHaveBeenCalled();
  });

  it('replays an exact reserved reply with its stable idempotency key without rerunning the LLM', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() };
    const { service, sessionRepository, createRunner, replyPublisher, receiptRepository } = fixture(
      runner as unknown as IntexAgentRunner
    );
    const reply = 'Persisted synthetic reply.';
    const replyDigest = sha256(
      JSON.stringify({
        kind: 'matrix_corpus_reply',
        replyIndex: 0,
        text: reply,
        version: 1,
      })
    );
    sessionRepository.listMatrixCorpusEventsExact.mockResolvedValue({
      ok: true,
      events: [
        {
          id: stableKeys.replyId,
          sessionId: stableKeys.sessionId,
          userId: 'auth0:user_1',
          type: 'assistant_message',
          payload: { text: reply },
          createdAt: now,
          eventSequence: 2,
        },
      ],
    });
    const verified = claims('query_calendar_events');
    const idempotencyKey = `imc_reply_publish_${sha256('receipt_1:0').slice(0, 32)}`;
    const receipt = {
      version: 1 as const,
      ingestReceiptId: verified.eventId,
      runId: 'run_1',
      scenarioId: 'scenario_001',
      turnIndex: 0,
      leaseFence: '7',
      payloadDigest: verified.payloadDigest,
      ...stableKeys,
      state: 'llm_in_flight' as const,
      failureCode: null,
      publication: {
        version: 1 as const,
        phase: 'completing' as const,
        expectedReplyDigests: [replyDigest],
        replies: [
          {
            replyIndex: 0,
            replyDigest,
            idempotencyKeyDigest: sha256(idempotencyKey),
            state: 'reserved' as const,
            publicationReceiptDigest: null,
            reservedAt: now,
            acceptedAt: null,
          },
        ],
        terminal: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    const recoveryService = service as typeof service & {
      recoverVerifiedIngest?: (input: {
        claims: IngestClaims;
        stableKeys: typeof stableKeys;
        receipt: typeof receipt;
      }) => Promise<{ ok: boolean }>;
    };

    expect(recoveryService.recoverVerifiedIngest).toEqual(expect.any(Function));
    if (recoveryService.recoverVerifiedIngest === undefined) return;
    await expect(
      recoveryService.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: true });

    expect(createRunner).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(replyPublisher.publishReplyWithReceipt).toHaveBeenCalledWith({
      userId: 'auth0:user_1',
      message: reply,
      replyToMessageId: 'transport_message_1',
      idempotencyKey,
    });
    expect(receiptRepository.acceptReplyPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        replyIndex: 0,
        replyDigest,
        idempotencyKeyDigest: sha256(idempotencyKey),
        publicationReceiptDigest: sha256('pubsub_message_1'),
      })
    );

    replyPublisher.publishReplyWithReceipt.mockClear();
    receiptRepository.acceptReplyPublication.mockClear();
    const changedDigest = 'f'.repeat(64);
    const reservedReply = receipt.publication.replies[0];
    if (reservedReply === undefined) throw new Error('missing reserved reply fixture');
    await expect(
      recoveryService.recoverVerifiedIngest({
        claims: verified,
        stableKeys,
        receipt: {
          ...receipt,
          publication: {
            ...receipt.publication,
            expectedReplyDigests: [changedDigest],
            replies: [{ ...reservedReply, replyDigest: changedDigest }],
          },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATION_REJECTED' });
    expect(replyPublisher.publishReplyWithReceipt).not.toHaveBeenCalled();
    expect(receiptRepository.acceptReplyPublication).not.toHaveBeenCalled();
  });

  it('persists one closed nano-USD usage event for an exactly correlated provider call', async () => {
    const fallbackRunner = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
      executeConfirmed: vi.fn(),
    };
    const { service, createRunner, sessionRepository } = fixture(fallbackRunner);
    createRunner.mockImplementation((runnerInput) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        runnerInput.execution.registerExpectedProviderCall({
          version: 1,
          runId: 'run_1',
          scenarioId: 'scenario_001',
          sessionId: stableKeys.sessionId,
          turnIndex: 0,
          stage: 'agent_generation',
          callOrdinal: 1,
        });
        const call = {
          context: {
            version: 1,
            runId: 'run_1',
            scenarioId: 'scenario_001',
            sessionId: stableKeys.sessionId,
            turnIndex: 0,
            stage: 'agent_generation',
            callOrdinal: 1,
          },
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 13,
          outputTokens: 2,
          totalTokens: 15,
          providerReportedUsd: 0.0000000015,
        } as const;
        await runnerInput.execution.recordProviderCall(call);
        await runnerInput.execution.recordProviderCall(call);
        return { outcome: 'no_action' as const, reply: 'Synthetic reply.' };
      }),
    }));

    await expect(
      service.executeVerifiedIngest({ claims: claims('query_calendar_events'), stableKeys })
    ).resolves.toEqual({ ok: true });

    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          id: expect.stringMatching(/^imc_usage_[0-9a-f]{32}$/u),
          type: 'llm_call_usage',
          payload: {
            turnIndex: 0,
            stage: 'agent_generation',
            callOrdinal: 1,
            inputTokens: 13,
            outputTokens: 2,
            totalTokens: 15,
            costNanoUsd: 2,
          },
        }),
      })
    );
    const serialized = JSON.stringify(sessionRepository.appendMatrixCorpusEvent.mock.calls);
    expect(serialized).not.toContain('providerReportedUsd');
    expect(serialized).not.toContain('or:deepseek/deepseek-v4-flash');
    expect(
      sessionRepository.appendMatrixCorpusEvent.mock.calls.filter(
        ([input]) => input.event.type === 'llm_call_usage'
      )
    ).toHaveLength(1);
  });

  it('persists exact partial usage totals before propagating a later runner failure', async () => {
    const fallbackRunner = {
      run: vi.fn(),
      executeConfirmed: vi.fn(),
    };
    const { service, createRunner, sessionRepository, replyPublisher } = fixture(
      fallbackRunner as unknown as IntexAgentRunner
    );
    createRunner.mockImplementation((runnerInput) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        const firstContext = {
          version: 1 as const,
          runId: 'run_1',
          scenarioId: 'scenario_001',
          sessionId: stableKeys.sessionId,
          turnIndex: 0,
          stage: 'agent_generation' as const,
          callOrdinal: 1,
        };
        runnerInput.execution.registerExpectedProviderCall(firstContext);
        await runnerInput.execution.recordProviderCall({
          context: firstContext,
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 13,
          outputTokens: 2,
          totalTokens: 15,
          providerReportedUsd: 0.0000000015,
        });
        runnerInput.execution.registerExpectedProviderCall({
          ...firstContext,
          callOrdinal: 2,
        });
        throw new Error('PRIVATE_LATER_RUNNER_FAILURE');
      }),
    }));

    await expect(
      service.executeVerifiedIngest({ claims: claims('query_calendar_events'), stableKeys })
    ).rejects.toThrow('PRIVATE_LATER_RUNNER_FAILURE');

    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'llm_usage_summary',
          payload: {
            turnIndex: 0,
            status: 'failed',
            expectedCallCount: 2,
            reportedCallCount: 1,
            inputTokens: 13,
            outputTokens: 2,
            totalTokens: 15,
            costNanoUsd: 2,
          },
        }),
      })
    );
    expect(replyPublisher.publishReplyWithReceipt).not.toHaveBeenCalled();
  });

  it('creates a one-use confirmation without persisting raw tool arguments in session events', async () => {
    const runner = {
      run: vi.fn(async () => ({
        outcome: 'needs_confirmation' as const,
        reply: 'Confirm synthetic note creation.',
        toolName: 'create_note' as const,
        toolArgs: { content: 'raw synthetic argument' },
        toolSelection: { turnIndex: 0, ordinal: 1 },
      })),
      executeConfirmed: vi.fn(),
    };
    const { service, session, sessionRepository, confirmationRepository } = fixture(runner);
    const noteProfile = profile('create_note');
    if (session.matrixCorpusProfile === undefined) throw new Error('missing profile');
    session.matrixCorpusProfile.mockProfile = noteProfile;
    session.matrixCorpusProfile.mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    session.matrixCorpusProfile.expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    confirmationRepository.createOrGet.mockResolvedValue({
      ok: true,
      disposition: 'applied',
      confirmation: {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        confirmationId: expect.any(String) as unknown as string,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
        state: 'pending',
        toolName: 'create_note',
        toolArgs: { content: 'raw synthetic argument' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt: now,
        expiresAt: '2026-07-20T10:05:00.000Z',
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      },
    });

    await expect(
      service.executeVerifiedIngest({ claims: claims('create_note'), stableKeys })
    ).resolves.toEqual({ ok: true });
    expect(confirmationRepository.createOrGet).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'create_note',
        toolArgs: { content: 'raw synthetic argument' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
      })
    );
    const confirmationEvent = sessionRepository.appendMatrixCorpusEvent.mock.calls
      .map(([input]) => input.event)
      .find((event) => event.type === 'confirmation_requested');
    expect(confirmationEvent?.payload).not.toHaveProperty('toolArgs');
    expect(JSON.stringify(confirmationEvent)).not.toContain('raw synthetic argument');
  });

  it('handles a rejected exact confirmation with no runner or LLM construction', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() };
    const {
      service,
      session,
      confirmationRepository,
      createRunner,
      replyPublisher,
      sessionRepository,
    } = fixture(runner as unknown as IntexAgentRunner);
    const noteProfile = profile('create_note');
    if (session.matrixCorpusProfile === undefined) throw new Error('missing profile');
    session.matrixCorpusProfile.mockProfile = noteProfile;
    session.matrixCorpusProfile.mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    session.matrixCorpusProfile.expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    confirmationRepository.getExact.mockResolvedValue({
      ok: true,
      confirmation: {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        confirmationId: 'confirmation_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
        state: 'resolved',
        toolName: 'create_note',
        toolArgs: { content: 'raw synthetic argument' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt: now,
        expiresAt: '2026-07-20T10:05:00.000Z',
        decision: 'reject',
        resolutionMessageId: 'transport_message_1',
        resolvedAt: now,
      },
    });
    const confirmationClaims = claims('create_note', {
      phase: 'confirmation',
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
      pendingConfirmationId: 'confirmation_1',
      expectedDecision: 'reject',
    });

    await expect(
      service.executeVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toEqual({ ok: true });
    expect(createRunner).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.executeConfirmed).not.toHaveBeenCalled();
    expect(replyPublisher.publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Okay, I will not run this action.' })
    );
    const usageSummaries = sessionRepository.appendMatrixCorpusEvent.mock.calls
      .map(([append]) => append.event)
      .filter((event) => event.type === 'llm_usage_summary');
    expect(usageSummaries).toHaveLength(1);
    expect(usageSummaries[0]?.payload).toEqual({
      turnIndex: 0,
      status: 'complete',
      expectedCallCount: 0,
      reportedCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costNanoUsd: 0,
    });
  });

  it('executes an accepted confirmation with the exact stored selection and no normal runner call', async () => {
    const runner = {
      run: vi.fn(),
      executeConfirmed: vi
        .fn()
        .mockResolvedValueOnce({
          outcome: 'completed' as const,
          reply: 'Synthetic note saved.',
          toolName: 'create_note' as const,
          toolResult: { toolName: 'create_note', status: 'completed' },
          toolSelection: { turnIndex: 0, ordinal: 1 },
        })
        .mockResolvedValueOnce({
          outcome: 'no_action' as const,
          reply: 'The confirmed action no longer requires a tool.',
        }),
    };
    const { service, session, confirmationRepository, createRunner } = fixture(runner, {
      agentModel: 'or:minimax/minimax-m3',
    });
    const noteProfile = profile('create_note');
    if (session.matrixCorpusProfile === undefined) throw new Error('missing profile');
    session.matrixCorpusProfile.mockProfile = noteProfile;
    session.matrixCorpusProfile.mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    session.matrixCorpusProfile.expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    confirmationRepository.getExact.mockResolvedValue({
      ok: true,
      confirmation: {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        confirmationId: 'confirmation_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
        state: 'resolved',
        toolName: 'create_note',
        toolArgs: { content: 'raw synthetic argument' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt: now,
        expiresAt: '2026-07-20T10:05:00.000Z',
        decision: 'confirm',
        resolutionMessageId: 'transport_message_1',
        resolvedAt: now,
      },
    });
    const confirmationClaims = claims('create_note', {
      phase: 'confirmation',
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
      pendingConfirmationId: 'confirmation_1',
      expectedDecision: 'confirm',
    });

    await expect(
      service.executeVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toEqual({ ok: true });
    await expect(
      service.executeVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toEqual({ ok: true });
    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        agentModel: 'or:minimax/minimax-m3',
        execution: expect.objectContaining({
          flow: 'confirmation',
          preauthorizedSelection: {
            toolName: 'create_note',
            turnIndex: 0,
            ordinal: 1,
          },
        }),
      })
    );
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.executeConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'create_note',
        toolArgs: { content: 'raw synthetic argument' },
      })
    );
  });

  it('fails closed for unavailable session, event, and prompt dependencies', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;

    const missingSession = fixture(runner);
    missingSession.sessionRepository.getMatrixCorpusSessionExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      missingSession.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });

    const corruptEvents = fixture(runner);
    corruptEvents.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_SESSION',
    });
    await expect(
      corruptEvents.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });

    const missingContext = fixture(runner);
    missingContext.contextService.loadScenarioPromptContext.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      missingContext.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });
  });

  it.each([
    [
      'schedule',
      (session: IntexAgentSession): void => {
        matrixProfile(session).expectedToolSchedule = [];
      },
    ],
    [
      'profile',
      (session: IntexAgentSession): void => {
        matrixProfile(session).mockProfile = profile('create_note');
      },
    ],
    [
      'digest',
      (session: IntexAgentSession): void => {
        matrixProfile(session).mockProfileDigest = 'f'.repeat(64);
      },
    ],
  ] as const)('rejects a session/context %s mismatch', async (_name, mutate) => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const current = fixture(runner);
    mutate(current.session);

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'PROFILE_REJECTED' });
  });

  it.each([
    [{ outcome: 'completed', reply: 'Done.' }, null],
    [
      { outcome: 'tool_failed', reply: 'Failed.', toolName: 'query_calendar_events' },
      'tool_call_failed',
    ],
    [
      {
        outcome: 'tool_selection_rejected',
        reply: 'Rejected.',
        toolName: 'query_calendar_events',
        code: 'UNEXPECTED_KNOWN_TOOL',
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
      'tool_call_failed',
    ],
    [{ outcome: 'needs_clarification', reply: 'Clarify.' }, 'clarification_requested'],
    [{ outcome: 'unsupported', reply: 'Unsupported.' }, 'unsupported_request'],
    [{ outcome: 'no_action', reply: 'No action.' }, null],
  ] as const)('persists the closed result projection %#', async (result, expectedEventType) => {
    const runner = {
      run: vi.fn(async () => result as never),
      executeConfirmed: vi.fn(),
    } as unknown as IntexAgentRunner;
    const current = fixture(runner);

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });
    const eventTypes = current.sessionRepository.appendMatrixCorpusEvent.mock.calls.map(
      ([input]) => input.event.type
    );
    if (expectedEventType === null) expect(eventTypes).not.toContain('tool_call_failed');
    else expect(eventTypes).toContain(expectedEventType);
  });

  it('persists safe clarification metadata needed by the next Matrix turn', async () => {
    const runner = {
      run: vi.fn(async () => ({
        outcome: 'needs_clarification' as const,
        reply: 'Which date?',
        blockerReason: 'missing_required_details' as const,
        missingFields: ['date'],
        candidateIntents: ['create_calendar_event' as const],
        suggestedNextStep: 'Provide the date.',
        fallbackReason: 'llm_call_failed' as const,
        clarification: 'Which date?',
      })),
      executeConfirmed: vi.fn(),
    } as unknown as IntexAgentRunner;
    const current = fixture(runner);

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });

    const clarification = current.sessionRepository.appendMatrixCorpusEvent.mock.calls
      .map(([input]) => input.event)
      .find(({ type }) => type === 'clarification_requested');
    expect(clarification?.payload).toEqual({
      message: 'Which date?',
      blockerReason: 'missing_required_details',
      missingFields: ['date'],
      candidateIntents: ['create_calendar_event'],
      suggestedNextStep: 'Provide the date.',
      fallbackReason: 'llm_call_failed',
      clarification: 'Which date?',
    });
  });

  it.each([
    ['begin', 'beginReplyCompletion', 'CORRELATION_REJECTED'],
    ['reserve', 'reserveReplyPublication', 'CORRELATION_REJECTED'],
    ['accept', 'acceptReplyPublication', 'REPLY_PUBLICATION_REJECTED'],
  ] as const)('fails safely when reply %s persistence rejects', async (_name, method, code) => {
    const runner = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
      executeConfirmed: vi.fn(),
    };
    const current = fixture(runner);
    current.receiptRepository[method].mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    } as never);

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code });
  });

  it.each(['', 'x'.repeat(513)])(
    'rejects an invalid publication receipt id without accepting it: %s',
    async (publicationReceiptId) => {
      const runner = {
        run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
        executeConfirmed: vi.fn(),
      };
      const current = fixture(runner);
      current.replyPublisher.publishReplyWithReceipt.mockResolvedValueOnce({
        publicationReceiptId,
      });

      await expect(
        current.service.executeVerifiedIngest({
          claims: claims('query_calendar_events'),
          stableKeys,
        })
      ).resolves.toEqual({ ok: false, code: 'REPLY_PUBLICATION_REJECTED' });
      expect(current.receiptRepository.acceptReplyPublication).not.toHaveBeenCalled();
    }
  );

  it('throws when a required session event cannot be persisted', async () => {
    const runner = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
      executeConfirmed: vi.fn(),
    };
    const current = fixture(runner);
    current.sessionRepository.appendMatrixCorpusEvent.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus provider usage summary persistence failed');
  });

  it('rejects malformed confirmation results before executing or publishing them', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const invalidContext = fixture(runner);
    const validConfirmationClaims = claims('query_calendar_events', {
      phase: 'confirmation',
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
      pendingConfirmationId: 'confirmation_1',
      expectedDecision: 'confirm',
    });
    const malformedConfirmationClaims = {
      ...validConfirmationClaims,
      payload: {
        ...validConfirmationClaims.payload,
        context: { ...validConfirmationClaims.payload.context, pendingConfirmationId: null },
      },
    } as unknown as IngestClaims;
    await expect(
      invalidContext.service.executeVerifiedIngest({
        claims: malformedConfirmationClaims,
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'CONFIRMATION_REJECTED' });

    for (const exact of [
      { ok: false, code: 'NOT_FOUND' },
      resolvedConfirmation({ state: 'pending' }),
      resolvedConfirmation({ decision: 'reject' }),
      resolvedConfirmation({ resolutionMessageId: 'other' }),
      resolvedConfirmation({ resolvedAt: '2026-07-20T10:00:01.000Z' }),
    ]) {
      const current = fixture(runner);
      const noteProfile = profile('create_note');
      matrixProfile(current.session).mockProfile = noteProfile;
      matrixProfile(current.session).mockProfileDigest = sha256(
        canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
      );
      matrixProfile(current.session).expectedToolSchedule = [
        { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
      ];
      current.confirmationRepository.getExact.mockResolvedValueOnce(exact as never);
      await expect(
        current.service.executeVerifiedIngest({
          claims: claims('create_note', {
            phase: 'confirmation',
            startNewSession: false,
            expectedSessionId: stableKeys.sessionId,
            pendingConfirmationId: 'confirmation_1',
            expectedDecision: 'confirm',
          }),
          stableKeys,
        })
      ).resolves.toEqual({ ok: false, code: 'CONFIRMATION_REJECTED' });
    }
  });

  it('rejects a confirmed tool selection absent from the expected schedule', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const current = fixture(runner);
    const noteProfile = profile('create_note');
    matrixProfile(current.session).mockProfile = noteProfile;
    matrixProfile(current.session).mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    matrixProfile(current.session).expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    current.confirmationRepository.getExact.mockResolvedValueOnce(
      resolvedConfirmation({ selectionOrdinal: 2 })
    );

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('create_note', {
          phase: 'confirmation',
          startNewSession: false,
          expectedSessionId: stableKeys.sessionId,
          pendingConfirmationId: 'confirmation_1',
          expectedDecision: 'confirm',
        }),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'CONFIRMATION_REJECTED' });
  });

  it('rejects confirmation creation without selection metadata or durable persistence', async () => {
    const missingSelection = fixture({
      run: vi.fn(async () => ({
        outcome: 'needs_confirmation' as const,
        reply: 'Confirm.',
        toolName: 'create_note' as const,
        toolArgs: {},
      })),
      executeConfirmed: vi.fn(),
    } as unknown as IntexAgentRunner);
    const noteProfile = profile('create_note');
    matrixProfile(missingSelection.session).mockProfile = noteProfile;
    matrixProfile(missingSelection.session).mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    matrixProfile(missingSelection.session).expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    await expect(
      missingSelection.service.executeVerifiedIngest({ claims: claims('create_note'), stableKeys })
    ).rejects.toThrow('Matrix corpus confirmation is missing strict selection metadata');

    const persistence = fixture({
      run: vi.fn(async () => ({
        outcome: 'needs_confirmation' as const,
        reply: 'Confirm.',
        toolName: 'create_note' as const,
        toolArgs: {},
        toolSelection: { turnIndex: 0, ordinal: 1 },
      })),
      executeConfirmed: vi.fn(),
    });
    matrixProfile(persistence.session).mockProfile = noteProfile;
    matrixProfile(persistence.session).mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    matrixProfile(persistence.session).expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    persistence.confirmationRepository.createOrGet.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(
      persistence.service.executeVerifiedIngest({ claims: claims('create_note'), stableKeys })
    ).rejects.toThrow('Matrix corpus confirmation persistence failed');
  });

  it('validates every reserved-reply identity and publication binding during recovery', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const verified = claims('query_calendar_events');
    const base = reservedReceipt(verified, 'Persisted synthetic reply.');
    const reply = base.publication.replies[0];
    if (reply === undefined) throw new Error('reserved reply fixture missing');
    const mutations: MatrixCorpusIngestReceipt[] = [
      { ...base, state: 'processing' },
      { ...base, ingestReceiptId: 'other' },
      { ...base, runId: 'other' },
      { ...base, scenarioId: 'other' },
      { ...base, turnIndex: 1 },
      { ...base, leaseFence: '8' },
      { ...base, payloadDigest: 'f'.repeat(64) },
      { ...base, sessionId: 'other' },
      { ...base, publication: { ...base.publication, phase: 'open' } },
      { ...base, publication: { ...base.publication, expectedReplyDigests: null } },
      { ...base, publication: { ...base.publication, expectedReplyDigests: [] } },
      { ...base, publication: { ...base.publication, replies: [] } },
      {
        ...base,
        publication: { ...base.publication, replies: [{ ...reply, replyIndex: 1 }] },
      },
    ];
    for (const receipt of mutations) {
      const current = fixture(runner);
      await expect(
        current.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
      ).resolves.toEqual({ ok: false, code: 'CORRELATION_REJECTED' });
      expect(current.replyPublisher.publishReplyWithReceipt).not.toHaveBeenCalled();
    }

    const accepted = fixture(runner);
    await expect(
      accepted.service.recoverVerifiedIngest({
        claims: verified,
        stableKeys,
        receipt: {
          ...base,
          publication: {
            ...base.publication,
            replies: [{ ...reply, state: 'accepted', publicationReceiptDigest: 'a'.repeat(64) }],
          },
        },
      })
    ).resolves.toEqual({ ok: true });
    expect(accepted.replyPublisher.publishReplyWithReceipt).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted reply evidence and invalid recovery publication outcomes', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const verified = claims('query_calendar_events');
    const replyText = 'Persisted synthetic reply.';
    const receipt = reservedReceipt(verified, replyText);
    const assistant = {
      id: stableKeys.replyId,
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      type: 'assistant_message' as const,
      payload: { text: replyText },
      createdAt: now,
      eventSequence: 2,
    };

    const eventSets = [
      [],
      [assistant, { ...assistant }],
      [{ ...assistant, type: 'user_message' as const }],
      [{ ...assistant, payload: { text: replyText, extra: true } }],
      [{ ...assistant, payload: { text: 3 } }],
    ];
    for (const events of eventSets) {
      const current = fixture(runner);
      current.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
        ok: true,
        events: events as never,
      });
      await expect(
        current.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
      ).resolves.toEqual({ ok: false, code: 'CORRELATION_REJECTED' });
    }

    const publisherFailure = fixture(runner);
    publisherFailure.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [assistant],
    });
    publisherFailure.replyPublisher.publishReplyWithReceipt.mockRejectedValueOnce(
      new Error('private publisher failure')
    );
    await expect(
      publisherFailure.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: false, code: 'REPLY_PUBLICATION_REJECTED' });

    for (const publicationReceiptId of ['', 'x'.repeat(513)]) {
      const invalidReceipt = fixture(runner);
      invalidReceipt.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
        ok: true,
        events: [assistant],
      });
      invalidReceipt.replyPublisher.publishReplyWithReceipt.mockResolvedValueOnce({
        publicationReceiptId,
      });
      await expect(
        invalidReceipt.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
      ).resolves.toEqual({ ok: false, code: 'REPLY_PUBLICATION_REJECTED' });
    }

    const acceptanceFailure = fixture(runner);
    acceptanceFailure.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [assistant],
    });
    acceptanceFailure.receiptRepository.acceptReplyPublication.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(
      acceptanceFailure.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: false, code: 'REPLY_PUBLICATION_REJECTED' });
  });

  it('requires both exact session surfaces while recovering a reserved reply', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const verified = claims('query_calendar_events');
    const receipt = reservedReceipt(verified, 'Persisted synthetic reply.');
    const missingSession = fixture(runner);
    missingSession.sessionRepository.getMatrixCorpusSessionExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      missingSession.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });

    const missingEvents = fixture(runner);
    missingEvents.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      missingEvents.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });
  });

  it('recovers confirmation buttons only from one exactly correlated persisted event', async () => {
    const runner = { run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner;
    const verified = claims('query_calendar_events');
    const replyText = 'Persisted synthetic reply.';
    const receipt = reservedReceipt(verified, replyText);
    const assistant = {
      id: stableKeys.replyId,
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      type: 'assistant_message' as const,
      payload: { text: replyText },
      createdAt: now,
      eventSequence: 1,
    };
    const confirmation = {
      id: 'confirmation_event_1',
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      type: 'confirmation_requested' as const,
      payload: {
        confirmationId: 'confirmation_1',
        sourceMessageId: 'transport_message_1',
        message: replyText,
      },
      createdAt: now,
      eventSequence: 2,
    };
    const current = fixture(runner);
    current.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [
        assistant,
        { ...confirmation, payload: { ...confirmation.payload, sourceMessageId: 'other' } },
        { ...confirmation, payload: { ...confirmation.payload, message: 'other' } },
        confirmation,
      ],
    });
    await expect(
      current.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
    ).resolves.toEqual({ ok: true });
    expect(current.replyPublisher.publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: [
          { type: 'reply', reply: { id: 'intex_confirm:confirmation_1:yes', title: 'Yes' } },
          { type: 'reply', reply: { id: 'intex_confirm:confirmation_1:no', title: 'No' } },
        ],
      })
    );

    for (const events of [
      [assistant, confirmation, { ...confirmation, id: 'confirmation_event_2' }],
      [assistant, { ...confirmation, payload: { ...confirmation.payload, confirmationId: 3 } }],
    ]) {
      const rejected = fixture(runner);
      rejected.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
        ok: true,
        events: events as never,
      });
      await expect(
        rejected.service.recoverVerifiedIngest({ claims: verified, stableKeys, receipt })
      ).resolves.toEqual({ ok: false, code: 'CORRELATION_REJECTED' });
    }
  });

  it('persists optional confirmation summaries and completed tools without optional result fields', async () => {
    const confirmationRunner = {
      run: vi.fn(async () => ({
        outcome: 'needs_confirmation' as const,
        reply: 'Confirm.',
        summary: 'Safe synthetic summary',
        toolName: 'create_note' as const,
        toolArgs: {},
        toolSelection: { turnIndex: 0, ordinal: 1 },
      })),
      executeConfirmed: vi.fn(),
    };
    const confirmationFixture = fixture(confirmationRunner);
    const noteProfile = profile('create_note');
    matrixProfile(confirmationFixture.session).mockProfile = noteProfile;
    matrixProfile(confirmationFixture.session).mockProfileDigest = sha256(
      canonicalMatrixCorpusStrictToolMockProfileV1(noteProfile)
    );
    matrixProfile(confirmationFixture.session).expectedToolSchedule = [
      { turnIndex: 0, toolName: 'create_note', ordinal: 1 },
    ];
    confirmationFixture.confirmationRepository.createOrGet.mockResolvedValueOnce({
      ok: true,
      disposition: 'applied',
      confirmation: {} as never,
    });
    await expect(
      confirmationFixture.service.executeVerifiedIngest({
        claims: claims('create_note'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });
    expect(confirmationFixture.sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'confirmation_requested',
          payload: expect.objectContaining({ summary: 'Safe synthetic summary' }),
        }),
      })
    );

    const completed = fixture({
      run: vi.fn(async () => ({
        outcome: 'completed' as const,
        reply: 'Done.',
        toolName: 'query_calendar_events' as const,
      })),
      executeConfirmed: vi.fn(),
    } as unknown as IntexAgentRunner);
    await expect(
      completed.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });
    expect(completed.sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'tool_call_completed',
          payload: expect.objectContaining({ facts: [] }),
        }),
      })
    );
  });

  it('exercises the strict expected-selection callback and rejects assistant-event persistence loss', async () => {
    const fallback = {
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Reply.' })),
      executeConfirmed: vi.fn(),
    };
    const callback = fixture(fallback);
    callback.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        const expectedByCatalog = input.execution.expectedByCatalog;
        if (expectedByCatalog === undefined) throw new Error('expected catalog callback missing');
        expect(
          expectedByCatalog({
            turnIndex: 0,
            toolName: 'query_calendar_events',
            ordinal: 1,
          })
        ).toBe(true);
        expect(
          expectedByCatalog({
            turnIndex: 0,
            toolName: 'query_calendar_events',
            ordinal: 2,
          })
        ).toBe(false);
        return { outcome: 'no_action' as const, reply: 'Reply.' };
      }),
    }));
    await expect(
      callback.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).resolves.toEqual({ ok: true });

    const persistence = fixture(fallback);
    persistence.sessionRepository.appendMatrixCorpusEvent.mockImplementation(async (input) =>
      input.event.type === 'assistant_message'
        ? { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' }
        : { ok: true, disposition: 'applied', sequence: 2 }
    );
    await expect(
      persistence.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus event persistence failed');

    const boundaryPersistence = fixture(fallback);
    boundaryPersistence.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        await input.execution.recordExecutionBoundary('no_executor_required');
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    boundaryPersistence.sessionRepository.appendMatrixCorpusEvent.mockImplementation(
      async (input) =>
        input.event.type === 'matrix_corpus_execution_boundary'
          ? { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' }
          : { ok: true, disposition: 'applied', sequence: 2 }
    );
    await expect(
      boundaryPersistence.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus execution boundary persistence failed');
  });

  it('rejects a sixty-first distinct expected provider call', async () => {
    const fallback = { run: vi.fn(), executeConfirmed: vi.fn() };
    const current = fixture(fallback as unknown as IntexAgentRunner);
    current.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        for (let callOrdinal = 1; callOrdinal <= 60; callOrdinal += 1) {
          input.execution.registerExpectedProviderCall({
            version: 1,
            runId: 'run_1',
            scenarioId: 'scenario_001',
            sessionId: stableKeys.sessionId,
            turnIndex: 0,
            stage: 'agent_generation',
            callOrdinal,
          });
        }
        input.execution.registerExpectedProviderCall({
          version: 1,
          runId: 'run_1',
          scenarioId: 'scenario_001',
          sessionId: stableKeys.sessionId,
          turnIndex: 0,
          stage: 'intent_classification',
          callOrdinal: 1,
        });
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));

    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus expected provider usage limit exceeded');
  });

  it.each([
    ['run id', { runId: 'other' }],
    ['scenario id', { scenarioId: 'other' }],
    ['session id', { sessionId: 'other' }],
    ['turn index', { turnIndex: 1 }],
    ['zero ordinal', { callOrdinal: 0 }],
    ['excessive ordinal', { callOrdinal: 61 }],
  ] as const)('rejects provider usage with changed %s', async (_name, overrides) => {
    const fallback = { run: vi.fn(), executeConfirmed: vi.fn() };
    const current = fixture(fallback as unknown as IntexAgentRunner);
    current.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        input.execution.registerExpectedProviderCall({
          version: 1,
          runId: 'run_1',
          scenarioId: 'scenario_001',
          sessionId: stableKeys.sessionId,
          turnIndex: 0,
          stage: 'agent_generation',
          callOrdinal: 1,
          ...overrides,
        });
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus provider usage context rejected');
  });

  it.each([
    ['model', { modelId: 'or:minimax/minimax-m3' }],
    ['input tokens', { inputTokens: -1 }],
    ['output tokens', { outputTokens: 1.5 }],
    ['total tokens', { totalTokens: -1 }],
    ['token sum', { totalTokens: 99 }],
    ['missing cost', { providerReportedUsd: undefined }],
    ['invalid cost', { providerReportedUsd: Number.NaN }],
  ] as const)('rejects uncorrelated provider usage field: %s', async (_name, overrides) => {
    const fallback = { run: vi.fn(), executeConfirmed: vi.fn() };
    const current = fixture(fallback as unknown as IntexAgentRunner);
    current.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        await input.execution.recordProviderCall({
          context: {
            version: 1,
            runId: 'run_1',
            scenarioId: 'scenario_001',
            sessionId: stableKeys.sessionId,
            turnIndex: 0,
            stage: 'agent_generation',
            callOrdinal: 1,
          },
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          providerReportedUsd: 0,
          ...overrides,
        } as never);
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    await expect(
      current.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow(/Matrix corpus provider (usage correlation|cost) rejected/u);
  });

  it('rejects changed usage replay, usage persistence loss, and incomplete successful projection', async () => {
    const context = {
      version: 1 as const,
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: stableKeys.sessionId,
      turnIndex: 0,
      stage: 'agent_generation' as const,
      callOrdinal: 1,
    };
    const replay = fixture({ run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner);
    replay.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        await input.execution.recordProviderCall({
          context,
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          providerReportedUsd: 0,
        });
        await input.execution.recordProviderCall({
          context,
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
          providerReportedUsd: 0,
        });
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    await expect(
      replay.service.executeVerifiedIngest({ claims: claims('query_calendar_events'), stableKeys })
    ).rejects.toThrow('Matrix corpus provider usage replay conflict');

    const persistence = fixture({ run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner);
    persistence.sessionRepository.appendMatrixCorpusEvent.mockImplementation(async (input) =>
      input.event.type === 'llm_call_usage'
        ? { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' }
        : { ok: true, disposition: 'applied', sequence: 2 }
    );
    persistence.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        await input.execution.recordProviderCall({
          context,
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          providerReportedUsd: 0,
        });
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    await expect(
      persistence.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus provider usage persistence failed');

    const incomplete = fixture({ run: vi.fn(), executeConfirmed: vi.fn() } as unknown as IntexAgentRunner);
    incomplete.createRunner.mockImplementationOnce((input) => ({
      executeConfirmed: vi.fn(),
      run: vi.fn(async () => {
        input.execution.registerExpectedProviderCall(context);
        return { outcome: 'no_action' as const, reply: 'unreachable' };
      }),
    }));
    await expect(
      incomplete.service.executeVerifiedIngest({
        claims: claims('query_calendar_events'),
        stableKeys,
      })
    ).rejects.toThrow('Matrix corpus provider usage projection rejected');
  });
});
