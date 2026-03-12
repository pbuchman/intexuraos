/**
 * Tests for Firestore event decision repository.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { LlmModels } from '@intexuraos/llm-contract';
import type { CreateEventDecisionInput } from '../../../domain/models/eventDecision.js';

// Mock getFirestore BEFORE importing the repository
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { createFirestoreEventDecisionRepository } from '../../../infra/firestore/eventDecisionRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function createDecisionInput(
  overrides: Partial<CreateEventDecisionInput> = {}
): CreateEventDecisionInput {
  return {
    eventId: 'evt_abc123',
    repository: 'intexuraos/test-repo',
    pullRequestNumber: 42,
    eventType: 'issue_comment',
    eventAction: 'created',
    senderLogin: 'testuser',
    decidedBy: 'hard_rules',
    decision: 'dispatch',
    reason: 'ALL_RULES_PASSED',
    decisionLatencyMs: 15,
    ...overrides,
  };
}

describe('createFirestoreEventDecisionRepository', () => {
  describe('save()', () => {
    it('should save an event decision with deterministic ID', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const input = createDecisionInput();
      const result = await repo.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('ed_evt_abc123');
        expect(result.value.eventId).toBe('evt_abc123');
        expect(result.value.repository).toBe('intexuraos/test-repo');
        expect(result.value.pullRequestNumber).toBe(42);
        expect(result.value.eventType).toBe('issue_comment');
        expect(result.value.eventAction).toBe('created');
        expect(result.value.senderLogin).toBe('testuser');
        expect(result.value.decidedBy).toBe('hard_rules');
        expect(result.value.decision).toBe('dispatch');
        expect(result.value.reason).toBe('ALL_RULES_PASSED');
        expect(result.value.decisionLatencyMs).toBe(15);
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }

      expect(mockCollection.doc).toHaveBeenCalledWith('ed_evt_abc123');
      expect(mockDocRef.set).toHaveBeenCalledTimes(1);
    });

    it('should save with optional LLM fields for github_agent decisions', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const input = createDecisionInput({
        decidedBy: 'github_agent',
        decision: 'request_review',
        reason: 'PR needs code review',
        llmModel: LlmModels.Gemini25Flash,
        llmCostUsd: 0.0012,
        llmToolCalls: [
          { tool: 'request_review', args: { review_type: 'code_quality' } },
          { tool: 'request_review', args: { review_type: 'security' } },
        ],
        llmReasoning: 'This PR modifies auth logic across multiple services.',
        dispatchAction: 'create_review_task',
        dispatchParams: {
          reviewTypes: ['code_quality', 'security'],
          workerType: 'qwen',
        },
      });

      const result = await repo.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.decidedBy).toBe('github_agent');
        expect(result.value.decision).toBe('request_review');
        expect(result.value.llmModel).toBe(LlmModels.Gemini25Flash);
        expect(result.value.llmCostUsd).toBe(0.0012);
        expect(result.value.llmToolCalls).toHaveLength(2);
        expect(result.value.llmReasoning).toBe('This PR modifies auth logic across multiple services.');
        expect(result.value.dispatchAction).toBe('create_review_task');
        expect(result.value.dispatchParams?.reviewTypes).toEqual(['code_quality', 'security']);
        expect(result.value.dispatchParams?.workerType).toBe('qwen');
      }
    });

    it('should overwrite on duplicate eventId (deterministic ID)', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });

      // Save twice with same eventId
      await repo.save(createDecisionInput({ reason: 'first' }));
      await repo.save(createDecisionInput({ reason: 'second' }));

      // Both use same deterministic ID — second set() overwrites first
      expect(mockCollection.doc).toHaveBeenCalledWith('ed_evt_abc123');
      expect(mockDocRef.set).toHaveBeenCalledTimes(2);
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockDocRef = {
        set: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const result = await repo.save(createDecisionInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(result.error.message).toContain('Firestore unavailable');
      }
    });

    it('should save with dispatch result fields', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const input = createDecisionInput({
        dispatchSuccess: false,
        dispatchError: 'Worker returned 503',
      });

      const result = await repo.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dispatchSuccess).toBe(false);
        expect(result.value.dispatchError).toBe('Worker returned 503');
      }

      // Verify Firestore data includes the fields
      const savedData = mockDocRef.set.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(savedData['dispatchSuccess']).toBe(false);
      expect(savedData['dispatchError']).toBe('Worker returned 503');
    });

    it('should save with dispatch params for task creation', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const input = createDecisionInput({
        decision: 'dispatch',
        dispatchAction: 'create_task',
        dispatchParams: {
          taskId: 'task_123',
          messageTemplate: 'pr_comment',
        },
      });

      const result = await repo.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dispatchAction).toBe('create_task');
        expect(result.value.dispatchParams?.taskId).toBe('task_123');
        expect(result.value.dispatchParams?.messageTemplate).toBe('pr_comment');
      }
    });

    it('should save route-level decisions with nullable repository metadata', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      const result = await repo.save(createDecisionInput({
        eventId: 'audit_ping_1',
        repository: null,
        pullRequestNumber: null,
        eventType: 'ping',
        eventAction: 'unknown',
        senderLogin: null,
        decidedBy: 'webhook_route',
        decision: 'skip',
        reason: 'ping_event',
      }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.repository).toBeNull();
        expect(result.value.pullRequestNumber).toBeNull();
        expect(result.value.senderLogin).toBeNull();
        expect(result.value.decidedBy).toBe('webhook_route');
      }
    });
  });

  describe('findByEventIds()', () => {
    it('returns found decisions, skips missing docs, and normalizes Firestore date shapes', async () => {
      const snapshotById = new Map<string, {
        exists: boolean;
        id: string;
        data?: () => Record<string, unknown>;
      }>([
        ['ed_evt_date', {
          exists: true,
          id: 'ed_evt_date',
          data: (): Record<string, unknown> => ({
            eventId: 'evt_date',
            repository: 'intexuraos/test-repo',
            pullRequestNumber: 10,
            eventType: 'pull_request',
            eventAction: 'opened',
            senderLogin: 'octocat',
            decidedBy: 'hard_rules',
            decision: 'dispatch',
            reason: 'ALL_RULES_PASSED',
            createdAt: new Date('2026-03-12T10:00:00.000Z'),
            decisionLatencyMs: 4,
          }),
        }],
        ['ed_evt_missing', {
          exists: false,
          id: 'ed_evt_missing',
        }],
        ['ed_evt_timestamp', {
          exists: true,
          id: 'ed_evt_timestamp',
          data: (): Record<string, unknown> => ({
            eventId: 'evt_timestamp',
            repository: 'intexuraos/test-repo',
            pullRequestNumber: 11,
            eventType: 'issue_comment',
            eventAction: 'created',
            senderLogin: 'octocat',
            decidedBy: 'github_agent',
            decision: 'skip',
            reason: 'BOT_NOISE',
            createdAt: { toDate: () => new Date('2026-03-12T10:01:00.000Z') },
            decisionLatencyMs: 8,
          }),
        }],
        ['ed_evt_string', {
          exists: true,
          id: 'ed_evt_string',
          data: (): Record<string, unknown> => ({
            eventId: 'evt_string',
            repository: 'intexuraos/test-repo',
            pullRequestNumber: 12,
            eventType: 'pull_request_review',
            eventAction: 'submitted',
            senderLogin: 'octocat',
            decidedBy: 'webhook_route',
            decision: 'skip',
            reason: 'unsupported_event',
            createdAt: '2026-03-12T10:02:00.000Z',
            decisionLatencyMs: 12,
          }),
        }],
      ]);

      const mockCollection = {
        doc: vi.fn().mockImplementation((id: string): { get: ReturnType<typeof vi.fn> } => ({
          get: vi.fn().mockResolvedValue(snapshotById.get(id)),
        })),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreEventDecisionRepository({ logger: mockLogger });
      if (repo.findByEventIds === undefined) {
        throw new Error('findByEventIds is not configured');
      }
      const result = await repo.findByEventIds(['evt_date', 'evt_missing', 'evt_timestamp', 'evt_string']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value.map((decision) => decision.id)).toEqual([
          'ed_evt_date',
          'ed_evt_timestamp',
          'ed_evt_string',
        ]);
        expect(result.value.map((decision) => decision.createdAt.toISOString())).toEqual([
          '2026-03-12T10:00:00.000Z',
          '2026-03-12T10:01:00.000Z',
          '2026-03-12T10:02:00.000Z',
        ]);
      }
    });
  });
});
