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
const mockUpdate = vi.fn();
const mockDocGet = vi.fn();
const mockGet = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ set: mockSet, update: mockUpdate, get: mockDocGet });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc, where: mockWhere });

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collection: typeof mockCollection } => ({ collection: mockCollection }),
}));

describe('FirestoreUsageAggregateRepository', () => {
  let repo: FirestoreUsageAggregateRepository;

  beforeEach(() => {
    repo = new FirestoreUsageAggregateRepository();
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ set: mockSet, update: mockUpdate, get: mockDocGet });
    mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere });
    mockWhere.mockReturnValue({ where: mockWhere, get: mockGet });
    mockDocGet.mockResolvedValue({ exists: false });
  });

  describe('incrementAggregate', () => {
    it('calls set when doc does not exist (new aggregate)', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
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
          firstOccurredAt: event.occurredAt,
          lastOccurredAt: event.occurredAt,
          promptType: '__missing__',
        }),
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('calls update when doc exists (preserves firstOccurredAt)', async () => {
      mockDocGet.mockResolvedValue({ exists: true });
      mockUpdate.mockResolvedValue(undefined);
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          lastOccurredAt: event.occurredAt,
        }),
      );
      // firstOccurredAt should NOT be in the update call
      const updateArg = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('firstOccurredAt');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('returns error on Firestore failure', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      mockSet.mockRejectedValue({ code: 13, message: 'Internal error' });
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('13');
      }
    });

    it('handles errors without code or message', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      mockSet.mockRejectedValue({});
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('returns error when get fails', async () => {
      mockDocGet.mockRejectedValue({ code: 14, message: 'Unavailable' });
      const event = createTestEvent();

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('14');
      }
    });

    it('uses a safe document id while preserving the raw Research component', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      mockSet.mockResolvedValue(undefined);
      const component = 'research:or:google/gemini-3.6-flash';
      const event = createTestEvent({
        source: { service: 'research-agent', component, client: 'openrouter', environment: 'prod' },
        request: {
          provider: LlmProviders.OpenRouter,
          model: 'or:google/gemini-3.6-flash',
          operation: 'research',
          success: true,
          durationMs: 100,
        },
      });

      const result = await repo.incrementAggregate(event);

      expect(result.ok).toBe(true);
      expect(mockDoc).toHaveBeenCalledWith(expect.not.stringContaining('/'));
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ sourceComponent: component }),
      );
    });
  });

  describe('incrementAggregate — does not throw on bad doc-id', () => {
    it('returns err Result instead of throwing when Firestore rejects the doc id', async () => {
      mockDoc.mockImplementationOnce(() => {
        throw new Error('Value for argument "documentPath" must point to a document');
      });

      const repo = new FirestoreUsageAggregateRepository();
      const result = await repo.incrementAggregate(createTestEvent());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/documentPath/);
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
        promptType: 'plan-analysis',
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
        expect(result.value[0]?.promptType).toBe('plan-analysis');
      }
    });

    it('maps missing promptType documents to the deterministic sentinel', async () => {
      const docData = {
        aggregateId: 'agg_legacy',
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
        expect(result.value[0]?.promptType).toBe('__missing__');
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
