import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import type { PromptPreferencesRepository } from '../../domain/ports/promptPreferencesRepository.js';
import {
  addPromptPreferenceItem,
  assertExpectedPromptPreferenceVersion,
  deletePromptPreferenceItem,
  emptyPromptPreferences,
  PromptPreferencesError,
  updatePromptPreferenceItem,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferenceVersionSummary,
  type IntexAgentPromptPreferences,
} from '../../domain/preferences/promptPreferences.js';
import { INTEX_AGENT_MODEL } from '../../domain/agent/systemPrompt.js';
import type { PreferencesRepository } from '../../domain/ports/preferencesRepository.js';
import type {
  ExternalSaveConnectionTestPort,
  IntexAgentPreferences,
  IntexAgentPreferencesUpdate,
} from '../../domain/preferences/types.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1', claims: {} }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('prompt preferences routes', () => {
  let app: FastifyInstance;
  let promptPreferencesRepository: FakePromptPreferencesRepository;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'user-1', claims: {} });
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    promptPreferencesRepository = new FakePromptPreferencesRepository();

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
        model: INTEX_AGENT_MODEL,
      },
      sessionRepository: new FakeSessionRepository(),
      preferencesRepository: new FakeLegacyPreferencesRepository(),
      promptPreferencesRepository,
      externalSaveTester: new FakeExternalSaveTester(),
      incomingMessageHandler: new FakeIncomingMessageHandler(),
      testConversationRunner: {
        async run(): Promise<never> {
          throw new Error('not used in prompt preferences route tests');
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

  it('returns empty current prompt preferences for a new user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/preferences/prompt',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        userId: 'user-1',
        currentVersion: 0,
        items: [],
        renderedPromptBlock: '',
        createdAt: null,
        updatedAt: null,
      },
    });
  });

  it('adds, updates, deletes, and lists prompt preference versions', async () => {
    const addResponse = await app.inject({
      method: 'POST',
      url: '/preferences/prompt/items',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        expectedVersion: 0,
      },
    });

    expect(addResponse.statusCode).toBe(200);
    expect(JSON.parse(addResponse.body)).toMatchObject({
      success: true,
      data: {
        currentVersion: 1,
        renderedPromptBlock:
          'User Preferences v1:\n1. (id: pref_1) "When I ask to invite Jakub, invite jakub@gmail.com."',
      },
    });

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: '/preferences/prompt/items/pref_1',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        text: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
        expectedVersion: 1,
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(JSON.parse(updateResponse.body)).toMatchObject({
      data: {
        currentVersion: 2,
        items: [
          {
            id: 'pref_1',
            text: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
          },
        ],
      },
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/preferences/prompt/items/pref_1',
      headers: { authorization: 'Bearer test-token' },
      payload: { expectedVersion: 2 },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteResponse.body)).toMatchObject({
      data: {
        currentVersion: 3,
        items: [],
        renderedPromptBlock: '',
      },
    });

    const versionsResponse = await app.inject({
      method: 'GET',
      url: '/preferences/prompt/versions',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(versionsResponse.statusCode).toBe(200);
    expect(JSON.parse(versionsResponse.body)).toMatchObject({
      data: [
        { version: 3, changeType: 'delete', previousText: expect.stringContaining('nowak') },
        { version: 2, changeType: 'update', nextText: expect.stringContaining('nowak') },
        { version: 1, changeType: 'add', nextText: expect.stringContaining('jakub@gmail.com') },
      ],
    });

    const versionResponse = await app.inject({
      method: 'GET',
      url: '/preferences/prompt/versions/1',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(versionResponse.statusCode).toBe(200);
    expect(JSON.parse(versionResponse.body)).toMatchObject({
      data: {
        version: 1,
        renderedPromptBlock:
          'User Preferences v1:\n1. (id: pref_1) "When I ask to invite Jakub, invite jakub@gmail.com."',
      },
    });
  });

  it('returns validation, not found, and version conflict errors', async () => {
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/preferences/prompt/items',
      headers: { authorization: 'Bearer test-token' },
      payload: { text: 'first\nsecond', expectedVersion: 0 },
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidResponse.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });

    const missingResponse = await app.inject({
      method: 'PATCH',
      url: '/preferences/prompt/items/pref_missing',
      headers: { authorization: 'Bearer test-token' },
      payload: { text: 'Missing', expectedVersion: 0 },
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(JSON.parse(missingResponse.body)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/preferences/prompt/items',
      headers: { authorization: 'Bearer test-token' },
      payload: { text: 'Another preference', expectedVersion: 5 },
    });
    expect(conflictResponse.statusCode).toBe(409);
    expect(JSON.parse(conflictResponse.body)).toMatchObject({
      success: false,
      error: {
        code: 'VERSION_CONFLICT',
        details: {
          current: {
            currentVersion: 0,
            items: [],
          },
        },
      },
    });
  });

  it('validates historical version parameters', async () => {
    const invalidResponse = await app.inject({
      method: 'GET',
      url: '/preferences/prompt/versions/not-a-number',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidResponse.body)).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });

    const missingResponse = await app.inject({
      method: 'GET',
      url: '/preferences/prompt/versions/42',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(JSON.parse(missingResponse.body)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('does not load or mutate prompt preferences when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/preferences/prompt',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(promptPreferencesRepository.calls).toEqual([]);
  });

  it('does not load or mutate prompt preferences on any prompt route when authentication fails', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const requests: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      url: string;
      payload?: Record<string, string | number>;
    }[] = [
      { method: 'POST', url: '/preferences/prompt/items', payload: { text: 'Preference.', expectedVersion: 0 } },
      {
        method: 'PATCH',
        url: '/preferences/prompt/items/pref_1',
        payload: { text: 'Preference.', expectedVersion: 0 },
      },
      { method: 'DELETE', url: '/preferences/prompt/items/pref_1', payload: { expectedVersion: 0 } },
      { method: 'GET', url: '/preferences/prompt/versions' },
      { method: 'GET', url: '/preferences/prompt/versions/1' },
    ];

    for (const request of requests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: 'Bearer test-token' },
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
      });
      expect(response.statusCode).toBe(200);
    }

    expect(promptPreferencesRepository.calls).toEqual([]);
  });

  it('returns conflict errors without a current snapshot and generic internal errors', async () => {
    promptPreferencesRepository.throwNextAdd(
      new PromptPreferencesError('VERSION_CONFLICT', 'Version changed without snapshot')
    );

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/preferences/prompt/items',
      headers: { authorization: 'Bearer test-token' },
      payload: { text: 'Preference.', expectedVersion: 0 },
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(JSON.parse(conflictResponse.body)).toMatchObject({
      success: false,
      error: {
        code: 'VERSION_CONFLICT',
        details: { current: null },
      },
    });

    promptPreferencesRepository.throwNextAdd(new Error('database unavailable'));

    const internalErrorResponse = await app.inject({
      method: 'POST',
      url: '/preferences/prompt/items',
      headers: { authorization: 'Bearer test-token' },
      payload: { text: 'Preference.', expectedVersion: 0 },
    });

    expect(internalErrorResponse.statusCode).toBe(500);
    expect(JSON.parse(internalErrorResponse.body)).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal error' },
    });
  });
});

class FakePromptPreferencesRepository implements PromptPreferencesRepository {
  private readonly storage = new Map<string, IntexAgentPromptPreferences>();
  private readonly versions = new Map<string, IntexAgentPromptPreferenceVersion[]>();
  private idCounter = 0;
  private timeCounter = 0;
  private nextAddError: unknown = null;
  readonly calls: string[] = [];

  async getCurrent(userId: string): Promise<IntexAgentPromptPreferences> {
    this.calls.push('getCurrent');
    return this.storage.get(userId) ?? emptyPromptPreferences(userId);
  }

  async listVersions(userId: string): Promise<IntexAgentPromptPreferenceVersionSummary[]> {
    this.calls.push('listVersions');
    return (this.versions.get(userId) ?? [])
      .toSorted((a, b) => b.version - a.version)
      .map((version) => ({
        version: version.version,
        changeType: version.changeType,
        ...(version.changedItemId !== undefined ? { changedItemId: version.changedItemId } : {}),
        ...(version.previousText !== undefined ? { previousText: version.previousText } : {}),
        ...(version.nextText !== undefined ? { nextText: version.nextText } : {}),
        itemCount: version.itemCount,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
      }));
  }

  async getVersion(
    userId: string,
    version: number
  ): Promise<IntexAgentPromptPreferenceVersion | null> {
    this.calls.push('getVersion');
    return this.versions.get(userId)?.find((entry) => entry.version === version) ?? null;
  }

  async addItem(
    input: Parameters<PromptPreferencesRepository['addItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push('addItem');
    if (this.nextAddError !== null) {
      const error = this.nextAddError;
      this.nextAddError = null;
      throw error;
    }
    const current = this.storage.get(input.userId) ?? emptyPromptPreferences(input.userId);
    assertExpectedPromptPreferenceVersion(current, input.expectedVersion);
    const result = addPromptPreferenceItem(current, {
      id: `pref_${String(++this.idCounter)}`,
      text: input.text,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.saveResult(input.userId, result.current, result.version);
    return result.current;
  }

  async updateItem(
    input: Parameters<PromptPreferencesRepository['updateItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push('updateItem');
    const current = this.storage.get(input.userId) ?? emptyPromptPreferences(input.userId);
    assertExpectedPromptPreferenceVersion(current, input.expectedVersion);
    const result = updatePromptPreferenceItem(current, {
      itemId: input.itemId,
      text: input.text,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.saveResult(input.userId, result.current, result.version);
    return result.current;
  }

  async deleteItem(
    input: Parameters<PromptPreferencesRepository['deleteItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push('deleteItem');
    const current = this.storage.get(input.userId) ?? emptyPromptPreferences(input.userId);
    assertExpectedPromptPreferenceVersion(current, input.expectedVersion);
    const result = deletePromptPreferenceItem(current, {
      itemId: input.itemId,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.saveResult(input.userId, result.current, result.version);
    return result.current;
  }

  private saveResult(
    userId: string,
    current: IntexAgentPromptPreferences,
    version: IntexAgentPromptPreferenceVersion
  ): void {
    this.storage.set(userId, current);
    this.versions.set(userId, [...(this.versions.get(userId) ?? []), version]);
  }

  private nextTime(): string {
    this.timeCounter += 1;
    return `2026-06-28T10:0${String(this.timeCounter)}:00.000Z`;
  }

  throwNextAdd(error: unknown): void {
    this.nextAddError = error;
  }
}

class FakeLegacyPreferencesRepository implements PreferencesRepository {
  async getPreferences(): Promise<IntexAgentPreferences | null> {
    return null;
  }
  async savePreferences(
    _userId: string,
    update: IntexAgentPreferencesUpdate
  ): Promise<IntexAgentPreferences> {
    return {
      userId: 'user-1',
      instructions: update.instructions,
      updatedAt: '2026-06-28T10:00:00.000Z',
      ...(update.externalSave !== undefined ? { externalSave: update.externalSave } : {}),
    };
  }
  async deletePreferences(): Promise<void> {
    /* noop */
  }
}

class FakeExternalSaveTester implements ExternalSaveConnectionTestPort {
  async testConnection(): Promise<{ ok: true; status: 'success'; message: string }> {
    return { ok: true, status: 'success', message: 'Connection successful' };
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
