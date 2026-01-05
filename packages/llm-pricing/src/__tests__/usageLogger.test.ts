import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockTransaction = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
};

const mockDocRef = { id: 'test-doc-ref' };
const mockUserDocRef = { id: 'test-user-doc-ref' };
const mockByUserCollection = {
  doc: vi.fn().mockReturnValue(mockUserDocRef),
};

const mockMainDoc = {
  ...mockDocRef,
  collection: vi.fn().mockReturnValue(mockByUserCollection),
};

const mockFirestore = {
  collection: vi.fn().mockReturnValue({
    doc: vi.fn().mockReturnValue(mockMainDoc),
  }),
  runTransaction: vi.fn(async (callback: (tx: typeof mockTransaction) => Promise<void>) => {
    await callback(mockTransaction);
  }),
};

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): typeof mockFirestore => mockFirestore,
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
    provider: 'google' as const,
    model: 'gemini-2.5-flash',
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
    it('creates new document when it does not exist', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      const setCalls = mockTransaction.set.mock.calls;
      const mainDocSetCall = setCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocSetCall).toBeDefined();
      expect(mainDocSetCall?.[1]).toMatchObject({
        provider: 'google',
        model: 'gemini-2.5-flash',
        callType: 'research',
        totalCalls: 1,
        successfulCalls: 1,
        failedCalls: 0,
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        costUsd: 0.001,
      });
    });

    it('creates document with failedCalls when success is false', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage({ ...baseParams, success: false, errorMessage: 'Test error' });

      const setCalls = mockTransaction.set.mock.calls;
      const mainDocSetCall = setCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocSetCall?.[1]).toMatchObject({
        totalCalls: 1,
        successfulCalls: 0,
        failedCalls: 1,
      });
    });

    it('updates existing document', async () => {
      const existingData = {
        totalCalls: 5,
        successfulCalls: 4,
        failedCalls: 1,
        inputTokens: 500,
        outputTokens: 1000,
        totalTokens: 1500,
        costUsd: 0.01,
      };
      mockTransaction.get.mockResolvedValue({ exists: true, data: () => existingData });

      await logUsage(baseParams);

      const updateCalls = mockTransaction.update.mock.calls;
      const mainDocUpdateCall = updateCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocUpdateCall).toBeDefined();
      expect(mainDocUpdateCall?.[1]).toMatchObject({
        totalCalls: 6,
        successfulCalls: 5,
        failedCalls: 1,
        inputTokens: 600,
        outputTokens: 1200,
        totalTokens: 1800,
      });
      expect(mainDocUpdateCall?.[1].costUsd).toBeCloseTo(0.011, 5);
    });

    it('updates existing document with failed call', async () => {
      const existingData = {
        totalCalls: 5,
        successfulCalls: 5,
        failedCalls: 0,
        inputTokens: 500,
        outputTokens: 1000,
        totalTokens: 1500,
        costUsd: 0.01,
      };
      mockTransaction.get.mockResolvedValue({ exists: true, data: () => existingData });

      await logUsage({ ...baseParams, success: false });

      const updateCalls = mockTransaction.update.mock.calls;
      const mainDocUpdateCall = updateCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocUpdateCall?.[1]).toMatchObject({
        totalCalls: 6,
        successfulCalls: 5,
        failedCalls: 1,
      });
    });

    it('skips logging when disabled via env var', async () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';

      await logUsage(baseParams);

      expect(mockFirestore.runTransaction).not.toHaveBeenCalled();
    });

    it('silently catches errors', async () => {
      mockFirestore.runTransaction.mockRejectedValueOnce(new Error('Firestore error'));

      await expect(logUsage(baseParams)).resolves.toBeUndefined();
    });

    it('logs per-user stats when userId is provided', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      expect(mockByUserCollection.doc).toHaveBeenCalledWith('user-123');
      expect(mockFirestore.runTransaction).toHaveBeenCalledTimes(2);
    });

    it('skips per-user stats when userId is empty', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage({ ...baseParams, userId: '' });

      expect(mockFirestore.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('creates new user document when it does not exist', async () => {
      mockTransaction.get
        .mockResolvedValueOnce({ exists: false, data: () => undefined })
        .mockResolvedValueOnce({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      const setCalls = mockTransaction.set.mock.calls;
      const userDocSetCall = setCalls.find((call) => call[0]?.id === 'test-user-doc-ref');
      expect(userDocSetCall).toBeDefined();
      expect(userDocSetCall?.[1]).toMatchObject({
        userId: 'user-123',
        totalCalls: 1,
        successfulCalls: 1,
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 0.001,
      });
    });

    it('updates existing user document', async () => {
      const existingUserData = {
        totalCalls: 10,
        successfulCalls: 9,
        inputTokens: 1000,
        outputTokens: 2000,
        costUsd: 0.05,
      };
      mockTransaction.get
        .mockResolvedValueOnce({ exists: false, data: () => undefined })
        .mockResolvedValueOnce({ exists: true, data: () => existingUserData });

      await logUsage(baseParams);

      const updateCalls = mockTransaction.update.mock.calls;
      const userDocUpdateCall = updateCalls.find((call) => call[0]?.id === 'test-user-doc-ref');
      expect(userDocUpdateCall).toBeDefined();
      expect(userDocUpdateCall?.[1]).toMatchObject({
        totalCalls: 11,
        successfulCalls: 10,
        inputTokens: 1100,
        outputTokens: 2200,
      });
      expect(userDocUpdateCall?.[1].costUsd).toBeCloseTo(0.051, 5);
    });

    it('creates user document with successfulCalls=0 when success is false', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage({ ...baseParams, success: false });

      const setCalls = mockTransaction.set.mock.calls;
      const userDocSetCall = setCalls.find((call) => call[0]?.id === 'test-user-doc-ref');
      expect(userDocSetCall?.[1]).toMatchObject({
        successfulCalls: 0,
      });
    });

    it('uses correct collection name', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });

      await logUsage(baseParams);

      expect(mockFirestore.collection).toHaveBeenCalledWith('llm_usage_stats');
    });

    it('generates correct document ID format', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      const docFn = mockFirestore.collection('llm_usage_stats').doc;
      expect(docFn).toHaveBeenCalledWith('google_gemini-2.5-flash_research_2025-01-05');

      vi.useRealTimers();
    });

    it('includes date in created document', async () => {
      mockTransaction.get.mockResolvedValue({ exists: false, data: () => undefined });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T10:00:00.000Z'));

      await logUsage(baseParams);

      const setCalls = mockTransaction.set.mock.calls;
      const mainDocSetCall = setCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocSetCall?.[1].date).toBe('2025-01-05');
      expect(mainDocSetCall?.[1].createdAt).toBe('2025-01-05T10:00:00.000Z');
      expect(mainDocSetCall?.[1].updatedAt).toBe('2025-01-05T10:00:00.000Z');

      vi.useRealTimers();
    });

    it('includes updatedAt in updated document', async () => {
      const existingData = {
        totalCalls: 1,
        successfulCalls: 1,
        failedCalls: 0,
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        costUsd: 0.001,
      };
      mockTransaction.get.mockResolvedValue({ exists: true, data: () => existingData });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-05T12:00:00.000Z'));

      await logUsage(baseParams);

      const updateCalls = mockTransaction.update.mock.calls;
      const mainDocUpdateCall = updateCalls.find((call) => call[0]?.id === 'test-doc-ref');
      expect(mainDocUpdateCall?.[1].updatedAt).toBe('2025-01-05T12:00:00.000Z');

      vi.useRealTimers();
    });
  });
});
