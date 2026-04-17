import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setMockServices } from '../helpers/mockServices.js';
import { resetServices } from '../../services.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth';

beforeEach(() => {
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
  process.env['INTEXURAOS_DIGEST_LLM_MODEL'] = 'or:google/gemini-3-flash-preview';
  process.env['INTEXURAOS_OPENROUTER_API_KEY'] = 'test-key';
});
afterEach(() => {
  resetServices();
  vi.restoreAllMocks();
});

describe('POST /internal/notifications/digest/run', () => {
  it('rejects without X-Internal-Auth header', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 200 with summary metadata on success', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: { id: 'x' } }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'or:google/gemini-3-flash-preview' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
    });

    vi.mock('@intexuraos/llm-factory', async () => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async () => ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      };
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { generation: number } }>();
    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(1);
    await app.close();
  });
});

describe('POST /internal/notifications/digest/run-yesterday', () => {
  it('rejects without X-Internal-Auth header', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run-yesterday',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('dispatches one run per DIGEST_SUBSCRIPTIONS entry and returns dispatched count', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: { id: 'x' } }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'or:google/gemini-3-flash-preview' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
    });

    vi.mock('@intexuraos/llm-factory', async () => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async () => ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      };
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run-yesterday',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { dispatched: number; date: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.dispatched).toBe(1);
    expect(body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });
});
