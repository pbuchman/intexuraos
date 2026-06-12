/**
 * Tests for notificationDigestsApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getBackfillRun,
  getDigest,
  getDigestState,
  listDigests,
  runDigest,
  startBackfill,
} from '../notificationDigestsApi.js';
import type {
  BackfillRun,
  GroupState,
  ListDigestsResponse,
  PersistedDailySummary,
  RunDigestResponse,
  StartBackfillResponse,
} from '../../types/notificationDigests.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    mobileNotificationsServiceUrl: 'https://mn.test',
  },
}));

const TOKEN = 'tok';

describe('notificationDigestsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listDigests', () => {
    it('builds querystring with required params', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const resp: ListDigestsResponse = { items: [] };
      vi.mocked(apiRequest).mockResolvedValue(resp);

      const result = await listDigests(TOKEN, {
        groupKey: 'g',
        fromDate: '2026-04-01',
        toDate: '2026-04-15',
      });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://mn.test');
      expect(call?.[1]).toBe('/digests?groupKey=g&fromDate=2026-04-01&toDate=2026-04-15');
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toBe(resp);
    });

    it('appends optional limit and cursor', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ items: [] });
      await listDigests(TOKEN, {
        groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-15', limit: 10, cursor: 'abc',
      });
      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toContain('limit=10');
      expect(call?.[1]).toContain('cursor=abc');
    });
  });

  describe('getDigest', () => {
    it('encodes groupKey and date in path', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const summary: PersistedDailySummary = {
        summary: {
          date: '2026-04-15', groupKey: 'g', messageCount: 0, narrative: '',
          threads: [], moderatorPosts: [], openQuestions: [], activityOutliers: [],
        },
        generation: 1, generatedAt: '2026-04-15T12:00:00Z', modelId: 'test',
      };
      vi.mocked(apiRequest).mockResolvedValue(summary);

      const result = await getDigest(TOKEN, 'group with space', '2026-04-15');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/digests/group%20with%20space/2026-04-15');
      expect(result).toBe(summary);
    });
  });

  describe('getDigestState', () => {
    it('appends /state suffix', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const state: GroupState = {
        userId: 'u', groupKey: 'g', updatedAt: '',
        identityLedger: [], moderatorEvents: [], openThreads: [], recentSummaryDates: [],
      };
      vi.mocked(apiRequest).mockResolvedValue(state);

      await getDigestState(TOKEN, 'g', '2026-04-15');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/digests/g/2026-04-15/state');
    });
  });

  describe('runDigest', () => {
    it('POSTs body with 90s timeout', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const resp: RunDigestResponse = {
        summaryDocId: 'u_g_2026-04-15', generation: 2, messageCount: 42,
        modelId: 'test', regenerated: true,
      };
      vi.mocked(apiRequest).mockResolvedValue(resp);

      await runDigest(TOKEN, { groupKey: 'g', date: '2026-04-15' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/digests/run');
      expect(call?.[3]).toEqual({
        method: 'POST',
        body: { groupKey: 'g', date: '2026-04-15' },
        timeout: 90000,
      });
    });
  });

  describe('startBackfill', () => {
    it('POSTs backfill body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const resp: StartBackfillResponse = {
        runId: 'bf_abc', queuedDates: ['2026-04-01', '2026-04-02'],
      };
      vi.mocked(apiRequest).mockResolvedValue(resp);

      const result = await startBackfill(TOKEN, {
        groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-02',
      });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/digests/backfill');
      expect(call?.[3]).toEqual({
        method: 'POST',
        body: { groupKey: 'g', fromDate: '2026-04-01', toDate: '2026-04-02' },
      });
      expect(result).toBe(resp);
    });
  });

  describe('getBackfillRun', () => {
    it('fetches backfill run by id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const run: BackfillRun = {
        runId: 'bf_abc', userId: 'u', groupKey: 'g',
        fromDate: '2026-04-01', toDate: '2026-04-02', status: 'running',
        totalDates: 2, completedDates: [], failedDates: [], currentDate: '2026-04-01',
        startedAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:01:00Z',
      };
      vi.mocked(apiRequest).mockResolvedValue(run);

      await getBackfillRun(TOKEN, 'bf abc');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/digests/backfill/bf%20abc');
    });
  });
});
