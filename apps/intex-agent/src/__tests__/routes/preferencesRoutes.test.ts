import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import type { PreferencesRepository } from '../../domain/ports/preferencesRepository.js';
import {
  emptyPromptPreferences,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferenceVersionSummary,
  type IntexAgentPromptPreferences,
} from '../../domain/preferences/promptPreferences.js';
import { INTEX_AGENT_MODEL } from '../../domain/agent/systemPrompt.js';
import type {
  ExternalSaveConnectionTestPort,
  IntexAgentExternalSavePreferences,
  IntexAgentPreferences,
  IntexAgentPreferencesUpdate,
} from '../../domain/preferences/types.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

class FakePreferencesRepository implements PreferencesRepository {
  storage = new Map<
    string,
    { instructions: string; externalSave?: IntexAgentExternalSavePreferences; updatedAt: string }
  >();
  saveCalls: { userId: string; update: IntexAgentPreferencesUpdate }[] = [];
  deleteCalls: string[] = [];

  async getPreferences(userId: string): Promise<IntexAgentPreferences | null> {
    const stored = this.storage.get(userId);
    return stored === undefined ? null : { userId, ...stored };
  }

  async savePreferences(
    userId: string,
    update: IntexAgentPreferencesUpdate
  ): Promise<IntexAgentPreferences> {
    const updatedAt = new Date().toISOString();
    const doc = {
      instructions: update.instructions,
      ...(update.externalSave !== undefined ? { externalSave: update.externalSave } : {}),
      updatedAt,
    };
    this.storage.set(userId, doc);
    this.saveCalls.push({ userId, update });
    return { userId, ...doc };
  }

  async deletePreferences(userId: string): Promise<void> {
    this.deleteCalls.push(userId);
    this.storage.delete(userId);
  }
}

class FakeExternalSaveTester implements ExternalSaveConnectionTestPort {
  readonly calls: IntexAgentExternalSavePreferences[] = [];
  result: Awaited<ReturnType<ExternalSaveConnectionTestPort['testConnection']>> = {
    ok: true,
    status: 'success',
    message: 'Connection successful',
  };

  testConnection(
    config: IntexAgentExternalSavePreferences
  ): Promise<Awaited<ReturnType<ExternalSaveConnectionTestPort['testConnection']>>> {
    this.calls.push(config);
    return Promise.resolve(this.result);
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
      throw new Error('not used in preferences route tests');
    },
    async updateItem(): Promise<IntexAgentPromptPreferences> {
      throw new Error('not used in preferences route tests');
    },
    async deleteItem(): Promise<IntexAgentPromptPreferences> {
      throw new Error('not used in preferences route tests');
    },
  };
}

describe('preferences routes', () => {
  let app: FastifyInstance;
  let preferencesRepository: FakePreferencesRepository;
  let externalSaveTester: FakeExternalSaveTester;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'user-1', claims: {} });
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    preferencesRepository = new FakePreferencesRepository();
    externalSaveTester = new FakeExternalSaveTester();

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
      promptPreferencesRepository: createUnusedPromptPreferencesRepository(),
      externalSaveTester,
      incomingMessageHandler: new FakeIncomingMessageHandler(),
      testConversationRunner: {
        async run(): Promise<never> {
          throw new Error('not used in preferences route tests');
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

  it('returns empty instructions for a new user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        instructions: '',
        externalSave: {
          enabled: false,
          endpointUrl: '',
          cfAccessClientId: '',
          cfAccessClientSecret: '',
          source: 'ios-shortcuts',
        },
        updatedAt: null,
      },
    });
  });

  it('rejects instruction-only saves because prompt preferences have moved to itemized routes', async () => {
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: { instructions: 'Always invite Monika.' },
    });

    expect(putResponse.statusCode).toBe(400);
    expect(JSON.parse(putResponse.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(preferencesRepository.saveCalls).toHaveLength(0);
  });

  it('does not expose legacy stored instructions as prompt preferences', async () => {
    preferencesRepository.storage.set('user-1', {
      instructions: 'legacy prompt text that should be ignored',
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        instructions: '',
        updatedAt: '2026-06-27T10:00:00.000Z',
      },
    });
  });

  it('saves external save configuration without personal instructions', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        instructions: '   ',
        externalSave: {
          enabled: true,
          endpointUrl: 'https://external-save.example.com/intex',
          cfAccessClientId: 'cf-client-id',
          cfAccessClientSecret: 'cf-client-secret',
          source: 'ios-shortcuts',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        instructions: '',
        externalSave: {
          enabled: true,
          endpointUrl: 'https://external-save.example.com/intex',
          cfAccessClientId: 'cf-client-id',
          cfAccessClientSecret: '************',
          source: 'ios-shortcuts',
        },
      },
    });
    expect(preferencesRepository.saveCalls).toEqual([
      {
        userId: 'user-1',
        update: {
          instructions: '',
          externalSave: {
            enabled: true,
            endpointUrl: 'https://external-save.example.com/intex',
            cfAccessClientId: 'cf-client-id',
            cfAccessClientSecret: 'cf-client-secret',
            source: 'ios-shortcuts',
          },
        },
      },
    ]);
  });

  it('keeps the stored Cloudflare secret when saving a masked external save secret', async () => {
    preferencesRepository.storage.set('user-1', {
      instructions: 'existing',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://old.example.com/intex',
        cfAccessClientId: 'old-client-id',
        cfAccessClientSecret: 'stored-secret',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        instructions: 'updated',
        externalSave: {
          enabled: true,
          endpointUrl: 'https://new.example.com/intex',
          cfAccessClientId: 'new-client-id',
          cfAccessClientSecret: '************',
          source: 'ios-shortcuts',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(preferencesRepository.saveCalls[0]?.update.externalSave).toMatchObject({
      endpointUrl: 'https://new.example.com/intex',
      cfAccessClientId: 'new-client-id',
      cfAccessClientSecret: 'stored-secret',
    });
  });

  it('defaults blank external save source labels and leaves disabled config incomplete', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        instructions: '',
        externalSave: {
          enabled: false,
          endpointUrl: '   ',
          cfAccessClientId: '   ',
          cfAccessClientSecret: '   ',
          source: '   ',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(preferencesRepository.saveCalls[0]?.update.externalSave).toEqual({
      enabled: false,
      endpointUrl: '',
      cfAccessClientId: '',
      cfAccessClientSecret: '',
      source: 'ios-shortcuts',
    });
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        externalSave: {
          enabled: false,
          endpointUrl: '',
          cfAccessClientId: '',
          cfAccessClientSecret: '',
          source: 'ios-shortcuts',
        },
      },
    });
  });

  it('rejects enabled external save config with missing endpoint or Cloudflare credentials', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        instructions: '',
        externalSave: {
          enabled: true,
          endpointUrl: '',
          cfAccessClientId: 'cf-client-id',
          cfAccessClientSecret: 'cf-client-secret',
          source: 'ios-shortcuts',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(preferencesRepository.saveCalls).toHaveLength(0);
  });

  it('tests the saved external save connection', async () => {
    preferencesRepository.storage.set('user-1', {
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/preferences/external-save/test',
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        status: 'success',
        message: 'Connection successful',
      },
    });
    expect(externalSaveTester.calls).toEqual([
      {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    ]);
  });

  it('tests a submitted external save connection before it is saved', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preferences/external-save/test',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        externalSave: {
          enabled: true,
          endpointUrl: ' https://submitted.example.com/intex ',
          cfAccessClientId: ' submitted-client-id ',
          cfAccessClientSecret: ' submitted-client-secret ',
          source: ' ',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(externalSaveTester.calls).toEqual([
      {
        enabled: true,
        endpointUrl: 'https://submitted.example.com/intex',
        cfAccessClientId: 'submitted-client-id',
        cfAccessClientSecret: 'submitted-client-secret',
        source: 'ios-shortcuts',
      },
    ]);
  });

  it('rejects external save test when no configuration is available', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preferences/external-save/test',
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('rejects external save test with an incomplete submitted configuration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preferences/external-save/test',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        externalSave: {
          enabled: true,
          endpointUrl: '',
          cfAccessClientId: 'cf-client-id',
          cfAccessClientSecret: 'cf-client-secret',
          source: 'ios-shortcuts',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('deletes legacy External Save preferences via DELETE', async () => {
    preferencesRepository.storage.set('user-1', {
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteResponse.body)).toMatchObject({
      success: true,
      data: {
        instructions: '',
        externalSave: {
          enabled: false,
          endpointUrl: '',
          cfAccessClientId: '',
          cfAccessClientSecret: '',
          source: 'ios-shortcuts',
        },
        updatedAt: null,
      },
    });
    expect(preferencesRepository.deleteCalls).toEqual(['user-1']);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/preferences',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(JSON.parse(getResponse.body)).toMatchObject({
      success: true,
      data: {
        instructions: '',
        externalSave: {
          enabled: false,
          endpointUrl: '',
          cfAccessClientId: '',
          cfAccessClientSecret: '',
          source: 'ios-shortcuts',
        },
        updatedAt: null,
      },
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

  it('does not test external save when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/preferences/external-save/test',
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(externalSaveTester.calls).toHaveLength(0);
  });
});
