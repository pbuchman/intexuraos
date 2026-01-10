import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MockDoc {
  ref: { path: string };
  data: () => Record<string, unknown>;
}

const mockGet = vi.fn();
const mockWhere = vi.fn(() => ({ get: mockGet }));
const mockCollectionGroup = vi.fn(() => ({ where: mockWhere }));

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collectionGroup: typeof mockCollectionGroup } => ({
    collectionGroup: mockCollectionGroup,
  }),
}));

describe('FirestoreUsageStatsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function createMockDoc(
    model: string,
    callType: string,
    period: string,
    userId: string,
    data: Record<string, unknown>
  ): MockDoc {
    return {
      ref: {
        path: `llm_usage_stats/${model}/by_call_type/${callType}/by_period/${period}/by_user/${userId}`,
      },
      data: () => ({
        userId,
        ...data,
      }),
    };
  }

  it('returns empty data for user with no usage records', async () => {
    mockGet.mockResolvedValue({ docs: [] });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(0);
    expect(result.totalCalls).toBe(0);
    expect(result.monthlyBreakdown).toHaveLength(0);
    expect(result.byModel).toHaveLength(0);
    expect(result.byCallType).toHaveLength(0);
    expect(mockCollectionGroup).toHaveBeenCalledWith('by_user');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-123');
  });

  it('aggregates single day usage correctly', async () => {
    const docs = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 9,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 0.25,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(0.25);
    expect(result.totalCalls).toBe(10);
    expect(result.totalInputTokens).toBe(5000);
    expect(result.totalOutputTokens).toBe(2500);
    expect(result.monthlyBreakdown).toHaveLength(1);
    expect(result.monthlyBreakdown[0]?.month).toBe('2026-01');
    expect(result.monthlyBreakdown[0]?.costUsd).toBe(0.25);
    expect(result.byModel).toHaveLength(1);
    expect(result.byModel[0]?.model).toBe('gemini-2.0-flash-exp');
    expect(result.byCallType).toHaveLength(1);
    expect(result.byCallType[0]?.callType).toBe('research');
  });

  it('aggregates multiple models and call types', async () => {
    const docs = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 0.25,
      }),
      createMockDoc('claude-3.5-sonnet', 'research', '2026-01-08', 'user-123', {
        totalCalls: 5,
        successfulCalls: 5,
        inputTokens: 3000,
        outputTokens: 1500,
        costUsd: 0.75,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'generate', '2026-01-08', 'user-123', {
        totalCalls: 8,
        successfulCalls: 8,
        inputTokens: 2000,
        outputTokens: 4000,
        costUsd: 0.15,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(1.15);
    expect(result.totalCalls).toBe(23);
    expect(result.byModel).toHaveLength(2);
    expect(result.byCallType).toHaveLength(2);

    const geminiCost = result.byModel.find((m) => m.model === 'gemini-2.0-flash-exp');
    expect(geminiCost?.costUsd).toBe(0.4);
    expect(geminiCost?.calls).toBe(18);

    const researchCost = result.byCallType.find((c) => c.callType === 'research');
    expect(researchCost?.costUsd).toBe(1);
    expect(researchCost?.calls).toBe(15);
  });

  it('aggregates multiple months correctly', async () => {
    const docs = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-05', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'research', '2025-12-15', 'user-123', {
        totalCalls: 15,
        successfulCalls: 15,
        inputTokens: 7500,
        outputTokens: 3750,
        costUsd: 1.5,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'research', '2025-11-20', 'user-123', {
        totalCalls: 20,
        successfulCalls: 20,
        inputTokens: 10000,
        outputTokens: 5000,
        costUsd: 2.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(4.5);
    expect(result.monthlyBreakdown).toHaveLength(3);
    expect(result.monthlyBreakdown[0]?.month).toBe('2026-01');
    expect(result.monthlyBreakdown[1]?.month).toBe('2025-12');
    expect(result.monthlyBreakdown[2]?.month).toBe('2025-11');
  });

  it('filters out records older than days parameter', async () => {
    const docs = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'research', '2025-10-01', 'user-123', {
        totalCalls: 100,
        successfulCalls: 100,
        inputTokens: 50000,
        outputTokens: 25000,
        costUsd: 10.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123', 90);

    expect(result.totalCostUsd).toBe(1.0);
    expect(result.totalCalls).toBe(10);
  });

  it('ignores non-date period documents', async () => {
    const docsWithInvalidPeriod = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'research', 'total', 'user-123', {
        totalCalls: 100,
        successfulCalls: 100,
        inputTokens: 50000,
        outputTokens: 25000,
        costUsd: 10.0,
      }),
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01', 'user-123', {
        totalCalls: 50,
        successfulCalls: 50,
        inputTokens: 25000,
        outputTokens: 12500,
        costUsd: 5.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs: docsWithInvalidPeriod });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(1.0);
    expect(result.totalCalls).toBe(10);
  });

  it('calculates percentages correctly', async () => {
    const docs = [
      createMockDoc('gemini-2.0-flash-exp', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 3.0,
      }),
      createMockDoc('claude-3.5-sonnet', 'generate', '2026-01-08', 'user-123', {
        totalCalls: 5,
        successfulCalls: 5,
        inputTokens: 2500,
        outputTokens: 1250,
        costUsd: 1.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    const gemini = result.byModel.find((m) => m.model === 'gemini-2.0-flash-exp');
    expect(gemini?.percentage).toBe(75);

    const claude = result.byModel.find((m) => m.model === 'claude-3.5-sonnet');
    expect(claude?.percentage).toBe(25);
  });

  it('sorts byModel by cost descending', async () => {
    const docs = [
      createMockDoc('cheap-model', 'research', '2026-01-08', 'user-123', {
        totalCalls: 100,
        successfulCalls: 100,
        inputTokens: 50000,
        outputTokens: 25000,
        costUsd: 0.5,
      }),
      createMockDoc('expensive-model', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 5.0,
      }),
      createMockDoc('mid-model', 'research', '2026-01-08', 'user-123', {
        totalCalls: 50,
        successfulCalls: 50,
        inputTokens: 25000,
        outputTokens: 12500,
        costUsd: 2.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.byModel[0]?.model).toBe('expensive-model');
    expect(result.byModel[1]?.model).toBe('mid-model');
    expect(result.byModel[2]?.model).toBe('cheap-model');
  });

  it('sorts monthlyBreakdown by month descending', async () => {
    const docs = [
      createMockDoc('gemini', 'research', '2025-11-01', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
      createMockDoc('gemini', 'research', '2026-01-01', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
      createMockDoc('gemini', 'research', '2025-12-01', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 1.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.monthlyBreakdown[0]?.month).toBe('2026-01');
    expect(result.monthlyBreakdown[1]?.month).toBe('2025-12');
    expect(result.monthlyBreakdown[2]?.month).toBe('2025-11');
  });

  it('rounds costs to 6 decimal places', async () => {
    const docs = [
      createMockDoc('gemini', 'research', '2026-01-08', 'user-123', {
        totalCalls: 1,
        successfulCalls: 1,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.123456789,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(0.123457);
  });

  it('skips documents with invalid path structure (< 8 parts)', async () => {
    const invalidPathDocs = [
      {
        ref: { path: 'llm_usage_stats/gemini/by_call_type/research/by_period/2026-01-08' },
        data: () => ({
          userId: 'user-123',
          totalCalls: 10,
          successfulCalls: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          costUsd: 1.0,
        }),
      },
      {
        ref: { path: 'short/path' },
        data: () => ({
          userId: 'user-123',
          totalCalls: 100,
          successfulCalls: 100,
          inputTokens: 50000,
          outputTokens: 25000,
          costUsd: 10.0,
        }),
      },
      createMockDoc('gemini', 'research', '2026-01-08', 'user-123', {
        totalCalls: 5,
        successfulCalls: 5,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.5,
      }),
    ];
    mockGet.mockResolvedValue({ docs: invalidPathDocs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    // Should only include the valid document
    expect(result.totalCostUsd).toBe(0.5);
    expect(result.totalCalls).toBe(5);
  });

  it('skips documents with empty string segments in path', async () => {
    // Documents with empty strings for model/callType will be processed
    // (empty string is not undefined, so it passes the undefined check)
    // Only empty period will be filtered by isValidDatePeriod
    const docsWithEmptyParts = [
      {
        ref: {
          path: 'llm_usage_stats//by_call_type/research/by_period//by_user/user-123',
        },
        data: () => ({
          userId: 'user-123',
          totalCalls: 10,
          successfulCalls: 10,
          inputTokens: 5000,
          outputTokens: 2500,
          costUsd: 1.0,
        }),
      },
      createMockDoc('gemini', 'research', '2026-01-08', 'user-123', {
        totalCalls: 5,
        successfulCalls: 5,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.5,
      }),
    ];
    mockGet.mockResolvedValue({ docs: docsWithEmptyParts });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    // Empty period fails isValidDatePeriod check, so first doc is excluded
    expect(result.totalCostUsd).toBe(0.5);
    expect(result.totalCalls).toBe(5);
  });

  it('returns zero percentages when totalCostUsd is zero', async () => {
    const docs = [
      createMockDoc('gemini', 'research', '2026-01-08', 'user-123', {
        totalCalls: 10,
        successfulCalls: 10,
        inputTokens: 5000,
        outputTokens: 2500,
        costUsd: 0.0,
      }),
      createMockDoc('claude', 'generate', '2026-01-08', 'user-123', {
        totalCalls: 5,
        successfulCalls: 5,
        inputTokens: 2500,
        outputTokens: 1250,
        costUsd: 0.0,
      }),
    ];
    mockGet.mockResolvedValue({ docs });

    const { FirestoreUsageStatsRepository } = await import(
      '../../infra/firestore/usageStatsRepository.js'
    );
    const repo = new FirestoreUsageStatsRepository();
    const result = await repo.getUserCosts('user-123');

    expect(result.totalCostUsd).toBe(0);
    expect(result.totalCalls).toBe(15);
    expect(result.monthlyBreakdown[0]?.percentage).toBe(0);
    expect(result.byModel[0]?.percentage).toBe(0);
    expect(result.byModel[1]?.percentage).toBe(0);
    expect(result.byCallType[0]?.percentage).toBe(0);
    expect(result.byCallType[1]?.percentage).toBe(0);
  });
});
