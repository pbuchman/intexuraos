import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { createGithubWebhookAgentRunsRepository } from '../../../infra/firestore/githubWebhookAgentRunsRepository.js';
import type { WebhookAgentRunRecord } from '../../../domain/githubWebhookAgent/models.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function validRunRecord(): WebhookAgentRunRecord {
  return {
    runId: 'run-001',
    savedEventId: 'evt-123',
    eventGroup: 'comment' as const,
    startedAt: '2026-02-27T10:00:00Z',
    completedAt: '2026-02-27T10:00:05Z',
    durationMs: 5000,
    decision: {
      version: '1.0' as const,
      eventGroup: 'comment' as const,
      actionability: 'actionable' as const,
      confidence: 0.9,
      reasoning: 'Code change request',
      requestedWorkerType: null,
      decision: { kind: 'send_task_message' as const },
    },
    actionPlan: {
      version: '1.0' as const,
      decisionKind: 'send_task_message' as const,
      actions: [
        { actionId: 'act-1', type: 'dispatch_task' as const, params: { prompt: 'Fix bug' } },
      ],
    },
    stepResults: [
      { actionId: 'act-1', status: 'success' as const, durationMs: 120 },
    ],
    outcome: 'completed' as const,
  };
}

describe('createGithubWebhookAgentRunsRepository', () => {
  let mockDocRef: { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let mockCollection: { doc: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocRef = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    };
    mockCollection = {
      doc: vi.fn(() => mockDocRef),
    };
    mockGetFirestore.mockReturnValue({
      collection: vi.fn(() => mockCollection),
    } as never);
  });

  describe('upsert()', () => {
    it('stores a run record and reads it back with step list', async () => {
      const record = validRunRecord();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => record,
      });

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const upsertResult = await repo.upsert(record);

      expect(upsertResult.ok).toBe(true);
      expect(mockDocRef.set).toHaveBeenCalledWith(record, { merge: true });
      expect(mockCollection.doc).toHaveBeenCalledWith('run-001');

      const getResult = await repo.findByRunId('run-001');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.stepResults).toHaveLength(1);
        expect(getResult.value.stepResults[0]?.actionId).toBe('act-1');
      }
    });

    it('rejects invalid run record before persistence', async () => {
      const invalid = { ...validRunRecord(), runId: '' };

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.upsert(invalid);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
      expect(mockDocRef.set).not.toHaveBeenCalled();
    });

    it('handles Firestore errors during upsert', async () => {
      mockDocRef.set.mockRejectedValue(new Error('Firestore unavailable'));

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.upsert(validRunRecord());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('findByRunId()', () => {
    it('returns null for non-existent run', async () => {
      mockDocRef.get.mockResolvedValue({ exists: false });

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.findByRunId('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('handles Firestore errors during read', async () => {
      mockDocRef.get.mockRejectedValue(new Error('Read failed'));

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.findByRunId('run-001');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findBySavedEventId()', () => {
    it('returns runs for a given saved event id', async () => {
      const record = validRunRecord();
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: false,
          docs: [{ id: 'run-001', data: (): WebhookAgentRunRecord => record }],
        }),
      };
      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.findBySavedEventId('evt-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.runId).toBe('run-001');
      }
    });

    it('returns empty array when no runs found', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createGithubWebhookAgentRunsRepository({ logger: mockLogger });
      const result = await repo.findBySavedEventId('evt-999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });
});
