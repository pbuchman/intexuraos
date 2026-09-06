import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type MatrixCorpusAttestationClaimsV1,
  type MatrixCorpusAttestedIngestPayloadV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createMatrixCorpusToolCallStartedRecorder,
  createMatrixCorpusMessageHandler,
  type MatrixCorpusMessageHandlerDeps,
} from '../../../domain/matrixCorpus/matrixCorpusMessageHandler.js';
import type { MatrixCorpusContextService } from '../../../domain/matrixCorpus/contextService.js';
import type { TestConfirmationRepository } from '../../../domain/matrixCorpus/ports/testConfirmationRepository.js';
import type {
  MatrixCorpusSession,
  MatrixCorpusSessionRepository,
} from '../../../domain/ports/sessionRepository.js';
import type { IntexAgentMatrixCorpusProfileV1 } from '../../../domain/sessions/types.js';

const operationTime = '2026-07-20T10:00:00.000Z';

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function mockProfile(): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function payload(
  contextOverrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusAttestedIngestPayloadV1 {
  const profile = mockProfile();
  return {
    version: 1,
    kind: 'matrix_corpus_ingest_payload',
    ordinaryIngest: {
      type: 'intex.message.ingest',
      userId: 'auth0:user_1',
      messageId: 'transport_message_1',
      text: 'Zapisz testową notatkę.',
      sourceType: 'whatsapp_text',
      timestamp: operationTime,
    },
    context: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      ingestReceiptId: 'receipt_1',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      turnIndex: 0,
      phase: 'start',
      startNewSession: true,
      promptNormalizationVersion: 1,
      promptDigest: '1'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: profile,
      mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(profile)),
      expectedToolSchedule: [],
      currentDateTime: operationTime,
      timeZone: 'Europe/Warsaw',
      ...contextOverrides,
    },
  };
}

function claims(payloadValue = payload()): IngestClaims {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest',
    issuer: 'whatsapp-service',
    audience: 'intex-agent',
    runtimeAudience: 'hetzner-prod',
    keyVersion: 'key_v1',
    eventId: payloadValue.context.ingestReceiptId,
    leaseFence: payloadValue.context.leaseFence,
    payloadDigest: sha256(canonicalMatrixCorpusIngestPayloadV1(payloadValue)),
    issuedAt: operationTime,
    expiresAt: '2026-07-20T10:05:00.000Z',
    payload: payloadValue,
  };
}

const stableKeys = {
  sessionId: 'matrix_session_1',
  eventId: 'matrix_event_1',
  toolCallId: 'matrix_tool_1',
  replyId: 'matrix_reply_1',
} as const;

function expectedProfile(): IntexAgentMatrixCorpusProfileV1 {
  const profile = mockProfile();
  return {
    version: 1 as const,
    kind: 'matrix_corpus' as const,
    runtimeAudience: 'hetzner-prod' as const,
    leaseFence: '7',
    runId: 'run_1',
    scenarioId: 'scenario_001',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario 001/020',
    executionMode: 'strict_mock_tools' as const,
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    promptPreferencesVersion: 2,
    promptPreferencesDigest: 'b'.repeat(64),
    userTimeZone: 'Europe/Warsaw',
    mockProfile: profile,
    mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(profile)),
    expectedToolSchedule: [],
  };
}

function existingSession(overrides: Partial<MatrixCorpusSession> = {}): MatrixCorpusSession {
  return {
    id: stableKeys.sessionId,
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: operationTime,
    lastUserMessageAt: operationTime,
    startReason: 'no_active_session',
    matrixCorpusProfile: expectedProfile(),
    lastEventSequence: 0,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred Vitest mock methods stay strongly typed for assertions
function fixture(session = existingSession()) {
  const contextService = {
    registerScenario: vi.fn<MatrixCorpusContextService['registerScenario']>(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      snapshot: {
        baselinePromptPreferencesDigest: 'b'.repeat(64),
        overlayVersion: 0,
        overlayDigest: 'c'.repeat(64),
        expiresAt: '2026-07-21T10:00:00.000Z',
      },
    })),
    loadScenarioPromptContext: vi.fn<MatrixCorpusContextService['loadScenarioPromptContext']>(async () => ({
      ok: true as const,
      promptContext: '{"version":1,"userPreferences":null}',
      overlayVersion: 0,
      overlayDigest: 'c'.repeat(64),
    })),
    loadSessionProfileSnapshot: vi.fn<MatrixCorpusContextService['loadSessionProfileSnapshot']>(async () => ({
      ok: true as const,
      snapshot: {
        promptPreferencesVersion: 2,
        promptPreferencesDigest: 'b'.repeat(64),
        agentModel: 'or:deepseek/deepseek-v4-flash' as const,
        evaluatorModel: 'or:minimax/minimax-m3' as const,
        userTimeZone: 'Europe/Warsaw',
      },
    })),
  };
  const sessionRepository = {
    createMatrixCorpusSession: vi.fn<MatrixCorpusSessionRepository['createMatrixCorpusSession']>(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      session,
    })),
    getMatrixCorpusSessionExact: vi.fn<MatrixCorpusSessionRepository['getMatrixCorpusSessionExact']>(async () => ({ ok: true as const, session })),
    updateMatrixCorpusSessionExact: vi.fn<MatrixCorpusSessionRepository['updateMatrixCorpusSessionExact']>(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      session,
    })),
    appendMatrixCorpusEvent: vi.fn<MatrixCorpusSessionRepository['appendMatrixCorpusEvent']>(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      sequence: 1,
    })),
    listMatrixCorpusEventsExact: vi.fn<MatrixCorpusSessionRepository['listMatrixCorpusEventsExact']>(async () => ({ ok: true as const, events: [] })),
  };
  const confirmationRepository = {
    resolveExact: vi.fn<TestConfirmationRepository['resolveExact']>(async (input) => ({
      ok: true as const,
      disposition: 'applied' as const,
      confirmation: {
        version: 1 as const,
        lane: 'matrix_corpus' as const,
        runtimeAudience: 'hetzner-prod' as const,
        confirmationId: 'confirmation_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
        state: 'resolved' as const,
        toolName: 'create_note' as const,
        toolArgs: { content: 'Synthetic Matrix note' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt: operationTime,
        expiresAt: '2026-07-20T10:05:00.000Z',
        decision: input.decision,
        resolutionMessageId: input.resolutionMessageId,
        resolvedAt: input.now,
      },
    })),
  };
  const deps = {
    contextService,
    sessionRepository,
    confirmationRepository,
  } as unknown as MatrixCorpusMessageHandlerDeps;
  return {
    contextService,
    sessionRepository,
    confirmationRepository,
    handler: createMatrixCorpusMessageHandler(deps),
  };
}

describe('Matrix corpus message handler', () => {
  it('records sanitized tool selection durably with an idempotent deterministic event id', async () => {
    const { sessionRepository } = fixture();
    const identity = {
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      leaseFence: '7',
    };
    const recorder = createMatrixCorpusToolCallStartedRecorder({
      sessionRepository,
      identity,
      ingestReceiptId: 'receipt_1',
      createdAt: operationTime,
    });
    const selection = {
      toolName: 'create_note' as const,
      turnIndex: 0,
      ordinal: 1,
      facts: [{ name: 'contentLength' as const, value: 20 }],
    };

    await recorder(selection);
    await recorder(selection);

    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledTimes(2);
    const first = sessionRepository.appendMatrixCorpusEvent.mock.calls[0]?.[0];
    const second = sessionRepository.appendMatrixCorpusEvent.mock.calls[1]?.[0];
    expect(first?.event.id).toMatch(/^imc_tool_[0-9a-f]{32}$/u);
    expect(second?.event.id).toBe(first?.event.id);
    expect(first?.event.payload).toEqual({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      turnIndex: 0,
      toolName: 'create_note',
      ordinal: 1,
      status: 'started',
      facts: selection.facts,
    });
    expect(JSON.stringify(first)).not.toContain('private note content');
  });

  it('fails closed when durable tool-selection evidence cannot be appended', async () => {
    const { sessionRepository } = fixture();
    sessionRepository.appendMatrixCorpusEvent.mockResolvedValue({
      ok: false,
      code: 'SEQUENCE_CONFLICT',
    });
    const recorder = createMatrixCorpusToolCallStartedRecorder({
      sessionRepository,
      identity: {
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
      },
      ingestReceiptId: 'receipt_1',
      createdAt: operationTime,
    });

    await expect(
      recorder({
        toolName: 'create_note',
        turnIndex: 0,
        ordinal: 1,
        facts: [{ name: 'contentLength', value: 20 }],
      })
    ).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'TOOL_CALL_EVIDENCE_REJECTED',
    });
  });

  it('creates the exact isolated session and first user event from a verified start ingest', async () => {
    const { contextService, sessionRepository, confirmationRepository, handler } = fixture();
    sessionRepository.appendMatrixCorpusEvent
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'applied',
        sequence: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'applied',
        sequence: 2,
      });

    await expect(handler.prepareVerifiedIngest({ claims: claims(), stableKeys })).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 2,
    });
    expect(contextService.registerScenario).toHaveBeenCalledWith({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
      preferenceOverlayMode: 'account_snapshot',
    });
    expect(sessionRepository.createMatrixCorpusSession).toHaveBeenCalledWith({
      identity: {
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
      },
      session: expect.objectContaining({
        id: stableKeys.sessionId,
        matrixCorpusProfile: expectedProfile(),
        lastEventSequence: 0,
      }),
      now: operationTime,
    });
    expect(sessionRepository.getMatrixCorpusSessionExact).not.toHaveBeenCalled();
    expect(confirmationRepository.resolveExact).not.toHaveBeenCalled();
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(1, {
      identity: expect.objectContaining({ sessionId: stableKeys.sessionId }),
      event: expect.objectContaining({
        id: expect.stringMatching(/^imc_session_started_[0-9a-f]{32}$/u),
        type: 'session_started',
        payload: {
          reason: 'no_active_session',
          explicit: false,
        },
      }),
      now: operationTime,
    });
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(2, {
      identity: expect.objectContaining({ sessionId: stableKeys.sessionId }),
      event: expect.objectContaining({
        id: stableKeys.eventId,
        type: 'user_message',
        payload: expect.objectContaining({ phase: 'start', text: 'Zapisz testową notatkę.' }),
      }),
      sessionUpdate: {
        status: 'active',
        lastUserMessageAt: operationTime,
      },
      now: operationTime,
    });
    expect(sessionRepository.updateMatrixCorpusSessionExact).not.toHaveBeenCalled();
    expect(sessionRepository.listMatrixCorpusEventsExact).not.toHaveBeenCalled();
  });

  it.each([
    'add_user_preference',
    'update_user_preference',
    'delete_user_preference',
  ] as const)(
    'requests a pristine preference overlay when the signed schedule contains %s',
    async (toolName) => {
    const profile: StrictToolMockProfileV1 = {
      ...mockProfile(),
      calls: [
        {
          turnIndex: 1,
          toolName,
          ordinal: 1,
          outcome: {
            kind: 'success',
            result: {
              toolName,
              status: 'completed',
              currentVersion: 1,
              changedItemId: 'mock_pref_synthetic',
            },
          },
        },
      ],
    };
    const mutationPayload = payload({
      mockProfile: profile,
      mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(profile)),
      expectedToolSchedule: [
        { turnIndex: 1, toolName, ordinal: 1 },
      ],
    });
    const { contextService, handler } = fixture();

    await expect(
      handler.prepareVerifiedIngest({ claims: claims(mutationPayload), stableKeys })
    ).resolves.toMatchObject({ ok: true });
    expect(contextService.registerScenario).toHaveBeenCalledWith({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
      preferenceOverlayMode: 'pristine_v0',
    });
    }
  );

  it('starts an idle explicit new session without recording the command as a user message', async () => {
    const { sessionRepository, handler } = fixture();
    const idlePayload = payload();
    const idleClaims = claims({
      ...idlePayload,
      ordinaryIngest: {
        ...idlePayload.ordinaryIngest,
        text: 'new session',
      },
    });

    await expect(
      handler.prepareVerifiedIngest({ claims: idleClaims, stableKeys })
    ).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 1,
    });
    expect(sessionRepository.createMatrixCorpusSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          startReason: 'user_requested_new_session',
        }),
      })
    );
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledOnce();
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith({
      identity: expect.objectContaining({ sessionId: stableKeys.sessionId }),
      event: expect.objectContaining({
        id: stableKeys.eventId,
        type: 'session_started',
        payload: {
          reason: 'user_requested_new_session',
          explicit: true,
        },
      }),
      now: operationTime,
    });
  });

  it('returns already applied when every idle new-session mutation is an exact replay', async () => {
    const { contextService, sessionRepository, handler } = fixture();
    contextService.registerScenario.mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      snapshot: {
        baselinePromptPreferencesDigest: 'b'.repeat(64),
        overlayVersion: 0,
        overlayDigest: 'c'.repeat(64),
        expiresAt: '2026-07-21T10:00:00.000Z',
      },
    });
    sessionRepository.createMatrixCorpusSession.mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      session: existingSession({ startReason: 'user_requested_new_session' }),
    });
    sessionRepository.appendMatrixCorpusEvent.mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      sequence: 1,
    });
    const idlePayload = payload();
    const idleClaims = claims({
      ...idlePayload,
      ordinaryIngest: {
        ...idlePayload.ordinaryIngest,
        text: 'new session',
      },
    });

    await expect(
      handler.prepareVerifiedIngest({ claims: idleClaims, stableKeys })
    ).resolves.toEqual({
      ok: true,
      disposition: 'already_applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 1,
    });
  });

  it('records a logical supersession before processing an explicit prefixed restart request', async () => {
    const { sessionRepository, handler } = fixture(
      existingSession({ status: 'waiting_for_user', lastEventSequence: 4 })
    );
    sessionRepository.appendMatrixCorpusEvent
      .mockResolvedValueOnce({ ok: true, disposition: 'applied', sequence: 5 })
      .mockResolvedValueOnce({ ok: true, disposition: 'applied', sequence: 6 })
      .mockResolvedValueOnce({ ok: true, disposition: 'applied', sequence: 7 });
    const base = payload({
      phase: 'turn',
      turnIndex: 1,
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
    });
    const restartPayload: MatrixCorpusAttestedIngestPayloadV1 = {
      ...base,
      ordinaryIngest: {
        ...base.ordinaryIngest,
        text: 'new session: remember the backup code',
      },
    };

    await expect(
      handler.prepareVerifiedIngest({ claims: claims(restartPayload), stableKeys })
    ).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 7,
    });

    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledTimes(3);
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'session_closed',
          payload: {
            reason: 'superseded_by_user',
            status: 'superseded',
          },
        }),
      })
    );
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'session_started',
          payload: {
            reason: 'user_requested_new_session',
            explicit: true,
          },
        }),
        sessionUpdate: expect.objectContaining({
          status: 'active',
          startReason: 'user_requested_new_session',
          activeTool: null,
        }),
      })
    );
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'user_message',
          payload: expect.objectContaining({
            text: 'new session: remember the backup code',
            turnIndex: 1,
          }),
        }),
      })
    );
  });

  it('continues only the exact expected test session and reuses the committed event sequence', async () => {
    const session = existingSession({ lastEventSequence: 4 });
    const { contextService, sessionRepository, handler } = fixture(session);
    sessionRepository.appendMatrixCorpusEvent.mockResolvedValue({
      ok: true,
      disposition: 'already_applied',
      sequence: 4,
    });
    const turnClaims = claims(
      payload({
        turnIndex: 1,
        phase: 'turn',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
      })
    );

    await expect(
      handler.prepareVerifiedIngest({ claims: turnClaims, stableKeys })
    ).resolves.toEqual({
      ok: true,
      disposition: 'already_applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 4,
    });
    expect(contextService.registerScenario).not.toHaveBeenCalled();
    expect(contextService.loadScenarioPromptContext).toHaveBeenCalledOnce();
    expect(sessionRepository.createMatrixCorpusSession).not.toHaveBeenCalled();
    expect(sessionRepository.getMatrixCorpusSessionExact).toHaveBeenCalledWith({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: stableKeys.sessionId,
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({ now: operationTime })
    );
    expect(sessionRepository.listMatrixCorpusEventsExact).not.toHaveBeenCalled();
  });

  it('uses the exact test-confirmation lane and records the attested decision without interpretation', async () => {
    const { confirmationRepository, sessionRepository, handler } = fixture();
    const confirmationClaims = claims(
      payload({
        phase: 'confirmation',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'confirm',
      })
    );

    await expect(
      handler.prepareVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toMatchObject({ ok: true, sessionId: stableKeys.sessionId });
    expect(confirmationRepository.resolveExact).toHaveBeenCalledWith({
      identity: {
        confirmationId: 'confirmation_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: stableKeys.sessionId,
        userId: 'auth0:user_1',
        leaseFence: '7',
      },
      decision: 'confirm',
      resolutionMessageId: 'transport_message_1',
      now: operationTime,
    });
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'confirmation_resolved',
          payload: {
            phase: 'confirmation',
            confirmationId: 'confirmation_1',
            resolution: 'accepted',
            sourceMessageId: 'transport_message_1',
            turnIndex: 0,
          },
        }),
      })
    );
  });

  it('resumes event persistence after an exact confirmation-resolution retry', async () => {
    const { confirmationRepository, sessionRepository, handler } = fixture();
    confirmationRepository.resolveExact.mockResolvedValue({
      ok: true,
      disposition: 'already_applied',
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
        toolArgs: { content: 'private' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt: '2026-07-20T09:59:00.000Z',
        expiresAt: '2026-07-20T10:04:00.000Z',
        decision: 'confirm',
        resolutionMessageId: 'transport_message_1',
        resolvedAt: operationTime,
      },
    });
    const confirmationClaims = claims(
      payload({
        phase: 'confirmation',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'confirm',
      })
    );

    await expect(
      handler.prepareVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toMatchObject({ ok: true, sessionId: stableKeys.sessionId });
    expect(sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledOnce();
  });

  it('fails closed before mutation when the session profile or mock digest does not match', async () => {
    const changed = existingSession({
      matrixCorpusProfile: { ...expectedProfile(), leaseFence: '8' },
    });
    const { sessionRepository, handler } = fixture(changed);
    const turnClaims = claims(
      payload({
        turnIndex: 1,
        phase: 'turn',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
      })
    );

    await expect(
      handler.prepareVerifiedIngest({ claims: turnClaims, stableKeys })
    ).resolves.toEqual({ ok: false, code: 'SESSION_PROFILE_MISMATCH' });
    expect(sessionRepository.appendMatrixCorpusEvent).not.toHaveBeenCalled();

    const invalidDigestPayload = payload({ mockProfileDigest: 'f'.repeat(64) });
    await expect(
      handler.prepareVerifiedIngest({ claims: claims(invalidDigestPayload), stableKeys })
    ).resolves.toEqual({ ok: false, code: 'MOCK_PROFILE_DIGEST_MISMATCH' });
    expect(sessionRepository.createMatrixCorpusSession).not.toHaveBeenCalled();
  });

  it('fails closed when an attested confirmation is stale or belongs to another lane identity', async () => {
    const { confirmationRepository, sessionRepository, handler } = fixture();
    confirmationRepository.resolveExact.mockResolvedValue({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    const confirmationClaims = claims(
      payload({
        phase: 'confirmation',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'reject',
      })
    );

    await expect(
      handler.prepareVerifiedIngest({ claims: confirmationClaims, stableKeys })
    ).resolves.toEqual({ ok: false, code: 'CONFIRMATION_REJECTED' });
    expect(sessionRepository.appendMatrixCorpusEvent).not.toHaveBeenCalled();
  });

  it.each(['EXPIRED', 'ALREADY_RESOLVED'] as const)(
    'fails closed without a second event when confirmation resolution returns %s',
    async (code) => {
      const { confirmationRepository, sessionRepository, handler } = fixture();
      confirmationRepository.resolveExact.mockResolvedValue({ ok: false, code });
      const confirmationClaims = claims(
        payload({
          phase: 'confirmation',
          startNewSession: false,
          expectedSessionId: stableKeys.sessionId,
          pendingConfirmationId: 'confirmation_1',
          expectedDecision: 'confirm',
        })
      );

      await expect(
        handler.prepareVerifiedIngest({ claims: confirmationClaims, stableKeys })
      ).resolves.toEqual({ ok: false, code: 'CONFIRMATION_REJECTED' });
      expect(sessionRepository.appendMatrixCorpusEvent).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid claims, payload digest, and expected-session binding before context mutation', async () => {
    const current = fixture();
    await expect(
      current.handler.prepareVerifiedIngest({ claims: {}, stableKeys })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
    await expect(
      current.handler.prepareVerifiedIngest({
        claims: { ...claims(), payloadDigest: 'f'.repeat(64) },
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
    await expect(
      current.handler.prepareVerifiedIngest({
        claims: claims(
          payload({
            turnIndex: 1,
            phase: 'turn',
            startNewSession: false,
            expectedSessionId: 'another_session',
          })
        ),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });
    expect(current.contextService.loadSessionProfileSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed for unavailable or timezone-mismatched profile snapshots', async () => {
    const unavailable = fixture();
    unavailable.contextService.loadSessionProfileSnapshot.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      unavailable.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });

    const timeZone = fixture();
    timeZone.contextService.loadSessionProfileSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        promptPreferencesVersion: 2,
        promptPreferencesDigest: 'b'.repeat(64),
        agentModel: 'or:deepseek/deepseek-v4-flash',
        evaluatorModel: 'or:minimax/minimax-m3',
        userTimeZone: 'UTC',
      },
    });
    await expect(
      timeZone.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });
  });

  it('requires exact scenario registration or loading before session access', async () => {
    const registration = fixture();
    registration.contextService.registerScenario.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(
      registration.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });

    const baseline = fixture();
    baseline.contextService.registerScenario.mockResolvedValueOnce({
      ok: true,
      disposition: 'applied',
      snapshot: {
        baselinePromptPreferencesDigest: 'f'.repeat(64),
        overlayVersion: 0,
        overlayDigest: 'c'.repeat(64),
        expiresAt: '2026-07-21T10:00:00.000Z',
      },
    });
    await expect(
      baseline.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });

    const loading = fixture();
    loading.contextService.loadScenarioPromptContext.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      loading.handler.prepareVerifiedIngest({
        claims: claims(
          payload({
            turnIndex: 1,
            phase: 'turn',
            startNewSession: false,
            expectedSessionId: stableKeys.sessionId,
          })
        ),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_REJECTED' });
  });

  it('maps session create, exact-read, and event append failures', async () => {
    const create = fixture();
    create.sessionRepository.createMatrixCorpusSession.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(create.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })).resolves.toEqual({
      ok: false,
      code: 'SESSION_REJECTED',
    });

    const exact = fixture();
    exact.sessionRepository.getMatrixCorpusSessionExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    const turnClaims = claims(
      payload({
        turnIndex: 1,
        phase: 'turn',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
      })
    );
    await expect(
      exact.handler.prepareVerifiedIngest({ claims: turnClaims, stableKeys })
    ).resolves.toEqual({ ok: false, code: 'SESSION_REJECTED' });

    const event = fixture();
    event.sessionRepository.appendMatrixCorpusEvent.mockResolvedValueOnce({
      ok: false,
      code: 'SEQUENCE_CONFLICT',
    });
    await expect(event.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })).resolves.toEqual({
      ok: false,
      code: 'EVENT_REJECTED',
    });
  });

  it('rejects either failed event write in an explicit logical restart', async () => {
    const base = payload({
      phase: 'turn',
      turnIndex: 1,
      startNewSession: false,
      expectedSessionId: stableKeys.sessionId,
    });
    const restartPayload: MatrixCorpusAttestedIngestPayloadV1 = {
      ...base,
      ordinaryIngest: {
        ...base.ordinaryIngest,
        text: 'new session: remember the backup code',
      },
    };

    const failedClosure = fixture(
      existingSession({ status: 'waiting_for_user', lastEventSequence: 4 })
    );
    failedClosure.sessionRepository.appendMatrixCorpusEvent.mockResolvedValueOnce({
      ok: false,
      code: 'SEQUENCE_CONFLICT',
    });
    await expect(
      failedClosure.handler.prepareVerifiedIngest({
        claims: claims(restartPayload),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'EVENT_REJECTED' });
    expect(failedClosure.sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledOnce();

    const failedUserMessage = fixture(
      existingSession({ status: 'waiting_for_user', lastEventSequence: 4 })
    );
    failedUserMessage.sessionRepository.appendMatrixCorpusEvent
      .mockResolvedValueOnce({ ok: true, disposition: 'applied', sequence: 5 })
      .mockResolvedValueOnce({ ok: true, disposition: 'applied', sequence: 6 })
      .mockResolvedValueOnce({ ok: false, code: 'SEQUENCE_CONFLICT' });
    await expect(
      failedUserMessage.handler.prepareVerifiedIngest({
        claims: claims(restartPayload),
        stableKeys,
      })
    ).resolves.toEqual({ ok: false, code: 'EVENT_REJECTED' });
    expect(failedUserMessage.sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledTimes(3);
  });

  it('records a rejected confirmation and preserves applied disposition from any changed stage', async () => {
    const rejected = fixture();
    const rejectedClaims = claims(
      payload({
        phase: 'confirmation',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'reject',
      })
    );
    await expect(
      rejected.handler.prepareVerifiedIngest({ claims: rejectedClaims, stableKeys })
    ).resolves.toMatchObject({ ok: true, disposition: 'applied' });
    expect(rejected.sessionRepository.appendMatrixCorpusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          payload: expect.objectContaining({ resolution: 'rejected' }),
        }),
      })
    );

    const replay = fixture();
    replay.contextService.registerScenario.mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      snapshot: {
        baselinePromptPreferencesDigest: 'b'.repeat(64),
        overlayVersion: 0,
        overlayDigest: 'c'.repeat(64),
        expiresAt: '2026-07-21T10:00:00.000Z',
      },
    });
    replay.sessionRepository.createMatrixCorpusSession.mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      session: existingSession(),
    });
    replay.sessionRepository.appendMatrixCorpusEvent
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'already_applied',
        sequence: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'already_applied',
        sequence: 2,
      });
    await expect(replay.handler.prepareVerifiedIngest({ claims: claims(), stableKeys })).resolves.toEqual({
      ok: true,
      disposition: 'already_applied',
      sessionId: stableKeys.sessionId,
      eventSequence: 2,
    });
  });

  it('rejects a malformed confirmation correlation even after a valid attestation was built', async () => {
    const current = fixture();
    const valid = claims(
      payload({
        phase: 'confirmation',
        startNewSession: false,
        expectedSessionId: stableKeys.sessionId,
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'confirm',
      })
    );
    const malformed = {
      ...valid,
      payload: {
        ...valid.payload,
        context: { ...valid.payload.context, pendingConfirmationId: null },
      },
    };
    await expect(
      current.handler.prepareVerifiedIngest({ claims: malformed, stableKeys })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
  });
});
