import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import { FirestoreUsageAggregateRepository } from '../../../infra/firestore/firestoreUsageAggregateRepository.js';
import { createTestEvent } from '../../helpers.js';

// Mock FieldValue
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (value: number): { __increment: number } => ({ __increment: value }),
  },
}));

// Mock getFirestore
const mockSet = vi.fn();
const mockGet = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ set: mockSet });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc, where: mockWhere });

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collection: typeof mockCollection } => ({ collection: mockCollection }),
}));

describe('FirestoreUsageAggregateRepository', () => {
  let repo: FirestoreUsageAggregateRepository;

  beforeEach(() => {
    repo = new FirestoreUsageAggregateRepository();
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ set: mockSet });
    mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere });
    mockWhere.mockReturnValue({ where: mockWhere, get: mockGet });
  });

  describe('incrementAggregate', () => {
    it('calls set with merge:true on success', async () => {
      mockSet.mockResolvedValue(undefined);
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: 'user',
          ownerId: 'user_123',
          sourceService: 'orchestrator',
          provider: LlmProviders.Anthropic,
        }),
        { merge: true },
      );
    });

    it('returns error on Firestore failure', async () => {
      mockSet.mockRejectedValue({ code: 13, message: 'Internal error' });
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('13');
      }
    });

    it('handles errors without code or message', async () => {
      mockSet.mockRejectedValue({});
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });
  });

  describe('queryAggregates', () => {
    it('returns aggregates from Firestore query', async () => {
      const docData = {
        aggregateId: 'agg_1',
        date: '2026-04-10',
        ownerType: 'user',
        ownerId: 'user_123',
        sourceService: 'orchestrator',
        sourceComponent: 'research',
        sourceClient: 'web',
        sourceEnvironment: 'dev',
        provider: LlmProviders.Anthropic,
        model: 'claude-sonnet-4-20250514',
        operation: 'generate',
        success: true,
        calls: 10,
        costUsd: 0.05,
        inputTokens: 1000,
        outputTokens: 2000,
        totalTokens: 3000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
        imageCount: 0,
        firstOccurredAt: '2026-04-10T08:00:00.000Z',
        lastOccurredAt: '2026-04-10T20:00:00.000Z',
        updatedAt: '2026-04-10T20:00:01.000Z',
      };

      mockGet.mockResolvedValue({
        docs: [{ data: (): typeof docData => docData }],
      });

      const result = await repo.queryAggregates(
        '2026-04-10T00:00:00Z',
        '2026-04-10T23:59:59Z',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.calls).toBe(10);
      }
    });

    it('returns error on Firestore query failure', async () => {
      mockGet.mockRejectedValue({ code: 13, message: 'Query failed' });

      const result = await repo.queryAggregates(
        '2026-04-10T00:00:00Z',
        '2026-04-10T23:59:59Z',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('13');
      }
    });

    it('handles errors without code or message', async () => {
      mockGet.mockRejectedValue({});

      const result = await repo.queryAggregates(
        '2026-04-10T00:00:00Z',
        '2026-04-10T23:59:59Z',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });
  });
});
