import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { startDigestBackfill, listDates } from '../../../domain/usecases/runDigestBackfill.js';
import { setMockServices } from '../../helpers/mockServices.js';
import { resetServices } from '../../../services.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Result } from '@intexuraos/common-core';

const logger = createAppLogger({ name: 'test' });

beforeEach(() => {
  setMockServices({
    backfillRunRepository: {
      create: async () => ({ ok: true, value: undefined }),
      update: async () => ({ ok: true, value: undefined }),
      findById: async () => ({ ok: true, value: null }),
    },
  });
});
afterEach(() => resetServices());

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
      { logger, httpPost },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-13', toDate: '2026-04-15' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queuedDates).toHaveLength(3);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.path).toBe('/internal/notifications/digest/run');
  });

  it('returns error when backfillRunRepository.create fails', async () => {
    setMockServices({
      backfillRunRepository: {
        create: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } }),
        update: async () => ({ ok: true, value: undefined }),
        findById: async () => ({ ok: true, value: null }),
      },
    });

    const httpPost = async (_path: string, _body: unknown): Promise<Result<unknown, { message: string }>> =>
      ({ ok: true, value: {} });

    const result = await startDigestBackfill(
      { logger, httpPost },
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
      { logger, httpPost },
      { userId: 'u', groupKey: 'g', fromDate: '2026-04-15', toDate: '2026-04-15' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('network error');
  });
});
