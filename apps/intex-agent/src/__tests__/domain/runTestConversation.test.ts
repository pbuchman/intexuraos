import { describe, expect, it } from 'vitest';
import { runTestConversation } from '../../domain/testConversation/runTestConversation.js';
import type {
  CapturedToolCall,
  TestConversationHttpRequest,
  TestConversationResponse,
} from '../../domain/testConversation/testConversationTypes.js';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../../domain/messages/handleIncomingMessage.js';
import type {
  SessionRepository,
  SessionRepositorySessionUpdate,
} from '../../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../../domain/sessions/types.js';

describe('test conversation contract', () => {
  it('supports a live mocked-tools request and response transcript', () => {
    const request: TestConversationHttpRequest = {
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: 'test-intex-agent-intex-e2e-contract',
      runId: 'intex-e2e-contract',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      turns: [
        {
          kind: 'message',
          messageId: 'wamid-contract-1',
          text: 'Jakie mam jutro wydarzenia? intex-e2e-contract',
          timestamp: '2026-07-01T10:00:00.000Z',
          sourceType: 'whatsapp_text',
        },
      ],
      toolMocks: {
        query_calendar_events: {
          mode: 'success',
          result: { status: 'completed', mode: 'list', count: 0, events: [] },
        },
      },
    };

    const response: TestConversationResponse = {
      runId: request.runId,
      userId: request.userId,
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      finalSessionId: 'intex_session_1',
      turns: [
        {
          turnIndex: 0,
          kind: 'message',
          messageId: 'wamid-contract-1',
          sessionId: 'intex_session_1',
          submittedTextPreview: 'Jakie mam jutro wydarzenia? intex-e2e-contract',
          assistantReplies: [],
        },
      ],
      toolCalls: [],
      sessions: [],
      sessionTransitions: [],
      eventsBySessionId: {},
      behavioralTranscript: { turns: [] },
      sideEffectBoundary: 'mocked_tools_no_downstream_writes',
      warnings: [],
    };

    expect(response.runId).toBe('intex-e2e-contract');
  });

  it('runs two message turns through handleIncomingMessage and returns sanitized evidence', async () => {
    const repository = new MemorySessionRepository();
    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-scripted',
        runId: 'intex-e2e-scripted',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [
          {
            kind: 'message',
            messageId: 'wamid-1',
            text: 'Jakie wydarzenia jutro? intex-e2e-scripted',
            timestamp: '2026-07-01T10:00:00.000Z',
          },
          {
            kind: 'message',
            messageId: 'wamid-2',
            text: 'Co dalej?',
            timestamp: '2026-07-01T10:01:00.000Z',
          },
        ],
      },
      {
        sessionRepository: repository,
        runner: new ScriptedRunner([
          {
            outcome: 'completed',
            reply: 'Nie masz żadnych wydarzeń jutro.',
            toolName: 'query_calendar_events',
            toolResult: { status: 'completed', count: 0, token: 'secret-token' },
          },
          { outcome: 'no_action', reply: 'Co mogę teraz dla Ciebie zrobić?' },
        ]),
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    expect(result.userId).toBe('test-intex-agent-intex-e2e-scripted');
    expect(result.finalSessionId).toBe('intex_session_test_1');
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.assistantReplies[0]?.message).toContain('Nie masz żadnych wydarzeń');
    expect(result.turns[1]?.assistantReplies[0]?.message).toContain('Co mogę teraz');
    expect(result.eventsBySessionId['intex_session_test_1']?.map((event) => event.type)).toContain(
      'assistant_message'
    );
    expect(JSON.stringify(result)).not.toContain('toolArgs');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(result.behavioralTranscript.turns[0]).toMatchObject({
      sessionAction: 'started',
      toolOutcome: { toolName: 'query_calendar_events', status: 'completed' },
    });
    expect(result.behavioralTranscript.turns[1]).not.toHaveProperty('toolOutcome');
  });

  it('returns an empty transcript for direct empty-turn use case calls', async () => {
    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-empty',
        runId: 'intex-e2e-empty',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [],
      },
      {
        sessionRepository: new MemorySessionRepository(),
        runner: new ScriptedRunner([]),
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    expect(result.finalSessionId).toBeNull();
    expect(result.turns).toEqual([]);
    expect(result.behavioralTranscript.turns).toEqual([]);
  });

  it('resolves semantic confirmation accept and records confirmed tool execution events', async () => {
    const repository = new MemorySessionRepository();
    const toolCalls: CapturedToolCall[] = [
      {
        toolName: 'create_note',
        status: 'completed',
        argsSummary: { contentLength: 21 },
        resultSummary: { status: 'completed' },
      },
    ];
    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-confirm',
        runId: 'intex-e2e-confirm',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [
          {
            kind: 'message',
            messageId: 'wamid-confirm-1',
            text: 'Zapamiętaj kod 1234. intex-e2e-confirm',
          },
          { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' },
        ],
      },
      {
        sessionRepository: repository,
        runner: new ScriptedRunner(
          [
            {
              outcome: 'needs_confirmation',
              reply: 'Czy dodać notatkę?\nTreść: kod 1234',
              toolName: 'create_note',
              toolArgs: { content: 'kod 1234 intex-e2e-confirm' },
            },
          ],
          [{ outcome: 'completed', reply: 'Zapisałem notatkę.', toolName: 'create_note' }]
        ),
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls,
        logger: silentLogger(),
      }
    );

    const events = result.eventsBySessionId['intex_session_test_1'] ?? [];
    expect(events.map((event) => event.type)).toContain('confirmation_resolved');
    expect(events.map((event) => event.type)).toContain('tool_call_completed');
    expect(result.turns[1]?.kind).toBe('confirmation_button');
    expect(result.turns[1]?.assistantReplies[0]?.message).toContain('Zapisałem notatkę');
    expect(result.toolCalls).toEqual(toolCalls);
    expect(result.behavioralTranscript.turns[1]).toMatchObject({
      confirmationAction: 'accepted',
      toolOutcome: { toolName: 'create_note', status: 'completed' },
    });
  });

  it('resolves semantic confirmation rejection without confirmed tool calls', async () => {
    const repository = new MemorySessionRepository();
    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-reject',
        runId: 'intex-e2e-reject',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [
          {
            kind: 'message',
            messageId: 'wamid-reject-1',
            text: 'Zapamiętaj kod 4321. intex-e2e-reject',
          },
          { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'reject' },
        ],
      },
      {
        sessionRepository: repository,
        runner: new ScriptedRunner([
          {
            outcome: 'needs_confirmation',
            reply: 'Czy dodać notatkę?\nTreść: kod 4321',
            toolName: 'create_note',
            toolArgs: { content: 'kod 4321 intex-e2e-reject' },
          },
        ]),
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    const events = result.eventsBySessionId['intex_session_test_1'] ?? [];
    expect(events.map((event) => event.type)).toContain('confirmation_resolved');
    expect(events.map((event) => event.type)).not.toContain('tool_call_completed');
    expect(result.toolCalls).toEqual([]);
    expect(result.behavioralTranscript.turns[1]).toMatchObject({
      confirmationAction: 'rejected',
    });
  });

  it('expires an old session and reports the transition when timeout starts a new session', async () => {
    const repository = new MemorySessionRepository();
    repository.sessions.push({
      id: 'intex_session_old',
      userId: 'test-intex-agent-intex-e2e-timeout',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-07-01T09:00:00.000Z',
      lastUserMessageAt: '2026-07-01T09:00:00.000Z',
      startReason: 'no_active_session',
    });

    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        scenarioId: 'timeout-transition',
        userId: 'test-intex-agent-intex-e2e-timeout',
        runId: 'intex-e2e-timeout',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [
          {
            kind: 'message',
            text: 'Nowy temat po przerwie. intex-e2e-timeout',
            sourceUrl: 'https://example.com/source',
            whatsappSender: '+48123123123',
            replyContext: {
              replyToWamid: 'wamid-old',
              source: 'inbound_user_message',
              text: 'Poprzedni tekst',
              truncated: false,
            },
          },
        ],
      },
      {
        sessionRepository: repository,
        runner: new ScriptedRunner([{ outcome: 'no_action', reply: 'Jasne, co dalej?' }]),
        sessionTimeoutMs: 1,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    expect(result.scenarioId).toBe('timeout-transition');
    expect(result.turns[0]).toMatchObject({
      messageId: 'wamid-test-intex-e2e-timeout-0',
      sessionId: 'intex_session_test_2',
    });
    expect(result.sessionTransitions[0]).toEqual({
      turnIndex: 0,
      action: 'expired_previous',
      sessionId: 'intex_session_test_2',
      previousSessionId: 'intex_session_old',
      previousEndReason: 'timeout',
    });
  });

  it('reports superseded transitions for explicit new-session commands', async () => {
    const repository = new MemorySessionRepository();
    repository.sessions.push({
      id: 'intex_session_old',
      userId: 'test-intex-agent-intex-e2e-supersede',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-07-01T09:00:00.000Z',
      lastUserMessageAt: '2026-07-01T09:59:00.000Z',
      startReason: 'no_active_session',
    });

    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-supersede',
        runId: 'intex-e2e-supersede',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [{ kind: 'message', text: 'new session: fresh topic intex-e2e-supersede' }],
      },
      {
        sessionRepository: repository,
        runner: new ScriptedRunner([{ outcome: 'no_action', reply: 'Fresh session.' }]),
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    expect(result.sessionTransitions[0]).toMatchObject({
      action: 'superseded_previous',
      previousSessionId: 'intex_session_old',
      previousEndReason: 'superseded_by_user',
    });
  });

  it('uses each turn timestamp for the domain clock and generated message timestamp', async () => {
    const repository = new MemorySessionRepository();
    const runner = new ScriptedRunner([{ outcome: 'no_action', reply: 'Got it.' }]);

    const result = await runTestConversation(
      {
        contractVersion: '2026-07-01',
        mode: 'live_llm_mock_tools',
        userId: 'test-intex-agent-intex-e2e-timestamp',
        runId: 'intex-e2e-timestamp',
        currentDateTime: '2026-07-01T10:00:00.000Z',
        turns: [
          {
            kind: 'message',
            text: 'Timestamp check. intex-e2e-timestamp',
            timestamp: '2026-07-01T11:15:00.000Z',
          },
        ],
      },
      {
        sessionRepository: repository,
        runner,
        sessionTimeoutMs: 30 * 60 * 1000,
        ids: fixedTestIds(),
        toolCalls: [],
        logger: silentLogger(),
      }
    );

    const runnerInput = runner.calls[0] as { currentDateTime: string };
    expect(runnerInput.currentDateTime).toBe('2026-07-01T11:15:00.000Z');
    expect(result.turns[0]?.messageId).toBe('wamid-test-intex-e2e-timestamp-0');
    expect(repository.events.find((event) => event.type === 'user_message')?.createdAt).toBe(
      '2026-07-01T11:15:00.000Z'
    );
  });

  it('fails fast when a semantic confirmation cannot find a captured button', async () => {
    const repository = new MemorySessionRepository();

    await expect(
      runTestConversation(
        {
          contractVersion: '2026-07-01',
          mode: 'live_llm_mock_tools',
          userId: 'test-intex-agent-intex-e2e-missing-button',
          runId: 'intex-e2e-missing-button',
          currentDateTime: '2026-07-01T10:00:00.000Z',
          turns: [
            {
              kind: 'message',
              text: 'Tylko odpowiedz tekstem. intex-e2e-missing-button',
            },
            { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' },
          ],
        },
        {
          sessionRepository: repository,
          runner: new ScriptedRunner([{ outcome: 'no_action', reply: 'Odpowiedź bez przycisków.' }]),
          sessionTimeoutMs: 30 * 60 * 1000,
          ids: fixedTestIds(),
          toolCalls: [],
          logger: silentLogger(),
        }
      )
    ).rejects.toThrow('confirmation_button could not resolve a captured confirmation button');
  });

  it('fails fast when a semantic confirmation references an unexecuted turn', async () => {
    await expect(
      runTestConversation(
        {
          contractVersion: '2026-07-01',
          mode: 'live_llm_mock_tools',
          userId: 'test-intex-agent-intex-e2e-bad-confirm',
          runId: 'intex-e2e-bad-confirm',
          currentDateTime: '2026-07-01T10:00:00.000Z',
          turns: [{ kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' }],
        },
        {
          sessionRepository: new MemorySessionRepository(),
          runner: new ScriptedRunner([]),
          sessionTimeoutMs: 30 * 60 * 1000,
          ids: fixedTestIds(),
          toolCalls: [],
          logger: silentLogger(),
        }
      )
    ).rejects.toThrow('confirmation_button previousTurnIndex does not reference an executed turn');
  });
});

class ScriptedRunner implements IntexAgentRunner {
  readonly calls: unknown[] = [];
  readonly executeConfirmedCalls: unknown[] = [];
  private runIndex = 0;
  private executeIndex = 0;

  constructor(
    private readonly runResults: IntexAgentRunnerResult[],
    private readonly executeResults: IntexAgentRunnerResult[] = []
  ) {}

  async run(input: Parameters<IntexAgentRunner['run']>[0]): Promise<IntexAgentRunnerResult> {
    this.calls.push(input);
    const result = this.runResults[this.runIndex];
    this.runIndex += 1;
    if (result === undefined) {
      throw new Error('Missing scripted run result');
    }
    return result;
  }

  async executeConfirmed(
    input: Parameters<IntexAgentRunner['executeConfirmed']>[0]
  ): Promise<IntexAgentRunnerResult> {
    this.executeConfirmedCalls.push(input);
    const result = this.executeResults[this.executeIndex];
    this.executeIndex += 1;
    if (result === undefined) {
      throw new Error('Missing scripted execute result');
    }
    return result;
  }
}

class MemorySessionRepository implements SessionRepository {
  readonly sessions: IntexAgentSession[] = [];
  readonly events: IntexAgentSessionEvent[] = [];

  async listSessions(userId: string): Promise<IntexAgentSession[]> {
    return this.sessions.filter((session) => session.userId === userId);
  }

  async getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    return this.sessions.find((session) => session.id === sessionId && session.userId === userId) ?? null;
  }

  async listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId && event.userId === userId);
  }

  async findOpenSession(userId: string): Promise<IntexAgentSession | null> {
    return this.findContinuableSession(userId);
  }

  async findContinuableSession(userId: string): Promise<IntexAgentSession | null> {
    return (
      this.sessions
        .filter(
          (session) =>
            session.userId === userId &&
            ['active', 'waiting_for_user', 'executing_tool'].includes(session.status)
        )
        .sort((left, right) => left.lastUserMessageAt.localeCompare(right.lastUserMessageAt))
        .at(-1) ?? null
    );
  }

  async createSession(draft: IntexAgentSession): Promise<IntexAgentSession> {
    this.sessions.push(draft);
    return draft;
  }

  async updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession> {
    const index = this.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) {
      throw new Error(`Missing session ${sessionId}`);
    }
    const updated = { ...this.sessions[index], ...update } as IntexAgentSession;
    this.sessions[index] = updated;
    return updated;
  }

  async appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    this.events.push(event);
  }
}

function fixedTestIds(): {
  sessionId(): string;
  eventId(): string;
  confirmationId(): string;
} {
  let sequence = 0;
  return {
    sessionId: (): string => {
      sequence += 1;
      return `intex_session_test_${String(sequence)}`;
    },
    eventId: (): string => {
      sequence += 1;
      return `intex_event_test_${String(sequence)}`;
    },
    confirmationId: (): string => {
      sequence += 1;
      return `intex_confirmation_test_${String(sequence)}`;
    },
  };
}

function silentLogger(): { info(): void; warn(): void; error(): void } {
  return {
    info(): void {
      return undefined;
    },
    warn(): void {
      return undefined;
    },
    error(): void {
      return undefined;
    },
  };
}
