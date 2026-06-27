import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import type { PreferencesRepository } from '../../domain/ports/preferencesRepository.js';
import { INTEX_AGENT_MODEL } from '../../domain/agent/systemPrompt.js';
import type { IntexAgentPreferences } from '../../domain/preferences/types.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

class FakePreferencesRepository implements PreferencesRepository {
  storage = new Map<string, { instructions: string; updatedAt: string }>();
  saveCalls: { userId: string; instructions: string }[] = [];
  deleteCalls: string[] = [];

  async getPreferences(userId: string): Promise<IntexAgentPreferences | null> {
    const stored = this.storage.get(userId);
    return stored === undefined ? null : { userId, ...stored };
  }

  async savePreferences(
    userId: string,
    update: { instructions: string }
  ): Promise<IntexAgentPreferences> {
    const updatedAt = new Date().toISOString();
    const doc = { instructions: update.instructions, updatedAt };
    this.storage.set(userId, doc);
    this.saveCalls.push({ userId, instructions: update.instructions });
    return { userId, ...doc };
  }

  async deletePreferences(userId: string): Promise<void> {
    this.deleteCalls.push(userId);
    this.storage.delete(userId);
  }
}

class FakeSessionRepository {
  async listSessions(): Promise<never[]> {
    return [];
  }
  async getSession(): Promise<null> {
    return null;
  }
  async listEvents(): Promise<never[]> {
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
    /* noop */
  }
}

class FakeIncomingMessageHandler {
  async handle(): Promise<{ sessionId: string }> {
    return { sessionId: 'session-1' };
  }
}

describe('preferences routes', () => {
  let app: FastifyInstance;
  let preferencesRepository: FakePreferencesRepository;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'user-1', claims: {} });
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    preferencesRepository = new FakePreferencesRepository();

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
      sessionRepository: new FakeSessionRepository(),
      preferencesRepository,
      incomingMessageHandler: new FakeIncomingMessageHandler(),
    } satisfies ServiceContainer);

    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  it('returns empty instructions for a new user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { instructions: '', updatedAt: null },
    });
  });

  it('saves and reads back instructions', async () => {
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: { instructions: 'Always invite Monika.' },
    });

    expect(putResponse.statusCode).toBe(200);
    const putBody = JSON.parse(putResponse.body) as { data: { instructions: string; updatedAt: string } };
    expect(putBody.data.instructions).toBe('Always invite Monika.');
    expect(typeof putBody.data.updatedAt).toBe('string');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(JSON.parse(getResponse.body)).toMatchObject({
      success: true,
      data: { instructions: 'Always invite Monika.' },
    });
  });

  it('rejects empty instructions on PUT', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: { instructions: '   ' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(preferencesRepository.saveCalls).toHaveLength(0);
  });

  it('deletes preferences via DELETE', async () => {
    await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: { instructions: 'something' },
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteResponse.body)).toMatchObject({
      success: true,
      data: { instructions: '', updatedAt: null },
    });
    expect(preferencesRepository.deleteCalls).toEqual(['user-1']);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(JSON.parse(getResponse.body)).toMatchObject({
      success: true,
      data: { instructions: '', updatedAt: null },
    });
  });

  it('does not load preferences when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(preferencesRepository.saveCalls).toHaveLength(0);
  });

  it('does not save preferences when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: { instructions: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    expect(preferencesRepository.saveCalls).toHaveLength(0);
  });

  it('does not delete preferences when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'DELETE',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(preferencesRepository.deleteCalls).toHaveLength(0);
  });
});
