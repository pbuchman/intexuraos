import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { err, ok, type Result } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import {
  resetServices,
  resolveRuntimeSettingsWithDeadline,
  setServices,
  type ServiceContainer,
} from '../../services.js';
import type {
  IntexAgentRuntimeSettingsClient,
  IntexAgentRuntimeSettingsClientError,
  IntexAgentRuntimeSettingsV1,
} from '@intexuraos/internal-clients';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import {
  emptyPromptPreferences,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferenceVersionSummary,
  type IntexAgentPromptPreferences,
} from '../../domain/preferences/promptPreferences.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../../domain/sessions/types.js';
import {
  handleIncomingMessage,
  type IntexAgentRunner,
} from '../../domain/messages/handleIncomingMessage.js';
import type {
  IncomingMessageHandler,
  IntexIncomingMessage,
} from '../../domain/ports/incomingMessageHandler.js';

const sentryCaptures = vi.hoisted((): unknown[] => []);

vi.mock('@intexuraos/infra-sentry', async () => {
  const actual = await vi.importActual<typeof import('@intexuraos/infra-sentry')>(
    '@intexuraos/infra-sentry'
  );
  return {
    ...actual,
    setupSentryErrorHandler(app: FastifyInstance): void {
      app.addHook('onError', async (_request, _reply, error) => {
        sentryCaptures.push(error);
      });
      actual.setupSentryErrorHandler(app);
    },
  };
});

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

const session: IntexAgentSession = {
  id: 'session-1',
  userId: 'user-1',
  channel: 'whatsapp',
  status: 'completed',
  startedAt: '2026-06-24T10:00:00.000Z',
  endedAt: '2026-06-24T10:01:00.000Z',
  lastUserMessageAt: '2026-06-24T10:00:10.000Z',
  lastAssistantMessageAt: '2026-06-24T10:00:50.000Z',
  startReason: 'no_active_session',
  endReason: 'tool_completed',
  activeTool: 'create_note',
  summary: 'Saved garage code',
};

const event: IntexAgentSessionEvent = {
  id: 'event-1',
  sessionId: 'session-1',
  userId: 'user-1',
  type: 'assistant_message',
  payload: { text: 'Saved this as a note.' },
  createdAt: '2026-06-24T10:00:50.000Z',
};

class FakeSessionRepository {
  listSessionsCalls: string[] = [];
  getSessionCalls: { sessionId: string; userId: string }[] = [];
  listEventsCalls: { sessionId: string; userId: string }[] = [];
  sessions: IntexAgentSession[] = [session];
  events: IntexAgentSessionEvent[] = [event];

  async listSessions(userId: string): Promise<IntexAgentSession[]> {
    this.listSessionsCalls.push(userId);
    return this.sessions;
  }

  async getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    this.getSessionCalls.push({ sessionId, userId });
    return this.sessions.find((candidate) => candidate.id === sessionId && candidate.userId === userId) ?? null;
  }

  async listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    this.listEventsCalls.push({ sessionId, userId });
    return this.events.filter(
      (candidate) => candidate.sessionId === sessionId && candidate.userId === userId
    );
  }

  async findOpenSession(): Promise<IntexAgentSession | null> {
    return null;
  }

  async findContinuableSession(): Promise<IntexAgentSession | null> {
    return null;
  }

  async createSession(draft: IntexAgentSession): Promise<IntexAgentSession> {
    this.sessions.push(draft);
    return draft;
  }

  async updateSession(sessionId: string, update: Partial<IntexAgentSession>): Promise<IntexAgentSession> {
    const index = this.sessions.findIndex((candidate) => candidate.id === sessionId);
    if (index < 0) {
      throw new Error(`Missing session ${sessionId}`);
    }
    const updated = { ...this.sessions[index], ...update } as IntexAgentSession;
    this.sessions[index] = updated;
    return updated;
  }

  async appendEvent(nextEvent: IntexAgentSessionEvent): Promise<void> {
    this.events.push(nextEvent);
  }
}

class FakeIncomingMessageHandler {
  calls: unknown[] = [];
  implementation?: IncomingMessageHandler['handle'];

  async handle(input: IntexIncomingMessage): Promise<{ sessionId: string }> {
    this.calls.push(input);
    if (this.implementation !== undefined) {
      return await this.implementation(input);
    }
    return { sessionId: 'session-1' };
  }
}

function createUnusedPromptPreferencesRepository(): ServiceContainer['promptPreferencesRepository'] {
  return {
    async getCurrent(userId: string): Promise<IntexAgentPromptPreferences> {
      return emptyPromptPreferences(userId);
    },
    async listVersions(): Promise<IntexAgentPromptPreferenceVersionSummary[]> {
      return [];
    },
    async getVersion(): Promise<IntexAgentPromptPreferenceVersion | null> {
      return null;
    },
    async addItem(): Promise<IntexAgentPromptPreferences> {
      throw new Error('not used in session route tests');
    },
    async updateItem(): Promise<IntexAgentPromptPreferences> {
      throw new Error('not used in session route tests');
    },
    async deleteItem(): Promise<IntexAgentPromptPreferences> {
      throw new Error('not used in session route tests');
    },
  };
}

describe('intex-agent routes', () => {
  let app: FastifyInstance;
  let sessionRepository: FakeSessionRepository;
  let incomingMessageHandler: FakeIncomingMessageHandler;

  beforeEach(async () => {
    sentryCaptures.length = 0;
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'user-1', claims: {} });
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    sessionRepository = new FakeSessionRepository();
    incomingMessageHandler = new FakeIncomingMessageHandler();

    setServices({
      config: {
        port: 8080,
        host: '127.0.0.1',
        gcpProjectId: 'test-project',
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        userServiceUrl: 'http://user-service.test',
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
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
      testRunsRead: { enabled: false },
      },
      sessionRepository,
      preferencesRepository: {
        async getPreferences(): Promise<null> {
          return null;
        },
        async savePreferences(): Promise<never> {
          throw new Error('not used in session route tests');
        },
        async deletePreferences(): Promise<void> {
          /* noop */
        },
      },
      promptPreferencesRepository: createUnusedPromptPreferencesRepository(),
      externalSaveTester: {
        async testConnection(): Promise<{ ok: true; status: 'success'; message: string }> {
          return { ok: true, status: 'success', message: 'Connection successful' } as const;
        },
      },
      incomingMessageHandler,
      testConversationRunner: {
        async run(): Promise<never> {
          throw new Error('not used in session route tests');
        },
      },
    } satisfies ServiceContainer);

    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  it('lists sessions for the authenticated user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [{ id: 'session-1', userId: 'user-1', status: 'completed' }],
    });
    expect(sessionRepository.listSessionsCalls).toEqual(['user-1']);
  });

  it('derives a missing session summary from the first user message', async () => {
    const { activeTool: _activeTool, summary: _summary, ...sessionWithoutTitle } = session;
    sessionRepository.sessions = [
      {
        ...sessionWithoutTitle,
        id: 'session-without-summary',
        status: 'unsupported',
        endReason: 'unsupported_request',
      },
    ];
    sessionRepository.events = [
      {
        ...event,
        id: 'user-event',
        sessionId: 'session-without-summary',
        type: 'user_message',
        payload: { text: 'What are events in my calendar tomorrow?' },
      },
    ];

    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [
        {
          id: 'session-without-summary',
          summary: 'What are events in my calendar tomorrow?',
        },
      ],
    });
    expect(sessionRepository.listEventsCalls).toEqual([
      { sessionId: 'session-without-summary', userId: 'user-1' },
    ]);
  });

  it('truncates derived session summaries from long user messages', async () => {
    const { activeTool: _activeTool, summary: _summary, ...sessionWithoutTitle } = session;
    const longText = 'Review every calendar event tomorrow and explain which ones need preparation';
    const repeatedText = `${longText} ${longText} ${longText}`;
    sessionRepository.sessions = [
      {
        ...sessionWithoutTitle,
        id: 'session-long-summary',
        status: 'unsupported',
        endReason: 'unsupported_request',
      },
    ];
    sessionRepository.events = [
      {
        ...event,
        id: 'user-event-long',
        sessionId: 'session-long-summary',
        type: 'user_message',
        payload: { text: repeatedText },
      },
    ];

    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [
        {
          id: 'session-long-summary',
          summary: `${repeatedText.slice(0, 117)}...`,
        },
      ],
    });
  });

  it('leaves titleless sessions unchanged when user message text is unusable', async () => {
    const { activeTool: _activeTool, summary: _summary, ...sessionWithoutTitle } = session;
    sessionRepository.sessions = [
      {
        ...sessionWithoutTitle,
        id: 'session-non-string-title',
        status: 'unsupported',
        endReason: 'unsupported_request',
      },
      {
        ...sessionWithoutTitle,
        id: 'session-blank-title',
        status: 'unsupported',
        endReason: 'unsupported_request',
      },
    ];
    sessionRepository.events = [
      {
        ...event,
        id: 'user-event-non-string',
        sessionId: 'session-non-string-title',
        type: 'user_message',
        payload: { text: 42 },
      },
      {
        ...event,
        id: 'user-event-blank',
        sessionId: 'session-blank-title',
        type: 'user_message',
        payload: { text: '  \n  ' },
      },
    ];

    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ id: 'session-non-string-title' });
    expect(body.data[0]).not.toHaveProperty('summary');
    expect(body.data[1]).toMatchObject({ id: 'session-blank-title' });
    expect(body.data[1]).not.toHaveProperty('summary');
  });

  it('does not list sessions when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionRepository.listSessionsCalls).toEqual([]);
  });

  it('returns a single session for the authenticated user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions/session-1',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { id: 'session-1', userId: 'user-1', status: 'completed' },
    });
    expect(sessionRepository.getSessionCalls).toEqual([{ sessionId: 'session-1', userId: 'user-1' }]);
  });

  it('does not return a session when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/session-1',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionRepository.getSessionCalls).toEqual([]);
  });

  it('returns 404 for a missing session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions/missing',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns session events for the authenticated user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions/session-1/events',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [{ id: 'event-1', sessionId: 'session-1', type: 'assistant_message' }],
    });
    expect(sessionRepository.listEventsCalls).toEqual([{ sessionId: 'session-1', userId: 'user-1' }]);
    expect(sessionRepository.getSessionCalls).toEqual([{ sessionId: 'session-1', userId: 'user-1' }]);
  });

  it('returns the static 404 before event reads for a missing or foreign session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sessions/missing/events',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(sessionRepository.getSessionCalls).toEqual([
      { sessionId: 'missing', userId: 'user-1' },
    ]);
    expect(sessionRepository.listEventsCalls).toEqual([]);
  });

  it('hides Matrix corpus sessions from list, detail, and events with the ordinary static 404', async () => {
    const matrixSession: IntexAgentSession = {
      ...session,
      id: 'private-matrix-session',
      matrixCorpusProfile: {} as NonNullable<IntexAgentSession['matrixCorpusProfile']>,
      lastEventSequence: 0,
    };
    sessionRepository.sessions = [session, matrixSession];
    sessionRepository.events = [
      event,
      { ...event, id: 'private-event', sessionId: 'private-matrix-session' },
    ];

    const list = await app.inject({
      method: 'GET',
      url: '/sessions',
      headers: { authorization: 'Bearer test-token' },
    });
    const detail = await app.inject({
      method: 'GET',
      url: '/sessions/private-matrix-session',
      headers: { authorization: 'Bearer test-token' },
    });
    const eventsResponse = await app.inject({
      method: 'GET',
      url: '/sessions/private-matrix-session/events',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(detail.statusCode).toBe(404);
    expect(eventsResponse.statusCode).toBe(404);
    expect(sessionRepository.listEventsCalls).not.toContainEqual({
      sessionId: 'private-matrix-session',
      userId: 'user-1',
    });
  });

  it('does not return events when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/session-1/events',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionRepository.listEventsCalls).toEqual([]);
  });

  it('requires internal auth for inbound WhatsApp Assistant messages', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      payload: {
        type: 'intex.message.ingest',
        userId: 'user-1',
        messageId: 'wamid-1',
        text: 'Remember the garage code is 7241',
        sourceType: 'text',
        timestamp: '2026-06-24T10:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts inbound WhatsApp Assistant messages with internal auth', async () => {
    const payload = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'Remember the garage code is 7241',
      sourceType: 'text',
      timestamp: '2026-06-24T10:00:00.000Z',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { accepted: true, sessionId: 'session-1' },
    });
    expect(incomingMessageHandler.calls).toEqual([payload]);
  });

  it('returns normal 202 when runtime resolution is handled as a local fallback', async () => {
    const published: string[] = [];
    const run = vi.fn<IntexAgentRunner['run']>();
    const logger = { warn: vi.fn() };
    incomingMessageHandler.implementation = async (
      input
    ): ReturnType<IncomingMessageHandler['handle']> =>
      await handleIncomingMessage(input, {
        sessionRepository,
        runner: {
          run,
          async executeConfirmed(): Promise<never> {
            throw new Error('not used');
          },
        },
        replyPublisher: {
          async publishReply(reply): Promise<void> {
            published.push(reply.message);
          },
        },
        clock: { now: () => '2026-06-24T10:00:00.000Z' },
        resolveRuntimeSettings: async () =>
          err({ code: 'MALFORMED_RESPONSE', message: 'private-runtime-body-sentinel' }),
        logger,
        ids: {
          sessionId: () => 'session-runtime-failure',
          eventId: () => `event-runtime-${String(sessionRepository.events.length + 1)}`,
          confirmationId: () => 'confirmation-unused',
        },
        sessionTimeoutMs: 30 * 60 * 1_000,
      });
    const payload = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-runtime-failure',
      text: 'Create a note',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T10:00:00.000Z',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { accepted: true, sessionId: 'session-runtime-failure' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(published).toEqual([
      'I could not process that request right now. Please restate what you want me to do.',
    ]);
    expect(JSON.stringify({ events: sessionRepository.events, published, logs: logger.warn.mock.calls }))
      .not.toContain('private-runtime-body-sentinel');
  });

  it.each(['late_resolve', 'late_reject'] as const)(
    'keeps one private 202 timeout outcome after $s',
    async (lateOutcome) => {
        let fireDeadline: (() => void) | undefined;
        const clearedDeadlineHandles: unknown[] = [];
        const deadlineHandle = { id: 'runtime-deadline' };
        const scheduler = {
          setTimeout(callback: () => void, delayMs: number): unknown {
            expect(delayMs).toBe(2_000);
            fireDeadline = callback;
            return deadlineHandle;
          },
          clearTimeout(handle: unknown): void {
            clearedDeadlineHandles.push(handle);
          },
        };
        type RuntimeResult = Result<
          IntexAgentRuntimeSettingsV1,
          IntexAgentRuntimeSettingsClientError
        >;
        let resolveLate: ((value: RuntimeResult) => void) | undefined;
        let rejectLate: ((reason: unknown) => void) | undefined;
        let markLookupStarted: (() => void) | undefined;
        const lookupStarted = new Promise<void>((resolve) => {
          markLookupStarted = resolve;
        });
        const client: Pick<
          IntexAgentRuntimeSettingsClient,
          'resolveIntexAgentRuntimeSettings'
        > = {
          resolveIntexAgentRuntimeSettings: vi.fn(
            async () =>
              await new Promise<RuntimeResult>((resolve, reject) => {
                resolveLate = resolve;
                rejectLate = reject;
                markLookupStarted?.();
              })
          ),
        };
        const published: string[] = [];
        const run = vi.fn<IntexAgentRunner['run']>();
        const logger = { warn: vi.fn() };
        incomingMessageHandler.implementation = async (
          input
        ): ReturnType<IncomingMessageHandler['handle']> =>
          await handleIncomingMessage(input, {
            sessionRepository,
            runner: {
              run,
              async executeConfirmed(): Promise<never> {
                throw new Error('not used');
              },
            },
            replyPublisher: {
              async publishReply(reply): Promise<void> {
                published.push(reply.message);
              },
            },
            clock: { now: () => '2026-06-24T10:00:00.000Z' },
            resolveRuntimeSettings: async (userId) =>
              await resolveRuntimeSettingsWithDeadline(userId, client, scheduler),
            logger,
            ids: {
              sessionId: () => `session-timeout-${lateOutcome}`,
              eventId: () => `event-timeout-${String(sessionRepository.events.length + 1)}`,
              confirmationId: () => 'confirmation-unused',
            },
            sessionTimeoutMs: 30 * 60 * 1_000,
          });
        const payload = {
          type: 'intex.message.ingest',
          userId: 'user-1',
          messageId: `wamid-timeout-${lateOutcome}`,
          text: 'Create a note',
          sourceType: 'whatsapp_text',
          timestamp: '2026-06-24T10:00:00.000Z',
        };

        const responsePromise = app.inject({
          method: 'POST',
          url: '/internal/intex-agent/messages',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload,
        });
        await lookupStarted;
        if (fireDeadline === undefined) throw new Error('runtime deadline was not scheduled');
        fireDeadline();
        const response = await responsePromise;

        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toMatchObject({
          success: true,
          data: { accepted: true, sessionId: `session-timeout-${lateOutcome}` },
        });
        expect(run).not.toHaveBeenCalled();
        expect(client.resolveIntexAgentRuntimeSettings).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls).toEqual([
          [
            { reason: 'runtime_settings_resolution_failed' },
            'Intex Agent runtime settings resolution failed',
          ],
        ]);
        expect(published).toEqual([
          'I could not process that request right now. Please restate what you want me to do.',
        ]);
        const timeoutEvents = sessionRepository.events.filter(
          (candidate) => candidate.sessionId === `session-timeout-${lateOutcome}`
        );
        expect(timeoutEvents.map((candidate) => candidate.type)).toEqual([
          'session_started',
          'user_message',
          'agent_fallback',
          'clarification_requested',
          'assistant_message',
        ]);
        expect(timeoutEvents.every((candidate) => candidate.userId === 'user-1')).toBe(true);
        expect(
          sessionRepository.sessions.find(
            (candidate) => candidate.id === `session-timeout-${lateOutcome}`
          )
        ).toMatchObject({ status: 'waiting_for_user' });
        expect(sentryCaptures).toEqual([]);
        expect(clearedDeadlineHandles).toEqual([deadlineHandle]);

        const stableOutcome = JSON.stringify({
          timeoutEvents,
          published,
          warnings: logger.warn.mock.calls,
          sessions: sessionRepository.sessions,
          sentryCaptures,
        });
        if (lateOutcome === 'late_resolve') {
          resolveLate?.(
            ok({
              status: 'available',
              effectiveModel: IntexAgentModels.Gemini36Flash,
              explicitModel: IntexAgentModels.Gemini36Flash,
              source: 'explicit',
              revision: 77,
              timeZone: 'Raw/late-resolve-timezone-sentinel',
            })
          );
        } else {
          rejectLate?.(
            new Error(
              'raw-resolver-user-sentinel https://private.invalid/raw provider-sentinel model-sentinel late-reject-cause'
            )
          );
        }
        await Promise.resolve();
        await Promise.resolve();

        expect(
          JSON.stringify({
            timeoutEvents: sessionRepository.events.filter(
              (candidate) => candidate.sessionId === `session-timeout-${lateOutcome}`
            ),
            published,
            warnings: logger.warn.mock.calls,
            sessions: sessionRepository.sessions,
            sentryCaptures,
          })
        ).toBe(stableOutcome);
        expect(stableOutcome).not.toMatch(
          /raw-resolver-user-sentinel|private\.invalid|provider-sentinel|model-sentinel|late-reject-cause|late-resolve-timezone-sentinel/iu
        );
    }
  );

  it('accepts Pub/Sub push payloads for inbound WhatsApp Assistant messages', async () => {
    const eventPayload = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-2',
      text: 'Create a calendar event tomorrow at 9',
      sourceType: 'whatsapp_text',
      whatsappSender: '+48123456789',
      timestamp: '2026-06-24T11:00:00.000Z',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        message: {
          data: Buffer.from(JSON.stringify(eventPayload)).toString('base64'),
          messageId: 'pubsub-message-1',
          publishTime: '2026-06-24T11:00:00.000Z',
        },
        subscription: 'projects/test/subscriptions/intex-message-ingest',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { accepted: true, sessionId: 'session-1' },
    });
    expect(incomingMessageHandler.calls).toContainEqual(eventPayload);
  });

  it('accepts Pub/Sub push payloads authenticated by Cloud Run OIDC headers', async () => {
    const eventPayload = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-3',
      text: 'Remember passport is in the top drawer',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T12:00:00.000Z',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { from: 'noreply@google.com' },
      payload: {
        message: {
          data: Buffer.from(JSON.stringify(eventPayload)).toString('base64'),
          messageId: 'pubsub-message-2',
        },
        subscription: 'projects/test/subscriptions/intex-message-ingest',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(incomingMessageHandler.calls).toContainEqual(eventPayload);
  });
});
