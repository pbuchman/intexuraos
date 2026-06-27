import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import { INTEX_AGENT_MODEL } from '../../domain/agent/systemPrompt.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../../domain/sessions/types.js';

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

  async handle(input: unknown): Promise<{ sessionId: string }> {
    this.calls.push(input);
    return { sessionId: 'session-1' };
  }
}

describe('intex-agent routes', () => {
  let app: FastifyInstance;
  let sessionRepository: FakeSessionRepository;
  let incomingMessageHandler: FakeIncomingMessageHandler;

  beforeEach(async () => {
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
      },
      sessionRepository,
      incomingMessageHandler,
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
