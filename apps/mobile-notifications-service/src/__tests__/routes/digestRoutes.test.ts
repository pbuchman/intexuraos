import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setMockServices } from '../helpers/mockServices.js';
import { resetServices } from '../../services.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { setupJwksServer, teardownJwksServer, createToken } from '../testUtils.js';
import { clearJwksCache } from '@intexuraos/common-http';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth';

beforeAll(async () => {
  await setupJwksServer();
});
afterAll(async () => {
  await teardownJwksServer();
});
beforeEach(() => {
  clearJwksCache();
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

describe('GET /notifications/digests', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/notifications/digests?groupKey=g&fromDate=2026-04-01&toDate=2026-04-15' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns paginated digest list for authenticated user', async () => {
    setMockServices({
      digestRepository: {
        findInRange: async () => ({ ok: true, value: { items: [{ summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '2026-04-15T00:00:00Z', modelId: 'm' }] } }),
        save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'm' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests?groupKey=g&fromDate=2026-04-01&toDate=2026-04-15',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    await app.close();
  });
});

describe('GET /notifications/digests/:groupKey/:date', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/notifications/digests/g/2026-04-15' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 when digest not found', async () => {
    setMockServices({
      digestRepository: {
        findByDate: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'm' } }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/g/2026-04-15',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns digest when found', async () => {
    setMockServices({
      digestRepository: {
        findByDate: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '2026-04-15T00:00:00Z', modelId: 'm' } }),
        save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'm' } }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/g/2026-04-15',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { generation: number } }>();
    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(1);
    await app.close();
  });
});

describe('GET /notifications/digests/:groupKey/:date/state', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/notifications/digests/g/2026-04-15/state' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 when state not found', async () => {
    setMockServices({
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/g/2026-04-15/state',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns state when found', async () => {
    const mockState = { groupKey: 'g', date: '2026-04-15', recentSummaryDates: [], participants: [] };
    setMockServices({
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: mockState }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/g/2026-04-15/state',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { groupKey: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.groupKey).toBe('g');
    await app.close();
  });
});
