import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setMockServices } from '../helpers/mockServices.js';
import { resetServices } from '../../services.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { setupJwksServer, teardownJwksServer, createToken } from '../testUtils.js';
import { clearJwksCache } from '@intexuraos/common-http';
import type { PersistedDailySummary } from '../../domain/repositories/digestRepositories.js';
import type { GroupState } from '../../domain/schemas/digestSchemas.js';
import type { Notification } from '../../domain/notifications/index.js';

// COLD_START_EXAMPLE uses readonly tuple literals that don't satisfy mutable array types.
// Cast via unknown to satisfy the repository interfaces in mock stubs.
const EXAMPLE_SUMMARY = COLD_START_EXAMPLE.dailySummary as unknown as PersistedDailySummary['summary'];
const EXAMPLE_PERSISTED: PersistedDailySummary = { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: 'or:google/gemini-3-flash-preview' };
const NULL_NOTIFICATION = null as unknown as Notification;
const EXAMPLE_GROUP_STATE: GroupState = {
  userId: 'u', groupKey: 'g', updatedAt: '',
  identityLedger: [], moderatorEvents: [], openThreads: [], recentSummaryDates: [],
};

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
  process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'test-key';
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
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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

    vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async (): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> =>
            ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      } as typeof import('@intexuraos/llm-factory');
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
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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

    vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async (): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> =>
            ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      } as typeof import('@intexuraos/llm-factory');
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
        findInRange: async () => ({ ok: true, value: { items: [EXAMPLE_PERSISTED] } }),
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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

  it('passes cursor when provided', async () => {
    let capturedCursor: string | undefined;
    setMockServices({
      digestRepository: {
        findInRange: async (input) => {
          capturedCursor = input.cursor;
          return { ok: true, value: { items: [] } };
        },
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    await app.inject({
      method: 'GET',
      url: '/notifications/digests?groupKey=g&fromDate=2026-04-01&toDate=2026-04-15&cursor=tok123',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(capturedCursor).toBe('tok123');
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
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
        findByDate: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    setMockServices({
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: EXAMPLE_GROUP_STATE }),
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
    expect(body.data.groupKey).toBe(EXAMPLE_GROUP_STATE.groupKey);
    await app.close();
  });
});

describe('GET /notifications/digests/backfill/:runId', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/notifications/digests/backfill/bf_001' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 when run not found', async () => {
    setMockServices({
      backfillRunRepository: {
        create: async () => ({ ok: true, value: undefined }),
        findById: async () => ({ ok: true, value: null }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/backfill/bf_001',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns run when found', async () => {
    const mockRun = {
      runId: 'bf_001', userId: 'u', groupKey: 'g',
      fromDate: '2026-04-01', toDate: '2026-04-15',
      status: 'completed' as const, totalDates: 15,
      completedDates: [], failedDates: [], currentDate: null,
      startedAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T01:00:00Z',
    };
    setMockServices({
      backfillRunRepository: {
        create: async () => ({ ok: true, value: undefined }),
        findById: async () => ({ ok: true, value: mockRun }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/backfill/bf_001',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { runId: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.runId).toBe('bf_001');
    await app.close();
  });

  it('returns 500 when repository fails', async () => {
    setMockServices({
      backfillRunRepository: {
        create: async () => ({ ok: true, value: undefined }),
        findById: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/notifications/digests/backfill/bf_001',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe('GET /notifications/digests (error path)', () => {
  it('returns 500 when repository fails', async () => {
    setMockServices({
      digestRepository: {
        findInRange: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe('GET /notifications/digests/:groupKey/:date (error path)', () => {
  it('returns 500 when repository fails', async () => {
    setMockServices({
      digestRepository: {
        findByDate: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe('GET /notifications/digests/:groupKey/:date/state (error path)', () => {
  it('returns 500 when repository fails', async () => {
    setMockServices({
      groupStateRepository: {
        getByDate: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
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
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe('POST /internal/notifications/digest/run-yesterday (dispatch failure path)', () => {
  it('returns dispatched=0 when runDigestForGroup fails', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'lock error' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run-yesterday',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { dispatched: number } }>();
    expect(body.success).toBe(true);
    expect(body.data.dispatched).toBe(0);
    await app.close();
  });
});

describe('POST /notifications/digests/run', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/run',
      payload: { groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('regenerates digest for authenticated user and returns generation metadata', async () => {
    vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async (): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> =>
            ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      } as typeof import('@intexuraos/llm-factory');
    });
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: { ...EXAMPLE_PERSISTED, generation: 2 } }),
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
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/run',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { generation: number; regenerated: boolean } }>();
    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(2);
    expect(body.data.regenerated).toBe(true);
    await app.close();
  });

  it('returns 500 when digest run fails with non-lock-held error', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/run',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('returns lockSkipped when lock is held', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/run',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { lockSkipped: boolean } }>();
    expect(body.data.lockSkipped).toBe(true);
    await app.close();
  });
});

describe('POST /notifications/digests/backfill', () => {
  it('returns 401 without auth', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/backfill',
      payload: { groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-03' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates backfill run, triggers day 1, returns runId and queuedDates', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const createdRuns: unknown[] = [];
    setMockServices({
      backfillRunRepository: {
        create: async (run): Promise<{ ok: true; value: undefined }> => { createdRuns.push(run); return { ok: true, value: undefined }; },
        findById: async () => ({ ok: true, value: null }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/backfill',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-03' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { runId: string; queuedDates: string[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.runId).toMatch(/^bf_/);
    expect(body.data.queuedDates).toEqual(['2026-04-01', '2026-04-02', '2026-04-03']);
    expect(createdRuns).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
    await app.close();
    vi.unstubAllGlobals();
  });

  it('returns 500 when repository create fails', async () => {
    setMockServices({
      backfillRunRepository: {
        create: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        findById: async () => ({ ok: true, value: null }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/backfill',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-03' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('rejects when toDate before fromDate', async () => {
    setMockServices({});
    const token = await createToken({ sub: 'u' });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/backfill',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', fromDate: '2026-04-05', toDate: '2026-04-01' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /internal/notifications/digest/run (error paths)', () => {
  it('returns 500 when runDigestForGroup fails with non-lock-held error', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB error' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('returns lockSkipped=true when lock is held', async () => {
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
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
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { lockSkipped: boolean } }>();
    expect(body.data.lockSkipped).toBe(true);
    await app.close();
  });

  it('uses backfill holder and returns 200 when chainNext provided', async () => {
    vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async (): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> =>
            ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      } as typeof import('@intexuraos/llm-factory');
    });
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: {
        findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
        save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
        findById: async () => ({ ok: true, value: null }),
        existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
        delete: async () => ({ ok: true, value: undefined }),
      },
      digestRepository: {
        save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
      backfillRunRepository: {
        create: async () => ({ ok: true, value: undefined }),
        findById: async () => ({ ok: true, value: null }),
        markDayComplete: async () => ({ ok: true, value: undefined }),
        markDayFailed: async () => ({ ok: true, value: undefined }),
        markRunCompleted: async () => ({ ok: true, value: undefined }),
      },
    });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15', chainNext: { runId: 'bf_1', remainingDates: [], fromDate: '2026-04-15', toDate: '2026-04-15' } },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
