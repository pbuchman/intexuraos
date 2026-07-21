import { err, ok } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';
import type {
  ConversationAssistantTurnRequest,
  ConversationAssistantTurnRequestRepository,
  ConversationAssistantTurnRequestRunner,
  StartConversationAssistantTurnRequestRepositoryInput,
  TurnRequestConversationTurn,
} from '../../../domain/conversation-assistant/turnRequestPorts.js';
import {
  getConversationAssistantTurnRequest,
  conversationAssistantTurnRequestSystemHeartbeat,
  resumeConversationAssistantTurnRequest,
  retryConversationAssistantTurnRequestAnswer,
  startConversationAssistantTurnRequest,
  type ConversationAssistantTurnRequestDeps,
} from '../../../domain/conversation-assistant/turnRequestUseCases.js';

const NOW = '2026-07-21T10:00:00.000Z';

type TestOverrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function request(
  overrides: TestOverrides<ConversationAssistantTurnRequest> = {}
): ConversationAssistantTurnRequest {
  return {
    id: 'request-1',
    requestFingerprint: 'fingerprint-1',
    sessionId: 'session-1',
    userId: 'user-1',
    sessionGenerationId: 'generation-1',
    status: 'in_progress',
    attempt: 1,
    stateVersion: 1,
    conversationRevision: 2,
    userTurnId: 'user-turn-1',
    assistantTurnId: 'assistant-turn-1',
    question: 'How did the attitude change?',
    acknowledgment:
      'Added 2 new messages sent between 19 July 2026, 10:00 and 20 July 2026, 10:00.',
    claimId: 'claim-1',
    leaseExpiresAt: '2026-07-21T10:05:00.000Z',
    createdAt: NOW,
    updatedAt: NOW,
    contextAttachmentId: 'attachment-1',
    ...overrides,
  } as ConversationAssistantTurnRequest;
}

function turn(
  role: 'user' | 'assistant',
  overrides: TestOverrides<TurnRequestConversationTurn> = {}
): TurnRequestConversationTurn {
  return {
    id: role === 'user' ? 'user-turn-1' : 'assistant-turn-1',
    sessionId: 'session-1',
    userId: 'user-1',
    role,
    text: role === 'user' ? 'How did the attitude change?' : 'The tone became warmer.',
    createdAt: NOW,
    sequence: role === 'user' ? 3 : 4,
    conversationRevision: 2,
    requestId: 'request-1',
    kind: role === 'user' ? 'context_attachment_question' : 'message',
    ...(role === 'user' ? { contextAttachmentId: 'attachment-1' } : {}),
    ...(role === 'assistant' ? { acknowledgment: request().acknowledgment } : {}),
    ...overrides,
  } as TurnRequestConversationTurn;
}

function staleError(): { code: 'REQUEST_STALE'; message: string } {
  return {
    code: 'REQUEST_STALE',
    message: 'The answer request lease is no longer owned',
  };
}

function createHarness(input?: {
  startResult?: Awaited<ReturnType<ConversationAssistantTurnRequestRepository['startTurnRequest']>>;
  runnerResult?: Awaited<ReturnType<ConversationAssistantTurnRequestRunner['generateAnswer']>>;
  completeStatus?: 'completed' | 'stale' | 'not_found';
  retryResult?: Awaited<ReturnType<ConversationAssistantTurnRequestRepository['claimAnswerRetry']>>;
  recoveryResult?: Awaited<
    ReturnType<ConversationAssistantTurnRequestRepository['claimTurnRequestRecovery']>
  >;
  renewResults?: Awaited<
    ReturnType<ConversationAssistantTurnRequestRepository['renewTurnRequestLease']>
  >[];
  now?: () => string;
}): {
  deps: ConversationAssistantTurnRequestDeps;
  repository: ConversationAssistantTurnRequestRepository;
  runner: ConversationAssistantTurnRequestRunner;
  telemetry: { record: ReturnType<typeof vi.fn> };
  calls: string[];
  runHeartbeat: () => Promise<void>;
} {
  const calls: string[] = [];
  const current = request();
  const userTurn = turn('user');
  const assistantTurn = turn('assistant');
  const repository: ConversationAssistantTurnRequestRepository = {
    startTurnRequest: vi.fn(async (_startInput: StartConversationAssistantTurnRequestRepositoryInput) => {
      calls.push('start');
      return (
        input?.startResult ?? {
          status: 'claimed' as const,
          request: current,
          userTurn,
        }
      );
    }),
    loadPromptSnapshot: vi.fn(async () => {
      calls.push('load_prompt');
      return {
        status: 'found' as const,
        snapshot: {
          userId: 'user-1',
          sessionId: 'session-1',
          model: LlmModels.Gemini25Flash,
          transcriptText: 'Initial immutable transcript',
          range: { from: '2026-07-14T00:00:00.000Z', to: '2026-07-18T00:00:00.000Z' },
          effectiveRange: {
            from: '2026-07-14T10:00:00.000Z',
            to: '2026-07-17T18:00:00.000Z',
          },
          history: [],
          currentQuestion: current.question,
        },
      };
    }),
    completeTurnRequest: vi.fn(async () => {
      calls.push('complete');
      return input?.completeStatus === 'stale'
        ? { status: 'stale' as const }
        : input?.completeStatus === 'not_found'
          ? { status: 'not_found' as const }
          : {
              status: 'completed' as const,
              request: request({ status: 'completed', stateVersion: 2 }),
              assistantTurn,
            };
    }),
    failTurnRequest: vi.fn(async (failureInput) => {
      calls.push('fail');
      return {
        status: 'failed' as const,
        request: request({ status: 'failed', stateVersion: 2 }),
        assistantTurn: turn('assistant', {
          text: failureInput.errorBodyText,
          error: { code: failureInput.error.code, message: failureInput.publicErrorMessage },
        }),
      };
    }),
    getTurnRequest: vi.fn(async () => ({ status: 'not_found' as const })),
    claimAnswerRetry: vi.fn(async () =>
      input?.retryResult ?? {
        status: 'claimed' as const,
        request: request({ status: 'in_progress', attempt: 2, claimId: 'claim-2' }),
        userTurn,
      }
    ),
    claimTurnRequestRecovery: vi.fn(async () =>
      input?.recoveryResult ?? {
        status: 'claimed' as const,
        request: request({ attempt: 2, stateVersion: 2, claimId: 'claim-2' }),
        userTurn,
      }
    ),
    renewTurnRequestLease: vi.fn(async (renewInput) => {
      calls.push('renew');
      const next = input?.renewResults?.shift();
      return (
        next ?? {
          status: 'renewed' as const,
          request: request({
            attempt: renewInput.attempt,
            claimId: renewInput.claimId,
            leaseExpiresAt: renewInput.leaseExpiresAt,
          }),
        }
      );
    }),
  };
  const runner: ConversationAssistantTurnRequestRunner = {
    generateAnswer: vi.fn(async (_input, onDelta) => {
      calls.push('model');
      onDelta('The tone ');
      onDelta('became warmer.');
      return input?.runnerResult ?? ok({ text: 'The tone became warmer.' });
    }),
  };
  const telemetry = { record: vi.fn(async () => undefined) };
  let heartbeat: (() => Promise<void>) | undefined;
  return {
    calls,
    repository,
    runner,
    telemetry,
    runHeartbeat: async (): Promise<void> => {
      if (heartbeat === undefined) throw new Error('Heartbeat was not scheduled');
      await heartbeat();
    },
    deps: {
      repository,
      runner,
      clock: { now: input?.now ?? ((): string => NOW) },
      ids: { claimId: () => 'claim-1' },
      telemetry,
      heartbeat: {
        every: vi.fn((_intervalMs, task) => {
          heartbeat = task;
          return () => {
            heartbeat = undefined;
          };
        }),
      },
    },
  };
}

describe('startConversationAssistantTurnRequest', () => {
  it('validates the request before touching persistence', async () => {
    const harness = createHarness();

    const result = await startConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: ' ', question: ' ' },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Request id and question are required' },
    });
    expect(harness.repository.startTurnRequest).not.toHaveBeenCalled();
  });

  it.each([
    { requestId: 'r'.repeat(129), contextAttachmentId: undefined, confirmationToken: undefined },
    { requestId: 'request-1', contextAttachmentId: ' ', confirmationToken: undefined },
    { requestId: 'request-1', contextAttachmentId: undefined, confirmationToken: ' ' },
  ])('rejects malformed optional request boundaries', async (invalid) => {
    const harness = createHarness();
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: invalid.requestId,
        question: 'Question',
        ...(invalid.contextAttachmentId === undefined
          ? {}
          : { contextAttachmentId: invalid.contextAttachmentId }),
        ...(invalid.confirmationToken === undefined
          ? {}
          : { confirmationToken: invalid.confirmationToken }),
      },
      harness.deps,
      () => undefined
    );
    expect(result).toEqual(err({ code: 'INVALID_REQUEST', message: 'Invalid answer request' }));
    expect(harness.repository.startTurnRequest).not.toHaveBeenCalled();
  });

  it('atomically starts before the model, streams persisted milestones, and finalizes once', async () => {
    const harness = createHarness();
    const events: { type: string; streamSequence: number }[] = [];

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: ' How did the attitude change? ',
        contextAttachmentId: 'attachment-1',
        confirmationToken: 'confirmation-1',
      },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(harness.calls).toEqual([
      'start',
      'renew',
      'load_prompt',
      'model',
      'renew',
      'complete',
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'request_state',
      'context_attached',
      'user_turn',
      'assistant_delta',
      'assistant_delta',
      'assistant_delta',
      'request_state',
      'assistant_turn',
      'done',
    ]);
    expect(events.map((event) => event.streamSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const deltas = events.filter(
      (event): event is typeof event & { text: string } => event.type === 'assistant_delta'
    );
    expect(deltas.map((event) => event.text)).toEqual([
      `${request().acknowledgment}\n\n`,
      'The tone ',
      'became warmer.',
    ]);
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'The tone became warmer.',
      })
    );
    expect(harness.repository.completeTurnRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ persistedAssistantText: expect.anything() })
    );
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'completed',
    });
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'model_first_delta',
      outcome: 'completed',
      timeToFirstDeltaMs: expect.any(Number),
    });
    expect(
      vi
        .mocked(harness.telemetry.record)
        .mock.calls.filter(([sample]) => sample.operation === 'model_first_delta')
    ).toHaveLength(1);
  });

  it('replays a matching durable result without another model call', async () => {
    const completed = request({ status: 'completed', stateVersion: 4 });
    const assistantTurn = turn('assistant');
    const harness = createHarness({
      startResult: {
        status: 'replay',
        request: completed,
        userTurn: turn('user'),
        assistantTurn,
      },
    });
    const events: { type: string }[] = [];

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
        contextAttachmentId: 'attachment-1',
      },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'replay',
    });
    expect(events.map((event) => event.type)).toEqual([
      'request_state',
      'context_attached',
      'user_turn',
      'assistant_turn',
      'done',
    ]);
  });

  it('maps a repository exception to one content-free internal failure signal', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.startTurnRequest).mockRejectedValue(
      new Error('private persistence detail')
    );

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(
      err({
        code: 'INTERNAL_ERROR',
        message: 'Conversation Assistant answer request failed',
      })
    );
    expect(JSON.stringify(result)).not.toContain('private persistence detail');
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'failed',
    });
  });

  it('maps a post-claim persistence exception to a safe failed operation', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.loadPromptSnapshot).mockRejectedValue(
      new Error('private snapshot detail')
    );

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(
      err({
        code: 'INTERNAL_ERROR',
        message: 'Conversation Assistant answer request failed',
      })
    );
    expect(JSON.stringify(result)).not.toContain('private snapshot detail');
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'failed',
    });
  });

  it('replays an in-progress plain question without inventing an assistant turn or done event', async () => {
    const plainRequest = request({
      status: 'in_progress',
      contextAttachmentId: undefined,
      acknowledgment: '',
    });
    const harness = createHarness({
      startResult: {
        status: 'replay',
        request: plainRequest,
        userTurn: turn('user', { kind: 'message', contextAttachmentId: undefined }),
      },
    });
    const events: { type: string }[] = [];
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).not.toHaveProperty('assistantTurn');
    expect(events.map((event) => event.type)).toEqual(['request_state', 'user_turn']);
  });

  it('executes a plain question without an acknowledgment or context-attached event', async () => {
    const plainRequest = request({ contextAttachmentId: undefined, acknowledgment: '' });
    const harness = createHarness({
      startResult: {
        status: 'claimed',
        request: plainRequest,
        userTurn: turn('user', { kind: 'message', contextAttachmentId: undefined }),
      },
    });
    const events: { type: string }[] = [];
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );
    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).not.toContain('context_attached');
    expect(events.filter((event) => event.type === 'assistant_delta')).toHaveLength(2);
  });

  it.each([
    ['conflict', 'REQUEST_BODY_CONFLICT', 'conflict', {}],
    ['active_request', 'TURN_IN_PROGRESS', 'conflict', { twoTabConflictCount: 1 }],
    ['attachment_stale', 'CONTEXT_STALE', 'stale', { twoTabConflictCount: 1 }],
    ['attachment_not_ready', 'ATTACHMENT_NOT_READY', 'rejected', {}],
    ['confirmation_required', 'CONFIRMATION_REQUIRED', 'rejected', {}],
    [
      'context_window_exceeded',
      'CONTEXT_WINDOW_EXCEEDED',
      'rejected',
      { promptBudgetRejectionCount: 1 },
    ],
    ['not_found', 'NOT_FOUND', 'rejected', {}],
  ] as const)(
    'maps repository %s without calling the model',
    async (status, code, outcome, measurements) => {
      const harness = createHarness({ startResult: { status } });

      const result = await startConversationAssistantTurnRequest(
        {
          userId: 'user-1',
          sessionId: 'session-1',
          requestId: 'request-1',
          question: request().question,
        },
        harness.deps,
        () => undefined
      );

      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
      expect(harness.telemetry.record).toHaveBeenCalledWith({
        operation: 'turn_request',
        outcome,
        ...measurements,
      });
    }
  );

  it('persists one acknowledged terminal error revision when the model fails', async () => {
    const harness = createHarness({
      runnerResult: err({ code: 'PROVIDER_FAILED', message: 'private provider detail' }),
    });

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
        contextAttachmentId: 'attachment-1',
      },
      harness.deps,
      () => undefined
    );

    expect(result.ok).toBe(true);
    expect(harness.repository.failTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        errorBodyText: 'I could not generate the answer. Try answer again.',
        error: { code: 'LLM_ERROR' },
        publicErrorMessage: 'The answer could not be generated',
      })
    );
    expect(JSON.stringify(result)).not.toContain('private provider detail');
  });

  it.each(['stale', 'not_found'] as const)('fails closed when prompt loading is %s', async (status) => {
    const harness = createHarness();
    vi.mocked(harness.repository.loadPromptSnapshot).mockResolvedValue({ status });
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: status === 'stale' ? 'REQUEST_STALE' : 'NOT_FOUND' },
    });
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
  });

  it('maps a thrown runner to one safe persisted failure', async () => {
    const harness = createHarness();
    vi.mocked(harness.runner.generateAnswer).mockRejectedValue(new Error('private provider error'));
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );
    expect(result.ok).toBe(true);
    expect(harness.repository.failTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'LLM_ERROR' } })
    );
    expect(JSON.stringify(result)).not.toContain('private provider error');
  });

  it('ignores empty provider deltas and emits durable usage once', async () => {
    const harness = createHarness();
    vi.mocked(harness.runner.generateAnswer).mockImplementation(async (_snapshot, onDelta) => {
      onDelta('');
      return ok({
        text: 'Answer',
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, costUsd: 0.001 },
      });
    });
    const events: { type: string }[] = [];
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );
    expect(result.ok).toBe(true);
    expect(events.filter((event) => event.type === 'usage')).toHaveLength(1);
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, costUsd: 0.001 },
      })
    );
    expect(harness.telemetry.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ timeToFirstDeltaMs: expect.any(Number) })
    );
  });

  it('persists and returns the stable prompt-budget error without relabeling it', async () => {
    const harness = createHarness({
      runnerResult: err({
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      }),
    });

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      },
    });
    expect(harness.repository.failTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        errorBodyText: 'This update is too large to include in one question.',
        error: { code: 'CONTEXT_WINDOW_EXCEEDED' },
      })
    );
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'rejected',
      promptBudgetRejectionCount: 1,
    });
  });

  it('continues and finalizes when the disconnected event sink throws', async () => {
    const harness = createHarness();

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => {
        throw new Error('socket closed');
      }
    );

    expect(result.ok).toBe(true);
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledOnce();
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'sse_disconnect',
      outcome: 'disconnected',
    });
  });

  it('fails closed when an old attempt loses its finalization fence', async () => {
    const harness = createHarness({ completeStatus: 'stale' });

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'REQUEST_STALE', message: 'The answer request lease is no longer owned' },
    });
  });

  it('stops old-worker deltas, usage, and finalization after the heartbeat loses its fence', async () => {
    let now = NOW;
    const harness = createHarness({
      now: () => now,
      renewResults: [
        { status: 'renewed', request: request() },
        { status: 'stale' },
      ],
    });
    vi.mocked(harness.runner.generateAnswer).mockImplementation(async (_snapshot, onDelta) => {
      onDelta('before loss');
      now = '2026-07-21T10:01:00.000Z';
      await harness.runHeartbeat();
      onDelta('after loss');
      return ok({
        text: 'must not persist',
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, costUsd: 0.001 },
      });
    });
    const events: { type: string; text?: string }[] = [];

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result).toEqual(
      err({ code: 'REQUEST_STALE', message: 'The answer request lease is no longer owned' })
    );
    expect(events.filter((event) => event.type === 'assistant_delta')).toEqual([
      expect.objectContaining({ text: `${request().acknowledgment}\n\n` }),
      expect.objectContaining({ text: 'before loss' }),
    ]);
    expect(events.some((event) => event.type === 'usage')).toBe(false);
    expect(harness.repository.completeTurnRequest).not.toHaveBeenCalled();
  });

  it('fails before prompt loading when the claimed lease is already expired', async () => {
    const harness = createHarness({
      startResult: {
        status: 'claimed',
        request: request({ leaseExpiresAt: NOW }),
        userTurn: turn('user'),
      },
    });
    const events: { type: string }[] = [];

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result).toEqual(err(staleError()));
    expect(events.some((event) => event.type === 'assistant_delta')).toBe(false);
    expect(harness.repository.renewTurnRequestLease).not.toHaveBeenCalled();
    expect(harness.repository.loadPromptSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed when the initial lease renewal throws', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.renewTurnRequestLease).mockRejectedValueOnce(
      new Error('transient persistence failure')
    );

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(err(staleError()));
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
  });

  it('serializes overlapping heartbeat renewal with the pre-finalization fence', async () => {
    const harness = createHarness();
    let resolveRenewal: ((value: { status: 'renewed'; request: ConversationAssistantTurnRequest }) => void) | undefined;
    const pendingRenewal = new Promise<{
      status: 'renewed';
      request: ConversationAssistantTurnRequest;
    }>((resolve) => {
      resolveRenewal = resolve;
    });
    vi.mocked(harness.repository.renewTurnRequestLease)
      .mockResolvedValueOnce({ status: 'renewed', request: request() })
      .mockReturnValueOnce(pendingRenewal)
      .mockResolvedValueOnce({ status: 'renewed', request: request() });
    vi.mocked(harness.runner.generateAnswer).mockImplementation(async () => {
      void harness.runHeartbeat();
      void harness.runHeartbeat();
      return ok({ text: 'Serialized answer' });
    });

    const resultPromise = startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );
    await vi.waitFor(() => {
      expect(harness.repository.renewTurnRequestLease).toHaveBeenCalledTimes(2);
    });
    resolveRenewal?.({ status: 'renewed', request: request() });

    await expect(resultPromise).resolves.toMatchObject({ ok: true });
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledOnce();
  });

  it('does not emit a provider delta after the locally known lease expires', async () => {
    let now = NOW;
    const harness = createHarness({ now: () => now });
    vi.mocked(harness.repository.renewTurnRequestLease).mockResolvedValue({
      status: 'renewed',
      request: request({ leaseExpiresAt: '2026-07-21T10:00:30.000Z' }),
    });
    vi.mocked(harness.runner.generateAnswer).mockImplementation(async (_snapshot, onDelta) => {
      now = '2026-07-21T10:00:31.000Z';
      onDelta('late delta');
      return ok({ text: 'late answer' });
    });
    const events: { type: string; text?: string }[] = [];

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result).toEqual(err(staleError()));
    expect(events).not.toContainEqual(expect.objectContaining({ text: 'late delta' }));
  });

  it('maps a stale deterministic failure finalization to the claim fence', async () => {
    const harness = createHarness({
      runnerResult: err({
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      }),
    });
    vi.mocked(harness.repository.failTurnRequest).mockResolvedValue({ status: 'stale' });

    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(err(staleError()));
  });

  it('fails closed when finalization no longer finds the request', async () => {
    const harness = createHarness({ completeStatus: 'not_found' });
    const result = await startConversationAssistantTurnRequest(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        question: request().question,
      },
      harness.deps,
      () => undefined
    );
    expect(result).toEqual(
      err({ code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' })
    );
  });
});

describe('resumeConversationAssistantTurnRequest', () => {
  it('reclaims the stored request and generates only the missing assistant turn', async () => {
    const harness = createHarness();
    const events: { type: string }[] = [];

    const result = await resumeConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(harness.repository.startTurnRequest).not.toHaveBeenCalled();
    expect(harness.repository.claimTurnRequestRecovery).toHaveBeenCalledOnce();
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, claimId: 'claim-2' })
    );
    expect(events.map((event) => event.type)).not.toContain('user_turn');
    expect(events.map((event) => event.type)).not.toContain('context_attached');
  });

  it('returns an unexpired or terminal replay without another model call', async () => {
    const harness = createHarness({
      recoveryResult: {
        status: 'replay',
        request: request({ status: 'in_progress' }),
        userTurn: turn('user'),
      },
    });

    const result = await resumeConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );

    expect(result.ok).toBe(true);
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
  });

  it('validates ids before attempting a recovery claim', async () => {
    const harness = createHarness();

    await expect(
      resumeConversationAssistantTurnRequest(
        { userId: ' ', sessionId: 'session-1', requestId: 'request-1' },
        harness.deps,
        () => undefined
      )
    ).resolves.toEqual(err({ code: 'INVALID_REQUEST', message: 'Request id is required' }));
    expect(harness.repository.claimTurnRequestRecovery).not.toHaveBeenCalled();
  });

  it.each([
    ['busy', 'TURN_IN_PROGRESS', 'conflict'],
    ['not_found', 'NOT_FOUND', 'rejected'],
  ] as const)('maps recovery %s to %s', async (status, code, outcome) => {
    const harness = createHarness({ recoveryResult: { status } });

    const result = await resumeConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome,
    });
  });

  it('maps recovery persistence exceptions to a safe failure', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.claimTurnRequestRecovery).mockRejectedValue(
      new Error('private persistence detail')
    );

    const result = await resumeConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(err({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant answer request failed',
    }));
  });

  it('records a stale outcome when a recovered claim loses its first renewal', async () => {
    const harness = createHarness({ renewResults: [{ status: 'stale' }] });

    const result = await resumeConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );

    expect(result).toEqual(err(staleError()));
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'turn_request',
      outcome: 'stale',
    });
  });
});

describe('conversationAssistantTurnRequestSystemHeartbeat', () => {
  it('runs and cancels the periodic heartbeat', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const cancel = conversationAssistantTurnRequestSystemHeartbeat.every(100, task);

    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledOnce();
    cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('retryConversationAssistantTurnRequestAnswer', () => {
  it('reclaims and replaces only the answer without starting or recommitting the attachment', async () => {
    const harness = createHarness();

    const result = await retryConversationAssistantTurnRequestAnswer(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );

    expect(result.ok).toBe(true);
    expect(harness.repository.startTurnRequest).not.toHaveBeenCalled();
    expect(harness.repository.claimAnswerRetry).toHaveBeenCalledOnce();
    expect(harness.calls).toEqual(['renew', 'load_prompt', 'model', 'renew', 'complete']);
    expect(harness.repository.completeTurnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, claimId: 'claim-2' })
    );
    expect(harness.telemetry.record).toHaveBeenCalledWith({
      operation: 'answer_retry',
      outcome: 'completed',
    });
  });

  it('validates recovery ids before persistence', async () => {
    const harness = createHarness();
    expect(
      await retryConversationAssistantTurnRequestAnswer(
        { userId: ' ', sessionId: 'session-1', requestId: 'request-1' },
        harness.deps,
        () => undefined
      )
    ).toEqual(err({ code: 'INVALID_REQUEST', message: 'Request id is required' }));
    expect(harness.repository.claimAnswerRetry).not.toHaveBeenCalled();
  });

  it('replays a terminal retry without calling the model', async () => {
    const harness = createHarness({
      retryResult: {
        status: 'replay',
        request: request({ status: 'completed', completedAt: NOW }),
        userTurn: turn('user'),
        assistantTurn: turn('assistant'),
      },
    });
    const result = await retryConversationAssistantTurnRequestAnswer(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );
    expect(result.ok).toBe(true);
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'NOT_FOUND'],
    ['busy', 'TURN_IN_PROGRESS'],
    ['invalid_state', 'ANSWER_RETRY_UNAVAILABLE'],
  ] as const)('maps retry %s to %s', async (status, code) => {
    const harness = createHarness({ retryResult: { status } });
    const result = await retryConversationAssistantTurnRequestAnswer(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps,
      () => undefined
    );
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(harness.runner.generateAnswer).not.toHaveBeenCalled();
  });
});

describe('getConversationAssistantTurnRequest', () => {
  it('returns the durable request with ordered visible turns and a retry capability', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
      status: 'found',
      completedConversationRevision: 2,
      request: request({
        status: 'failed',
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
      userTurn: turn('user'),
      assistantTurn: turn('assistant', {
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
    });

    const result = await getConversationAssistantTurnRequest(
      { userId: ' user-1 ', sessionId: ' session-1 ', requestId: ' request-1 ' },
      harness.deps
    );

    expect(result).toEqual(
      ok({
        request: expect.objectContaining({ id: 'request-1', status: 'failed' }),
        turns: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
        canRetryAnswer: true,
      })
    );
    expect(harness.repository.getTurnRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
      requestId: 'request-1',
    });
  });

  it('fails closed when an older model failure is followed by a newer completed revision', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
      status: 'found',
      completedConversationRevision: 3,
      request: request({
        status: 'failed',
        conversationRevision: 2,
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
      userTurn: turn('user', { conversationRevision: 2 }),
      assistantTurn: turn('assistant', {
        conversationRevision: 2,
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
    });

    const staleFailure = await getConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps
    );
    expect(staleFailure).toMatchObject({ ok: true, value: { canRetryAnswer: false } });

    vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
      status: 'found',
      completedConversationRevision: 3,
      request: request({
        status: 'failed',
        conversationRevision: 3,
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
      userTurn: turn('user', { conversationRevision: 3 }),
      assistantTurn: turn('assistant', {
        conversationRevision: 3,
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
    });

    const latestFailure = await getConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps
    );
    expect(latestFailure).toMatchObject({ ok: true, value: { canRetryAnswer: true } });
  });

  it('fails closed when the completed revision is unavailable', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
      status: 'found',
      request: request({
        status: 'failed',
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
      userTurn: turn('user'),
      assistantTurn: turn('assistant', {
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
    });

    const result = await getConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps
    );
    expect(result).toMatchObject({ ok: true, value: { canRetryAnswer: false } });
  });

  it('does not offer retry while another answer owns an unexpired active lease', async () => {
    const harness = createHarness();
    vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
      status: 'found',
      completedConversationRevision: 2,
      activeTurnRequestId: 'request-b',
      activeTurnLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      request: request({
        status: 'failed',
        conversationRevision: 2,
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
      userTurn: turn('user'),
      assistantTurn: turn('assistant', {
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      }),
    });

    const result = await getConversationAssistantTurnRequest(
      { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
      harness.deps
    );

    expect(result).toMatchObject({ ok: true, value: { canRetryAnswer: false } });
  });

  it('fails closed for invalid and missing requests', async () => {
    const harness = createHarness();
    expect(
      await getConversationAssistantTurnRequest(
        { userId: '', sessionId: 'session-1', requestId: 'request-1' },
        harness.deps
      )
    ).toEqual(err({ code: 'INVALID_REQUEST', message: 'Request id is required' }));
    expect(harness.repository.getTurnRequest).not.toHaveBeenCalled();

    expect(
      await getConversationAssistantTurnRequest(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
        harness.deps
      )
    ).toEqual(
      err({ code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' })
    );
  });

  it('does not offer a retry for completed, in-progress, or deterministic size failures', async () => {
    for (const storedRequest of [
      request({ status: 'completed', completedAt: NOW }),
      request({ status: 'in_progress' }),
      request({
        status: 'failed',
        error: {
          code: 'CONTEXT_WINDOW_EXCEEDED',
          message: 'This update is too large to include in one question.',
        },
      }),
    ]) {
      const harness = createHarness();
      vi.mocked(harness.repository.getTurnRequest).mockResolvedValue({
        status: 'found',
        request: storedRequest,
        userTurn: turn('user'),
      });
      const result = await getConversationAssistantTurnRequest(
        { userId: 'user-1', sessionId: 'session-1', requestId: 'request-1' },
        harness.deps
      );
      expect(result).toMatchObject({ ok: true, value: { canRetryAnswer: false } });
    }
  });
});
