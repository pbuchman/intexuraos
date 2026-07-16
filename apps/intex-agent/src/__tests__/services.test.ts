import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestConversationRunnerService,
  type AgentRunnerFactory,
  type CreateTestConversationRunnerServiceInput,
} from '../services.js';
import { INTEX_AGENT_MODEL } from '../domain/agent/systemPrompt.js';
import {
  addPromptPreferenceItem,
  deletePromptPreferenceItem,
  emptyPromptPreferences,
} from '../domain/preferences/promptPreferences.js';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../domain/messages/handleIncomingMessage.js';
import type {
  SessionRepository,
  SessionRepositorySessionUpdate,
} from '../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../domain/sessions/types.js';

describe('createTestConversationRunnerService', () => {
  it('wires real conversation flow with mocked tools and no downstream clients', async () => {
    const repository = new MemorySessionRepository();
    const promptPreferenceCalls: string[] = [];
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((config): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        const rawResult = await config.toolExecutor.queryCalendarEvents({
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
        });
        const toolResult = JSON.parse(rawResult) as Record<string, unknown>;
        return {
          outcome: 'completed',
          reply: `Calendar mock count: ${String(toolResult['count'])}`,
          toolName: 'query_calendar_events',
          toolResult,
        };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepository(promptPreferenceCalls),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      createToolCallingClientFn,
      createLlmClientFn,
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    const result = await runner.run({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: 'test-intex-agent-intex-e2e-services',
      runId: 'intex-e2e-services',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      turns: [
        {
          kind: 'message',
          text: 'Jakie wydarzenia jutro? intex-e2e-services',
        },
      ],
      toolMocks: {
        query_calendar_events: {
          mode: 'success',
          result: {
            status: 'completed',
            mode: 'list',
            count: 2,
            events: [{ summary: 'private event' }],
          },
        },
      },
    });

    expect(promptPreferenceCalls).toEqual(['test-intex-agent-intex-e2e-services']);
    expect(createToolCallingClientFn).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'openrouter-key',
        model: INTEX_AGENT_MODEL,
        userId: 'test-intex-agent-intex-e2e-services',
      })
    );
    expect(createLlmClientFn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'test-intex-agent-intex-e2e-services' })
    );
    expect(createAgentRunnerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolExecutor: expect.anything(),
        userPreferences: [
          'rendered test preferences',
          'Use expectedVersion 0 for preference mutation tools.',
        ].join('\n'),
      })
    );
    expect(result.toolCalls).toEqual([
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: {
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
        },
        resultSummary: { status: 'completed', mode: 'list', count: 2 },
      },
    ]);
    expect(result.turns[0]?.assistantReplies[0]?.message).toBe('Calendar mock count: 2');
    expect(JSON.stringify(result)).not.toContain('private event');
  });

  it('wires confirmed execution through mocked tools only', async () => {
    const repository = new MemorySessionRepository();
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((config): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        return {
          outcome: 'needs_confirmation',
          reply:
            'Add this note?\nContent: secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
          toolName: 'create_note',
          toolArgs: {
            content: 'secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
          },
        };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        const rawResult = await config.toolExecutor.createNote({
          content: 'secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
        });
        const toolResult = JSON.parse(rawResult) as Record<string, unknown>;
        return {
          outcome: 'completed',
          reply: `Confirmed note status: ${String(toolResult['status'])}`,
          toolName: 'create_note',
          toolResult,
        };
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    const result = await runner.run({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      userId: 'test-intex-agent-intex-e2e-confirm-service',
      runId: 'intex-e2e-confirm-service',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      turns: [
        {
          kind: 'message',
          text: 'Save note INTEX-EVAL-001 INTEX-EVAL-001-F01 intex-e2e-confirm-service',
        },
        { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' },
      ],
      toolMocks: {
        create_note: {
          mode: 'success',
          result: { status: 'completed', resourceUrl: '/#/notes/mock-note' },
        },
      },
    });

    expect(createAgentRunnerFn).toHaveBeenCalledTimes(2);
    expect(result.turns[1]?.assistantReplies[0]?.message).toBe('Confirmed note status: completed');
    const expectedArgsSummary = {
      contentLength: 53,
      syntheticMarkerCount: 2,
      syntheticMarkerDigest: markerDigest(['INTEX-EVAL-001', 'INTEX-EVAL-001-F01']),
    };
    expect(result.toolCalls).toEqual([
      {
        toolName: 'create_note',
        status: 'completed',
        argsSummary: expectedArgsSummary,
        resultSummary: { status: 'completed' },
      },
    ]);
    const confirmationRequested = Object.values(result.eventsBySessionId)
      .flat()
      .find((event) => event.type === 'confirmation_requested');
    expect(confirmationRequested?.payload['argsSummary']).toEqual(expectedArgsSummary);
    expect(JSON.stringify(confirmationRequested?.payload)).not.toMatch(/secret service|INTEX-EVAL/iu);
    expect(JSON.stringify(result.toolCalls)).not.toMatch(/secret service|INTEX-EVAL/iu);
    expect(result.turns[0]?.submittedTextPreview).toContain('INTEX-EVAL-001-F01');
    const resultWithoutSubmittedText = {
      ...result,
      turns: result.turns.map(({ submittedTextPreview: _submittedTextPreview, ...turn }) => turn),
      behavioralTranscript: {
        turns: result.behavioralTranscript.turns.map(
          ({ submittedTextPreview: _submittedTextPreview, ...turn }) => turn
        ),
      },
    };
    expect(JSON.stringify(resultWithoutSubmittedText)).not.toContain('INTEX-EVAL');
    expect(JSON.stringify(result)).not.toContain('secret service test');
  });

  it('generates fresh deployed-mode ids for separate runs when ids are not injected', async () => {
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn: vi.fn((): IntexAgentRunner => ({
        async run(): Promise<IntexAgentRunnerResult> {
          return { outcome: 'no_action', reply: 'Ready.' };
        },
        async executeConfirmed(): Promise<IntexAgentRunnerResult> {
          throw new Error('not used');
        },
      })),
    });

    const first = await runner.run(testRequest('fresh-one'));
    const second = await runner.run(testRequest('fresh-two'));

    expect(first.finalSessionId).toMatch(/^intex_session_/u);
    expect(second.finalSessionId).toMatch(/^intex_session_/u);
    expect(first.finalSessionId).not.toBe(second.finalSessionId);
    expect(first.eventsBySessionId[first.finalSessionId ?? '']?.[0]?.id).toMatch(/^intex_event_/u);
    expect(second.eventsBySessionId[second.finalSessionId ?? '']?.[0]?.id).toMatch(/^intex_event_/u);
  });

  it('passes an empty-but-versioned preference context to the runner', async () => {
    const repository = new MemorySessionRepository();
    const added = addPromptPreferenceItem(emptyPromptPreferences('user-versioned-empty'), {
      id: 'pref_focus',
      text: 'Prefer concise replies.',
      now: '2026-07-04T10:00:00.000Z',
      updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
    });
    const deleted = deletePromptPreferenceItem(added.current, {
      itemId: 'pref_focus',
      now: '2026-07-04T10:01:00.000Z',
      updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
    });
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        return { outcome: 'no_action', reply: 'Ready.' };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepositoryWithCurrent(deleted.current),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    await runner.run({
      ...testRequest('versioned-empty'),
      userId: 'user-versioned-empty',
    });

    expect(createAgentRunnerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userPreferences: [
          'User Preferences v2:',
          'No active preference rows are currently defined.',
          'Use expectedVersion 2 for add_user_preference.',
        ].join('\n'),
      })
    );
  });
});

function testRequest(runId: string): Parameters<ReturnType<typeof createTestConversationRunnerService>['run']>[0] {
  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    userId: `test-intex-agent-${runId}`,
    runId,
    currentDateTime: '2026-07-01T10:00:00.000Z',
    turns: [{ kind: 'message', text: `Ping ${runId}` }],
  };
}

function markerDigest(markers: readonly string[]): string {
  return createHash('sha256')
    .update(`intex-eval-marker-set:v1\0${[...markers].sort().join('\n')}`, 'utf8')
    .digest('hex');
}

function testConfig(): CreateTestConversationRunnerServiceInput['config'] {
  return {
    port: 8080,
    host: '127.0.0.1',
    gcpProjectId: 'test-project',
    internalAuthToken: 'internal-token',
    notesAgentUrl: 'http://notes-agent.test',
    calendarAgentUrl: 'http://calendar-agent.test',
    researchAgentUrl: 'http://research-agent.test',
    bookmarksAgentUrl: 'http://bookmarks-agent.test',
    codeAgentUrl: 'http://code-agent.test',
    webAppUrl: 'https://intexuraos.cloud',
    llmUsageServiceUrl: 'http://llm-usage.test',
    openRouterAppApiKey: 'openrouter-key',
    whatsappSendTopic: 'whatsapp-send',
    sessionTimeoutMs: 30 * 60 * 1000,
    model: INTEX_AGENT_MODEL,
  };
}

function promptPreferencesRepository(
  calls: string[]
): CreateTestConversationRunnerServiceInput['promptPreferencesRepository'] {
  return {
    async getCurrent(userId: string): Promise<ReturnType<typeof emptyPromptPreferences>> {
      calls.push(userId);
      return { ...emptyPromptPreferences(userId), renderedPromptBlock: 'rendered test preferences' };
    },
    async listVersions(): Promise<[]> {
      return [];
    },
    async getVersion(): Promise<null> {
      return null;
    },
    async addItem(): Promise<never> {
      throw new Error('not used');
    },
    async updateItem(): Promise<never> {
      throw new Error('not used');
    },
    async deleteItem(): Promise<never> {
      throw new Error('not used');
    },
  };
}

function promptPreferencesRepositoryWithCurrent(
  current: ReturnType<typeof emptyPromptPreferences>
): CreateTestConversationRunnerServiceInput['promptPreferencesRepository'] {
  return {
    async getCurrent(): Promise<ReturnType<typeof emptyPromptPreferences>> {
      return current;
    },
    async listVersions(): Promise<[]> {
      return [];
    },
    async getVersion(): Promise<null> {
      return null;
    },
    async addItem(): Promise<never> {
      throw new Error('not used');
    },
    async updateItem(): Promise<never> {
      throw new Error('not used');
    },
    async deleteItem(): Promise<never> {
      throw new Error('not used');
    },
  };
}

function fakeToolCallingClient(): ReturnType<
  NonNullable<CreateTestConversationRunnerServiceInput['createToolCallingClientFn']>
> {
  return { run: vi.fn() } as ReturnType<
    NonNullable<CreateTestConversationRunnerServiceInput['createToolCallingClientFn']>
  >;
}

function fakeStructuredClient(): ReturnType<
  NonNullable<CreateTestConversationRunnerServiceInput['createLlmClientFn']>
> {
  return { generate: vi.fn() } as ReturnType<
    NonNullable<CreateTestConversationRunnerServiceInput['createLlmClientFn']>
  >;
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

function fixedTestIds(): NonNullable<CreateTestConversationRunnerServiceInput['ids']> {
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

function silentLogger(): CreateTestConversationRunnerServiceInput['logger'] {
  return {
    debug(): void {
      return undefined;
    },
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
