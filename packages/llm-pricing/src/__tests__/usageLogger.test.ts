import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockBatch = {
  set: vi.fn().mockReturnThis(),
  commit: vi.fn().mockResolvedValue(undefined),
};

const mockTransaction = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
};

const mockUserDocRef = { id: 'user-123', path: 'by_user/user-123' };
const mockByUserCollection = {
  doc: vi.fn().mockReturnValue(mockUserDocRef),
};

const mockPeriodDocRef = {
  collection: vi.fn().mockReturnValue(mockByUserCollection),
};
const mockByPeriodCollection = {
  doc: vi.fn().mockReturnValue(mockPeriodDocRef),
};

const mockCallTypeDocRef = {
  collection: vi.fn().mockReturnValue(mockByPeriodCollection),
};
const mockByCallTypeCollection = {
  doc: vi.fn().mockReturnValue(mockCallTypeDocRef),
};

const mockModelDocRef = {
  collection: vi.fn().mockReturnValue(mockByCallTypeCollection),
};
const mockCollection = {
  doc: vi.fn().mockReturnValue(mockModelDocRef),
};

const mockFirestore = {
  collection: vi.fn().mockReturnValue(mockCollection),
  batch: vi.fn().mockReturnValue(mockBatch),
  runTransaction: vi.fn(async (callback: (tx: typeof mockTransaction) => Promise<void>) => {
    await callback(mockTransaction);
  }),
};

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): typeof mockFirestore => mockFirestore,
  FieldValue: {
    increment: (n: number): { _increment: number } => ({ _increment: n }),
  },
}));

const { logUsage, isUsageLoggingEnabled } = await import('../usageLogger.js');

describe('usageLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['INTEXURAOS_LOG_LLM_USAGE'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseParams = {
    userId: 'user-123',
    provider: LlmProviders.Google as const,
    model: LlmModels.Gemini25Flash,
    callType: 'research' as const,
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      costUsd: 0.001,
    },
    success: true,
  };

  describe('isUsageLoggingEnabled', () => {
    it('returns true when env var is undefined', () => {
      delete process.env['INTEXURAOS_LOG_LLM_USAGE'];
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns true when env var is empty string', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '';
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns false when env var is "false"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "FALSE"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'FALSE';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "0"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '0';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "no"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'no';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "NO"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'NO';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns true when env var is "true"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'true';
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '1';
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns true when env var is "yes"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'yes';
      expect(isUsageLoggingEnabled()).toBe(true);
    });
  });

  describe('logUsage', () => {
    it('uses model as document ID in collection', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      expect(mockFirestore.collection).toHaveBeenCalledWith('llm_usage_stats');
      expect(mockCollection.doc).toHaveBeenCalledWith(LlmModels.Gemini25Flash);
    });

    it('creates batch with model metadata', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      const setCalls = mockBatch.set.mock.calls;
      const modelSetCall = setCalls.find(
        (call) => call[1]?.model === LlmModels.Gemini25Flash && call[1]?.provider === LlmProviders.Google
      );
      expect(modelSetCall).toBeDefined();
      expect(modelSetCall?.[1]).toMatchObject({
        model: LlmModels.Gemini25Flash,
        provider: LlmProviders.Google,
      });
      expect(modelSetCall?.[2]).toEqual({ merge: true });

      vi.useRealTimers();
    });

    it('creates batch with callType metadata', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      expect(mockModelDocRef.collection).toHaveBeenCalledWith('by_call_type');
      expect(mockByCallTypeCollection.doc).toHaveBeenCalledWith('research');

      const setCalls = mockBatch.set.mock.calls;
      const callTypeSetCall = setCalls.find(
        (call) => call[1]?.callType === 'research' && !call[1]?.model
      );
      expect(callTypeSetCall).toBeDefined();
      expect(callTypeSetCall?.[1]).toMatchObject({
        callType: 'research',
      });

      vi.useRealTimers();
    });

    it('updates three period documents: total, month, day', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      expect(mockCallTypeDocRef.collection).toHaveBeenCalledWith('by_period');
      expect(mockByPeriodCollection.doc).toHaveBeenCalledWith('total');
      expect(mockByPeriodCollection.doc).toHaveBeenCalledWith('2025-01');
      expect(mockByPeriodCollection.doc).toHaveBeenCalledWith('2025-01-05');

      vi.useRealTimers();
    });

    it('uses FieldValue.increment for atomic updates', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      const setCalls = mockBatch.set.mock.calls;
      const periodSetCall = setCalls.find((call) => call[1]?.period === 'total');
      expect(periodSetCall).toBeDefined();
      expect(periodSetCall?.[1].totalCalls).toEqual({ _increment: 1 });
      expect(periodSetCall?.[1].successfulCalls).toEqual({ _increment: 1 });
      expect(periodSetCall?.[1].failedCalls).toEqual({ _increment: 0 });
      expect(periodSetCall?.[1].inputTokens).toEqual({ _increment: 100 });
      expect(periodSetCall?.[1].outputTokens).toEqual({ _increment: 200 });
      expect(periodSetCall?.[1].totalTokens).toEqual({ _increment: 300 });
      expect(periodSetCall?.[1].costUsd).toEqual({ _increment: 0.001 });
    });

    it('increments failedCalls when success is false', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage({ ...baseParams, success: false });

      const setCalls = mockBatch.set.mock.calls;
      const periodSetCall = setCalls.find((call) => call[1]?.period === 'total');
      expect(periodSetCall?.[1].successfulCalls).toEqual({ _increment: 0 });
      expect(periodSetCall?.[1].failedCalls).toEqual({ _increment: 1 });
    });

    it('commits the batch', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('skips logging when disabled via env var', async () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';

      await logUsage(baseParams);

      expect(mockFirestore.batch).not.toHaveBeenCalled();
    });

    it('silently catches errors', async () => {
      mockBatch.commit.mockRejectedValueOnce(new Error('Firestore error'));

      await expect(logUsage(baseParams)).resolves.toBeUndefined();
    });

    it('logs per-user stats when userId is provided', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      expect(mockFirestore.runTransaction).toHaveBeenCalled();
      expect(mockByUserCollection.doc).toHaveBeenCalledWith('user-123');
    });

    it('skips per-user stats when userId is empty', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage({ ...baseParams, userId: '' });

      expect(mockFirestore.runTransaction).not.toHaveBeenCalled();
    });

    it('creates new user document when it does not exist', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      expect(mockTransaction.set).toHaveBeenCalled();
      const setCall = mockTransaction.set.mock.calls[0];
      expect(setCall?.[1]).toMatchObject({
        userId: 'user-123',
        createdAt: '2025-01-05T10:00:00.000Z',
      });

      vi.useRealTimers();
    });

    it('updates existing user document', async () => {
      mockTransaction.get.mockResolvedValue({ exists: true, data: () => ({}) });

      await logUsage(baseParams);

      expect(mockTransaction.update).toHaveBeenCalled();
    });

    it('uses FieldValue.increment for user stats', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      const setCall = mockTransaction.set.mock.calls[0];
      expect(setCall?.[1].totalCalls).toEqual({ _increment: 1 });
      expect(setCall?.[1].successfulCalls).toEqual({ _increment: 1 });
      expect(setCall?.[1].inputTokens).toEqual({ _increment: 100 });
      expect(setCall?.[1].outputTokens).toEqual({ _increment: 200 });
      expect(setCall?.[1].costUsd).toEqual({ _increment: 0.001 });
    });

    it('includes updatedAt in period documents', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T12:00:00.000Z'));

      await logUsage(baseParams);

      const setCalls = mockBatch.set.mock.calls;
      const periodSetCall = setCalls.find((call) => call[1]?.period === 'total');
      expect(periodSetCall?.[1].updatedAt).toBe('2025-01-05T12:00:00.000Z');

      vi.useRealTimers();
    });

    it('user document path is under date period', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      expect(mockByPeriodCollection.doc).toHaveBeenCalledWith('2025-01-05');
      expect(mockPeriodDocRef.collection).toHaveBeenCalledWith('by_user');

      vi.useRealTimers();
    });
  });
});
