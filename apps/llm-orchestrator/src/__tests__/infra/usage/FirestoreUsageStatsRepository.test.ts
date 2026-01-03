/**
 * Tests for FirestoreUsageStatsRepository.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBatchCommit = vi.fn();
const mockBatchSet = vi.fn();

const mockBatch = vi.fn().mockReturnValue({
  set: mockBatchSet,
  commit: mockBatchCommit,
});

const mockPeriodDocGet = vi.fn();
const mockPeriodDoc = vi.fn().mockReturnValue({
  get: mockPeriodDocGet,
});

const mockPeriodsCollection = vi.fn().mockReturnValue({
  doc: mockPeriodDoc,
});

const mockModelDocRef = {
  collection: mockPeriodsCollection,
};

const mockModelDoc = vi.fn().mockReturnValue(mockModelDocRef);

const mockModelsSnapshot = { docs: [] as Array<{ ref: typeof mockModelDocRef }> };
const mockModelsGet = vi.fn().mockResolvedValue(mockModelsSnapshot);

const mockCollection = vi.fn().mockReturnValue({
  doc: mockModelDoc,
  get: mockModelsGet,
});

const mockGetFirestore = vi.fn().mockReturnValue({
  collection: mockCollection,
  batch: mockBatch,
});

const mockFieldValueIncrement = vi.fn((n: number) => ({ _increment: n }));

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: mockGetFirestore,
  FieldValue: {
    increment: mockFieldValueIncrement,
  },
}));

const { FirestoreUsageStatsRepository } = await import(
  '../../../infra/usage/FirestoreUsageStatsRepository.js'
);

describe('FirestoreUsageStatsRepository', () => {
  let repository: InstanceType<typeof FirestoreUsageStatsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockModelsSnapshot.docs = [];
    repository = new FirestoreUsageStatsRepository();
  });

  describe('increment', () => {
    it('creates batch writes for total, monthly, and daily periods', async () => {
      mockBatchCommit.mockResolvedValueOnce(undefined);

      await repository.increment({
        provider: 'google',
        model: 'gemini-2.5-pro',
        success: true,
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 0.0015,
      });

      expect(mockBatch).toHaveBeenCalled();
      expect(mockBatchSet).toHaveBeenCalledTimes(3);
      expect(mockBatchCommit).toHaveBeenCalled();

      expect(mockCollection).toHaveBeenCalledWith('llm_usage_stats');
      expect(mockModelDoc).toHaveBeenCalledWith('google_gemini-2.5-pro');
    });

    it('increments successfulCalls for successful calls', async () => {
      mockBatchCommit.mockResolvedValueOnce(undefined);

      await repository.increment({
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
        success: true,
        inputTokens: 500,
        outputTokens: 1000,
        costUsd: 0.05,
      });

      const setCall = mockBatchSet.mock.calls[0];
      expect(setCall).toBeDefined();
      const data = setCall?.[1] as Record<string, unknown>;
      expect(data).toHaveProperty('successfulCalls');
    });

    it('increments failedCalls for failed calls', async () => {
      mockBatchCommit.mockResolvedValueOnce(undefined);

      await repository.increment({
        provider: 'openai',
        model: 'o4-mini-deep-research',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      });

      const setCall = mockBatchSet.mock.calls[0];
      expect(setCall).toBeDefined();
      const data = setCall?.[1] as Record<string, unknown>;
      expect(data).toHaveProperty('failedCalls');
    });
  });

  describe('getAllTotals', () => {
    it('returns empty array when no stats exist', async () => {
      mockModelsSnapshot.docs = [];

      const result = await repository.getAllTotals();

      expect(result).toEqual([]);
      expect(mockCollection).toHaveBeenCalledWith('llm_usage_stats');
    });

    it('returns total stats for each model', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          provider: 'google',
          model: 'gemini-2.5-pro',
          period: 'total',
          calls: 10,
          successfulCalls: 9,
          failedCalls: 1,
          inputTokens: 5000,
          outputTokens: 10000,
          totalTokens: 15000,
          costUsd: 0.15,
          lastUpdatedAt: '2024-01-01T00:00:00Z',
        }),
      });

      const result = await repository.getAllTotals();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        provider: 'google',
        model: 'gemini-2.5-pro',
        period: 'total',
        calls: 10,
        successfulCalls: 9,
        failedCalls: 1,
        inputTokens: 5000,
        outputTokens: 10000,
        totalTokens: 15000,
        costUsd: 0.15,
        lastUpdatedAt: '2024-01-01T00:00:00Z',
      });
    });

    it('skips models without total document', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({ exists: false });

      const result = await repository.getAllTotals();

      expect(result).toEqual([]);
    });

    it('skips models when data() returns undefined', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => undefined,
      });

      const result = await repository.getAllTotals();

      expect(result).toEqual([]);
    });

    it('uses default values for missing numeric fields', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          provider: 'google',
          model: 'gemini-2.5-pro',
        }),
      });

      const result = await repository.getAllTotals();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        provider: 'google',
        model: 'gemini-2.5-pro',
        period: 'total',
        calls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        lastUpdatedAt: '',
      });
    });
  });

  describe('getByPeriod', () => {
    it('returns stats for specified period', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          period: '2024-01',
          calls: 5,
          successfulCalls: 5,
          failedCalls: 0,
          inputTokens: 2500,
          outputTokens: 5000,
          totalTokens: 7500,
          costUsd: 0.075,
          lastUpdatedAt: '2024-01-15T12:00:00Z',
        }),
      });

      const result = await repository.getByPeriod('2024-01');

      expect(result).toHaveLength(1);
      expect(result[0]?.period).toBe('2024-01');
      expect(mockPeriodDoc).toHaveBeenCalledWith('2024-01');
    });

    it('returns empty array when no stats for period', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({ exists: false });

      const result = await repository.getByPeriod('2099-12');

      expect(result).toEqual([]);
    });

    it('skips models when data() returns undefined', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => undefined,
      });

      const result = await repository.getByPeriod('2024-01');

      expect(result).toEqual([]);
    });

    it('uses default values for missing numeric fields', async () => {
      mockModelsSnapshot.docs = [{ ref: mockModelDocRef }];
      mockPeriodDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          provider: 'openai',
          model: 'gpt-4',
        }),
      });

      const result = await repository.getByPeriod('2024-02');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        provider: 'openai',
        model: 'gpt-4',
        period: '2024-02',
        calls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        lastUpdatedAt: '',
      });
    });
  });
});
