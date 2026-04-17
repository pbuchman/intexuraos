import { describe, expect, it } from 'vitest';
import { startDigestBackfill, listDates } from '../../../domain/usecases/runDigestBackfill.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Result } from '@intexuraos/common-core';
import type {
  BackfillRun,
  BackfillRunRepository,
} from '../../../domain/repositories/digestRepositories.js';

const logger = createAppLogger({ name: 'test' });

function fakeBackfillRepo(overrides: Partial<BackfillRunRepository> = {}): BackfillRunRepository {
  return {
    create: async () => ({ ok: true, value: undefined }),
    findById: async () => ({ ok: true, value: null }),
    markDayComplete: async () => ({ ok: true, value: undefined }),
    markDayFailed: async () => ({ ok: true, value: undefined }),
    markRunCompleted: async () => ({ ok: true, value: undefined }),
    ...overrides,
  };
}

describe('listDates', () => {
  it('returns single date when from equals to', () => {
    expect(listDates('2026-04-15', '2026-04-15')).toEqual(['2026-04-15']);
  });

  it('returns all dates inclusive', () => {
    expect(listDates('2026-04-13', '2026-04-15')).toEqual(['2026-04-13', '2026-04-14', '2026-04-15']);
  });

  it('handles month boundary', () => {
    expect(listDates('2026-04-30', '2026-05-02')).toEqual(['2026-04-30', '2026-05-01', '2026-05-02']);
  });
});

describe('startDigestBackfill', () => {
  it('creates run doc and triggers first date via httpPost', async () => {
    const posted: { path: string; body: unknown }[] = [];
    const httpPost = async (path: string, body: unknown): Promise<Result<unknown, { message: string }>> => {
      posted.push({ path, body });
      return { ok: true, value: {} };
    };

    const result = await startDigestBackfill(
      { logger, httpPost, backfillRunRepository: fakeBackfillRepo() },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-13', toDate: '2026-04-15' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queuedDates).toHaveLength(3);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.path).toBe('/internal/notifications/digest/run');
  });

  it('returns error when backfillRunRepository.create fails', async () => {
    const backfillRunRepository = fakeBackfillRepo({
      create: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } }),
    });

    const httpPost = async (_path: string, _body: unknown): Promise<Result<unknown, { message: string }>> =>
      ({ ok: true, value: {} });

    const result = await startDigestBackfill(
      { logger, httpPost, backfillRunRepository },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-15', toDate: '2026-04-15' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('DB down');
  });

  it('returns error when httpPost fails', async () => {
    const httpPost = async (_path: string, _body: unknown): Promise<Result<unknown, { message: string }>> =>
      ({ ok: false, error: { message: 'network error' } });

    const result = await startDigestBackfill(
      { logger, httpPost, backfillRunRepository: fakeBackfillRepo() },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-15', toDate: '2026-04-15' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('network error');
  });

  it('creates run with null currentDate when fromDate > toDate (empty range)', async () => {
    let createdRun: BackfillRun | undefined;
    const backfillRunRepository = fakeBackfillRepo({
      create: async (run) => { createdRun = run; return { ok: true, value: undefined }; },
    });
    const posted: string[] = [];
    const httpPost = async (path: string): Promise<Result<unknown, { message: string }>> => {
      posted.push(path);
      return { ok: true, value: {} };
    };

    const result = await startDigestBackfill(
      { logger, httpPost, backfillRunRepository },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-15', toDate: '2026-04-14' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queuedDates).toHaveLength(0);
    expect(posted).toHaveLength(0);
    expect(createdRun?.currentDate).toBeNull();
  });
});
