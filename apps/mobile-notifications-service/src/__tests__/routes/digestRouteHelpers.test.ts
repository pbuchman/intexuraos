import { describe, expect, it, vi, afterEach } from 'vitest';
import { advanceChain, chainPost, getSelfBaseUrl, postNextAndHandleFailure } from '../../routes/digestRoutes.js';
import type { BackfillRunRepository } from '../../domain/repositories/digestRepositories.js';
import type { RunDigestForGroupResult } from '../../domain/usecases/runDigestForGroup.js';
import type { GroupState, DailySummary } from '../../domain/schemas/digestSchemas.js';

const EMPTY_SUMMARY = { userId: 'u', groupKey: 'g', date: '2026-04-03', messageCount: 0 } as unknown as DailySummary;
const EMPTY_STATE = { userId: 'u', groupKey: 'g', updatedAt: '', identityLedger: [], moderatorEvents: [], openThreads: [], recentSummaryDates: [] } as GroupState;
const OK_DIGEST: RunDigestForGroupResult = {
  summary: EMPTY_SUMMARY,
  state: EMPTY_STATE,
  generation: 1,
  modelId: 'm',
  regenerated: false,
};

afterEach(() => vi.restoreAllMocks());

const BASE_OPTIONS = {
  base: 'http://localhost:8080',
  token: 'tok',
  runId: 'run1',
  userId: 'u',
  groupKey: 'g',
  fromDate: '2026-04-01',
  toDate: '2026-04-05',
};

describe('getSelfBaseUrl', () => {
  it('returns env var when set', () => {
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = 'https://service.example.com';
    expect(getSelfBaseUrl()).toBe('https://service.example.com');
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
  });

  it('falls back to localhost when env var is empty string', () => {
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = '';
    expect(getSelfBaseUrl()).toBe('http://localhost:8080');
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
  });
});

describe('chainPost', () => {
  it('calls fetch with the correct URL and preserves original fromDate/toDate', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const result = await chainPost({
      ...BASE_OPTIONS,
      date: '2026-04-03',
      remainingDates: ['2026-04-04', '2026-04-05'],
    });
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/internal/notifications/digest/run');
    const body = JSON.parse(String(init.body)) as {
      chainNext: { fromDate: string; toDate: string; runId: string };
    };
    expect(body.chainNext.fromDate).toBe('2026-04-01');
    expect(body.chainNext.toDate).toBe('2026-04-05');
    expect(body.chainNext.runId).toBe('run1');
  });

  it('returns err when fetch rejects', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));
    const result = await chainPost({
      ...BASE_OPTIONS,
      date: '2026-04-03',
      remainingDates: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('network failure');
  });

  it('returns err when response status is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('oops', { status: 502 }));
    const result = await chainPost({
      ...BASE_OPTIONS,
      date: '2026-04-03',
      remainingDates: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('502');
  });
});

interface TrackedRepo extends BackfillRunRepository {
  readonly failedCalls: { runId: string; failure: { date: string; error: string }; markRunFailed: boolean }[];
  readonly completedCalls: { runId: string; completedDate: string; nextCurrentDate: string | null }[];
  readonly runCompletedCalls: string[];
}

function fakeRepo(): TrackedRepo {
  const failedCalls: TrackedRepo['failedCalls'] = [];
  const completedCalls: TrackedRepo['completedCalls'] = [];
  const runCompletedCalls: string[] = [];
  return {
    failedCalls,
    completedCalls,
    runCompletedCalls,
    create: async (): Promise<{ ok: true; value: undefined }> => ({ ok: true, value: undefined }),
    findById: async (): Promise<{ ok: true; value: null }> => ({ ok: true, value: null }),
    markDayComplete: async (input): Promise<{ ok: true; value: undefined }> => {
      completedCalls.push(input);
      return { ok: true, value: undefined };
    },
    markDayFailed: async (input): Promise<{ ok: true; value: undefined }> => {
      failedCalls.push(input);
      return { ok: true, value: undefined };
    },
    markRunCompleted: async (runId): Promise<{ ok: true; value: undefined }> => {
      runCompletedCalls.push(runId);
      return { ok: true, value: undefined };
    },
  };
}

describe('postNextAndHandleFailure', () => {
  it('does nothing when chain POST succeeds', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const repo = fakeRepo();
    await postNextAndHandleFailure({
      ...BASE_OPTIONS,
      date: '2026-04-03',
      remainingDates: [],
    }, repo);
    expect(repo.failedCalls).toHaveLength(0);
  });

  it('marks the day failed and flips run to failed when chain POST errors out', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const repo = fakeRepo();
    await postNextAndHandleFailure({
      ...BASE_OPTIONS,
      date: '2026-04-03',
      remainingDates: [],
    }, repo);
    expect(repo.failedCalls).toHaveLength(1);
    expect(repo.failedCalls[0]?.markRunFailed).toBe(true);
    expect(repo.failedCalls[0]?.failure.date).toBe('2026-04-03');
    expect(repo.failedCalls[0]?.failure.error).toContain('network down');
  });
});

describe('advanceChain', () => {
  const CHAIN_NEXT = { runId: 'bf_1', remainingDates: [], fromDate: '2026-04-01', toDate: '2026-04-05' };

  it('marks the day failed and flips run to failed when digest result is not ok', async () => {
    const repo = fakeRepo();
    await advanceChain({
      chainNext: { ...CHAIN_NEXT, remainingDates: [] },
      date: '2026-04-03',
      userId: 'u',
      groupKey: 'g',
      digestResult: { ok: false, error: { code: 'lock-held', heldBy: 'cron' } },
      repo,
    });
    expect(repo.failedCalls).toHaveLength(1);
    expect(repo.failedCalls[0]?.markRunFailed).toBe(true);
    expect(repo.completedCalls).toHaveLength(0);
  });

  it('marks day complete and run completed when no remaining dates', async () => {
    const repo = fakeRepo();
    await advanceChain({
      chainNext: { ...CHAIN_NEXT, remainingDates: [] },
      date: '2026-04-05',
      userId: 'u',
      groupKey: 'g',
      digestResult: { ok: true, value: OK_DIGEST },
      repo,
    });
    expect(repo.completedCalls).toHaveLength(1);
    expect(repo.completedCalls[0]?.nextCurrentDate).toBeNull();
    expect(repo.runCompletedCalls).toEqual(['bf_1']);
  });

  it('marks day complete and schedules next-day POST when remaining dates exist', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      const repo = fakeRepo();
      await advanceChain({
        chainNext: { ...CHAIN_NEXT, remainingDates: ['2026-04-04', '2026-04-05'] },
        date: '2026-04-03',
        userId: 'u',
        groupKey: 'g',
        digestResult: { ok: true, value: OK_DIGEST },
        repo,
      });
      expect(repo.completedCalls).toHaveLength(1);
      expect(repo.completedCalls[0]?.nextCurrentDate).toBe('2026-04-04');
      expect(repo.runCompletedCalls).toHaveLength(0);
      await vi.runAllTimersAsync();
      expect(global.fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
