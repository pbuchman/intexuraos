import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import { emptyPromptPreferences } from '../../domain/preferences/promptPreferences.js';
import type { TestConversationResponse } from '../../domain/testConversation/testConversationTypes.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1', claims: {} }),
    logIncomingRequest: vi.fn(),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

interface RoutePayload {
  contractVersion: string;
  mode: string;
  agentModel: string;
  runId: string;
  userId: string;
  currentDateTime: string;
  timeZone: string;
  turns: Record<string, unknown>[];
  toolMocks?: Record<string, unknown>;
}

interface RouteErrorResponse {
  error: {
    message: string;
    details?: {
      errors: { path: string; message: string }[];
    };
  };
}

describe('test conversation routes', () => {
  let app: FastifyInstance;
  let testConversationRunner: FakeTestConversationRunner;
  let logChunks: string[];
  let previousLogLevel: string | undefined;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'user-1', claims: {} });
    vi.mocked(logIncomingRequest).mockClear();
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_ENVIRONMENT'] = 'dev';
    previousLogLevel = process.env['LOG_LEVEL'];
    process.env['LOG_LEVEL'] = 'info';
    testConversationRunner = new FakeTestConversationRunner();
    logChunks = [];

    setServices(createRouteTestServices(testConversationRunner));
    app = await buildServer(createLoggerCapture(logChunks));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_ENVIRONMENT'];
    if (previousLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = previousLogLevel;
    }
  });

  it('requires internal auth and does not accept Pub/Sub from header bypass', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      payload: validPayload(),
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': 'wrong' },
      payload: validPayload(),
    });
    const fromBypass = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { from: 'noreply@google.com' },
      payload: validPayload(),
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(fromBypass.statusCode).toBe(401);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('returns 401 when internal auth token is unset', async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('is disabled in production before auth-specific behavior', async () => {
    process.env['INTEXURAOS_ENVIRONMENT'] = 'prod';

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(404);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('returns production 404 before body parsing and validation', async () => {
    process.env['INTEXURAOS_ENVIRONMENT'] = 'prod';

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    });

    expect(response.statusCode).toBe(404);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it.each([
    ['non-test user id', { userId: 'auth0|real-user' }],
    ['run id mismatch', { userId: 'test-intex-agent-other-run' }],
    ['run id only matches namespace prefix', { runId: 'agent', userId: 'test-intex-agent-other-run' }],
    ['bad run id characters', { runId: 'INTEX-E2E-ROUTE', userId: 'test-intex-agent-INTEX-E2E-ROUTE' }],
    ['scripted runner mode', { mode: 'scripted_runner' }],
    ['missing agent model', { agentModel: undefined }],
    ['wrong agent model', { agentModel: 'or:google/gemini-3-flash-preview' }],
    ['invalid current date', { currentDateTime: 'not-a-date' }],
    ['invalid IANA time zone', { timeZone: 'Mars/Olympus' }],
    ['tool mocks must be object', { toolMocks: null }],
    ['tool mock mode must be known', { toolMocks: { create_note: { mode: 'bad' } } }],
    ['too long text', { turns: [{ ...(validPayload().turns[0] ?? {}), text: 'x'.repeat(4001) }] }],
    [
      'confirmation points to current turn',
      { turns: [{ kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' }] },
    ],
    [
      'too long source url',
      {
        turns: [
          {
            ...(validPayload().turns[0] ?? {}),
            sourceUrl: 'https://example.com/'.concat('x'.repeat(2048)),
          },
        ],
      },
    ],
    ['unknown tool mock', { toolMocks: { unknown_tool: { mode: 'success', result: { status: 'completed' } } } }],
    ['secret-like mock field', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', token: 'secret' } } } }],
    ['prompt block mock field', { toolMocks: { get_user_preferences: { mode: 'success', result: { status: 'completed', promptBlock: 'secret preferences' } } } }],
    ['arbitrary primitive mock field', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed', arbitrary: 'value' } } } }],
    ['extra success wrapper field', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed' }, token: 'secret' } } }],
    ['extra failure wrapper field', { toolMocks: { create_note: { mode: 'failure', message: 'fail', token: 'secret' } } }],
    ['tool failure message must be string', { toolMocks: { create_note: { mode: 'failure', message: 123 } } }],
    ['tool failure message too long', { toolMocks: { create_note: { mode: 'failure', message: 'x'.repeat(2049) } } }],
    ['tool failure message contains secret-like text', { toolMocks: { create_note: { mode: 'failure', message: 'token abc' } } }],
    ['tool success result must be object', { toolMocks: { create_note: { mode: 'success', result: null } } }],
    ['tool result allowed field unsupported type', { toolMocks: { create_note: { mode: 'success', result: { status: { nested: true } } } } }],
    ['tool result string too long', { toolMocks: { create_note: { mode: 'success', result: { status: 'x'.repeat(2049) } } } }],
    ['tool result array too large', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed', items: Array.from({ length: 21 }, (_, index) => index) } } } }],
    ['tool result array objects blocked', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed', items: [{ id: 1 }] } } } }],
    ['tool result nested object blocked', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed', nested: { id: 1 } } } } }],
    ['tool result url must be bounded', { toolMocks: { create_note: { mode: 'success', result: { status: 'completed', resourceUrl: 'ftp://example.com/note' } } } }],
    ['calendar event mock must be object', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: ['bad'] } } } }],
    ['calendar event mock field allowlist', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ token: 'secret' }] } } } }],
    ['calendar event mock string too long', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ summary: 'x'.repeat(2049) }] } } } }],
    ['calendar event mock unsupported type', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ summary: { nested: true } }] } } } }],
    ['calendar event mock date field allowlist', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ start: { token: 'secret' } }] } } } }],
    ['calendar event mock date field type', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ start: { dateTime: 123 } }] } } } }],
    ['calendar event mock date string too long', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ start: { dateTime: 'x'.repeat(2049) } }] } } } }],
    ['calendar event mock date identity', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 1, events: [{ start: { date: '2026-07-02', dateTime: '2026-07-02T10:00:00+02:00' } }] } } } }],
    ['calendar event mock array too large', { toolMocks: { query_calendar_events: { mode: 'success', result: { status: 'completed', mode: 'list', count: 21, events: Array.from({ length: 21 }, () => ({ summary: 'event' })) } } } }],
    ['preference item mock array objects blocked', { toolMocks: { get_user_preferences: { mode: 'success', result: { status: 'completed', currentVersion: 1, items: [{ id: 'pref_1' }] } } } }],
  ])('rejects invalid payload: %s', async (_label, override) => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { ...validPayload(), ...override },
    });

    expect(response.statusCode).toBe(400);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('accepts a legacy 2026-07-01 payload without timeZone', async () => {
    const { timeZone: _timeZone, ...payload } = validPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toEqual([expect.not.objectContaining({ timeZone: expect.anything() })]);
  });

  it('accepts 20 message turns', async () => {
    const turns = validMessageTurns(20);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { ...validPayload(), turns },
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toEqual([expect.objectContaining({ turns })]);
  });

  it('rejects 21 message turns at schema validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { ...validPayload(), turns: validMessageTurns(21) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<RouteErrorResponse>().error).toMatchObject({
      message: 'Validation failed',
      details: {
        errors: [{ path: 'turns', message: 'must NOT have more than 20 items' }],
      },
    });
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('accepts confirmation index 19 at schema validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        turns: [{ kind: 'confirmation_button', previousTurnIndex: 19, decision: 'accept' }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<RouteErrorResponse>().error.message).toBe(
      'confirmation_button previousTurnIndex must reference an earlier turn'
    );
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('rejects confirmation index 20 at schema validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        turns: [{ kind: 'confirmation_button', previousTurnIndex: 20, decision: 'accept' }],
      },
    });

    expect(response.statusCode).toBe(400);
    const error = response.json<RouteErrorResponse>().error;
    expect(error.message).toBe('Validation failed');
    expect(error.details?.errors).toContainEqual({
      path: 'turns.0.previousTurnIndex',
      message: 'must be <= 19',
    });
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('accepts a schema-valid request body above 64 KiB', async () => {
    const payload = JSON.stringify({
      ...validPayload(),
      turns: validMessageTurns(20, 4000),
    });

    expect(Buffer.byteLength(payload)).toBeGreaterThan(64 * 1024);
    expect(Buffer.byteLength(payload)).toBeLessThan(256 * 1024);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
  });

  it('accepts app-relative mock result URLs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        toolMocks: {
          create_note: {
            mode: 'success',
            result: { status: 'completed', resourceUrl: '/#/notes/mock-note' },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
  });

  it('accepts bounded non-secret tool failure messages', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        toolMocks: {
          create_note: {
            mode: 'failure',
            message: 'mock note failure',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
  });

  it('accepts bounded calendar event object mocks for query_calendar_events', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        toolMocks: {
          query_calendar_events: {
            mode: 'success',
            result: {
              status: 'completed',
              mode: 'list',
              count: 1,
              truncated: true,
              events: [
                {
                  id: 'event-1',
                  etag: '"event-1-v1"',
                  summary: 'Dentist',
                  calendarId: 'primary',
                  start: { dateTime: '2026-07-02T10:00:00+02:00' },
                  end: { dateTime: '2026-07-02T10:30:00+02:00' },
                },
              ],
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
    expect(testConversationRunner.calls[0]).toMatchObject({
      toolMocks: {
        query_calendar_events: {
          result: { truncated: true },
        },
      },
    });
  });

  it('accepts primitive preference item mock arrays without prompt blocks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: {
        ...validPayload(),
        toolMocks: {
          get_user_preferences: {
            mode: 'success',
            result: { status: 'completed', currentVersion: 1, items: ['pref_1'] },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
  });

  it('accepts omitted toolMocks and uses default mock behavior downstream', async () => {
    const payload = validPayload();
    delete payload.toolMocks;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(testConversationRunner.calls).toHaveLength(1);
  });

  it('returns 500 without leaking runner errors when the use case fails', async () => {
    testConversationRunner.error = new Error('private runner stack with token abc');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private runner stack');
    const logOutput = logChunks.join('');
    expect(logOutput).toContain('Intex-agent test conversation failed');
    expect(logOutput).not.toContain('private runner stack');
    expect(logOutput).not.toContain('token abc');
  });

  it('rejects bodies over 256 KiB with 413', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ ...validPayload(), padding: 'x'.repeat(257 * 1024) }),
    });

    expect(response.statusCode).toBe(413);
    expect(testConversationRunner.calls).toEqual([]);
  });

  it('runs a valid live mocked-tools payload and logs no request body preview', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/test/conversation',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        runId: 'intex-e2e-route',
        sideEffectBoundary: 'mocked_tools_no_downstream_writes',
      },
    });
    expect(testConversationRunner.calls).toHaveLength(1);
    expect(testConversationRunner.calls[0]).toMatchObject({
      mode: 'live_llm_mock_tools',
      runId: 'intex-e2e-route',
      userId: 'test-intex-agent-intex-e2e-route',
      timeZone: 'Europe/Warsaw',
    });
    expect(logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
  });
});

function createLoggerCapture(chunks: string[]): NodeJS.WritableStream {
  return new Writable({
    write(chunk, _encoding, callback): void {
      chunks.push(String(chunk));
      callback();
    },
  });
}

function validPayload(): RoutePayload {
  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    agentModel: 'or:deepseek/deepseek-v4-flash',
    runId: 'intex-e2e-route',
    userId: 'test-intex-agent-intex-e2e-route',
    currentDateTime: '2026-07-01T10:00:00.000Z',
    timeZone: 'Europe/Warsaw',
    turns: [
      {
        kind: 'message',
        messageId: 'wamid-route-1',
        text: 'Jakie wydarzenia jutro? intex-e2e-route',
        timestamp: '2026-07-01T10:00:00.000Z',
      },
    ],
    toolMocks: {
      query_calendar_events: {
        mode: 'success',
        result: { status: 'completed', mode: 'list', count: 0, events: [] },
      },
    },
  };
}

function validMessageTurns(count: number, textLength?: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'message',
    messageId: `wamid-route-${String(index + 1)}`,
    text:
      textLength === undefined
        ? `Message ${String(index + 1)} intex-e2e-route`
        : 'x'.repeat(textLength),
    timestamp: '2026-07-01T10:00:00.000Z',
  }));
}

class FakeTestConversationRunner {
  readonly calls: unknown[] = [];
  error: Error | null = null;

  async run(input: unknown): Promise<TestConversationResponse> {
    this.calls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return {
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      runId: 'intex-e2e-route',
      userId: 'test-intex-agent-intex-e2e-route',
      finalSessionId: 'intex_session_route',
      turns: [],
      toolCalls: [],
      sessions: [],
      sessionTransitions: [],
      eventsBySessionId: {},
      behavioralTranscript: { turns: [] },
      sideEffectBoundary: 'mocked_tools_no_downstream_writes',
      warnings: [],
    };
  }
}

function createRouteTestServices(
  testConversationRunner: FakeTestConversationRunner
): ServiceContainer {
  return {
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
    sessionRepository: new UnusedSessionRepository(),
    preferencesRepository: {
      async getPreferences(): Promise<null> {
        return null;
      },
      async savePreferences(): Promise<never> {
        throw new Error('not used');
      },
      async deletePreferences(): Promise<void> {
        return undefined;
      },
    },
    promptPreferencesRepository: {
      async getCurrent(userId: string): Promise<ReturnType<typeof emptyPromptPreferences>> {
        return emptyPromptPreferences(userId);
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
    },
    externalSaveTester: {
      async testConnection(): Promise<{ ok: true; status: 'success'; message: string }> {
        return { ok: true, status: 'success', message: 'Connection successful' } as const;
      },
    },
    incomingMessageHandler: {
      async handle(): Promise<{ sessionId: string }> {
        return { sessionId: 'unused-session' };
      },
    },
    testConversationRunner,
  };
}

class UnusedSessionRepository {
  async listSessions(): Promise<[]> {
    return [];
  }
  async getSession(): Promise<null> {
    return null;
  }
  async listEvents(): Promise<[]> {
    return [];
  }
  async findOpenSession(): Promise<null> {
    return null;
  }
  async findContinuableSession(): Promise<null> {
    return null;
  }
  async createSession(): Promise<never> {
    throw new Error('not used');
  }
  async updateSession(): Promise<never> {
    throw new Error('not used');
  }
  async appendEvent(): Promise<void> {
    return undefined;
  }
}
