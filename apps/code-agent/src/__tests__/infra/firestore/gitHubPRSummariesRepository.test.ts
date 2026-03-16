/**
 * Tests for Firestore GitHub PR summaries repository.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { UpsertGitHubPRSummaryInput } from '../../../domain/models/gitHubPRSummary.js';

// Mock getFirestore BEFORE importing the repository
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { createFirestoreGitHubPRSummariesRepository } from '../../../infra/firestore/gitHubPRSummariesRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function createUpsertInput(overrides: Partial<UpsertGitHubPRSummaryInput> = {}): UpsertGitHubPRSummaryInput {
  return {
    repository: 'intexuraos/test-repo',
    pullRequestNumber: 42,
    lastActivityAt: new Date('2024-01-10T12:00:00Z'),
    firstSeenAt: new Date('2024-01-10T12:00:00Z'),
    title: 'Test PR',
    state: 'open',
    mergedAt: null,
    baseBranch: 'development',
    authorLogin: 'alice',
    headBranch: 'feature/alice',
    mergeConflictStatus: 'clean',
    lastConflictCheckedAt: new Date('2024-01-10T12:05:00Z'),
    conflictEpisodeStartedAt: null,
    conflictResolvedAt: null,
    managedConflictCommentId: null,
    managedConflictTaskId: null,
    managedConflictTaskOwnerUserId: null,
    ...overrides,
  };
}

function createMockQuerySnapshot(docs: unknown[]): { docs: unknown[] } {
  return { docs };
}

function createMockDocSnapshot(data: unknown): { data: () => unknown } {
  return { data: () => data };
}

describe('createFirestoreGitHubPRSummariesRepository', () => {
  describe('upsert()', () => {
    it('should upsert a summary with title/state/mergedAt', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => mockDocRef),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const input = createUpsertInput();
      const result = await repo.upsert(input);

      expect(result.ok).toBe(true);
      expect(mockDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: 'intexuraos/test-repo',
          pullRequestNumber: 42,
          title: 'Test PR',
          state: 'open',
          mergedAt: null,
          baseBranch: 'development',
          authorLogin: 'alice',
          headBranch: 'feature/alice',
          mergeConflictStatus: 'clean',
        }),
        { merge: true }
      );
    });

    it('should use correct doc ID (repository#pullRequestNumber)', async () => {
      const mockDoc = vi.fn().mockReturnValue({
        set: vi.fn().mockResolvedValue(undefined),
      });

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({ doc: mockDoc })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      await repo.upsert(createUpsertInput());

      expect(mockDoc).toHaveBeenCalledWith('intexuraos__test-repo#42');
    });

    it('should omit title/state/mergedAt when not provided', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => mockDocRef),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      // Input without title/state/mergedAt (e.g., review event)
      const input: UpsertGitHubPRSummaryInput = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        lastActivityAt: new Date('2024-01-10T12:00:00Z'),
        firstSeenAt: new Date('2024-01-10T12:00:00Z'),
      };
      const result = await repo.upsert(input);

      expect(result.ok).toBe(true);
      const calledData = (mockDocRef.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
      expect(calledData).not.toHaveProperty('title');
      expect(calledData).not.toHaveProperty('state');
      expect(calledData).not.toHaveProperty('mergedAt');
    });

    it('should include conflict-tracking fields when explicitly provided', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => mockDocRef),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const input = createUpsertInput({
        mergeConflictStatus: 'conflicting',
        conflictEpisodeStartedAt: new Date('2024-01-10T12:10:00Z'),
        managedConflictCommentId: 12345,
        managedConflictTaskId: 'task_123',
        managedConflictTaskOwnerUserId: 'user-123',
      });

      const result = await repo.upsert(input);

      expect(result.ok).toBe(true);
      expect(mockDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          mergeConflictStatus: 'conflicting',
          managedConflictCommentId: 12345,
          managedConflictTaskId: 'task_123',
          managedConflictTaskOwnerUserId: 'user-123',
        }),
        { merge: true }
      );
    });

    it('should handle Firestore errors', async () => {
      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: vi.fn().mockRejectedValue(new Error('Firestore write failed')),
          })),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.upsert(createUpsertInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(result.error.message).toContain('Firestore write failed');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });

  describe('findRecentlyActive()', () => {
    it('should return summaries active within the last N days', async () => {
      const summaryData = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        title: 'Active PR',
        state: 'open',
        mergedAt: null,
        lastActivityAt: new Date('2024-01-10T12:00:00Z'),
        firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(
          createMockQuerySnapshot([createMockDocSnapshot(summaryData)])
        ),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findRecentlyActive(30);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.repository).toBe('intexuraos/test-repo');
        expect(result.value[0]?.pullRequestNumber).toBe(42);
        expect(result.value[0]?.title).toBe('Active PR');
        expect(result.value[0]?.state).toBe('open');
        expect(result.value[0]?.mergedAt).toBeNull();
        expect(mockQuery.orderBy).toHaveBeenCalledWith('lastActivityAt', 'desc');
      }
    });

    it('should return empty array when no summaries found', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findRecentlyActive(30);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle Firestore Timestamp objects for date fields', async () => {
      const lastActivityDate = new Date('2024-01-10T12:00:00Z');
      const firstSeenDate = new Date('2024-01-01T00:00:00Z');
      const mergedDate = new Date('2024-01-09T00:00:00Z');

      const summaryData = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        title: 'Merged PR',
        state: 'closed',
        mergedAt: { toDate: (): Date => mergedDate },
        lastActivityAt: { toDate: (): Date => lastActivityDate },
        firstSeenAt: { toDate: (): Date => firstSeenDate },
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(
          createMockQuerySnapshot([createMockDocSnapshot(summaryData)])
        ),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findRecentlyActive(30);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const summary = result.value[0];
        expect(summary?.lastActivityAt).toEqual(lastActivityDate);
        expect(summary?.firstSeenAt).toEqual(firstSeenDate);
        expect(summary?.mergedAt).toEqual(mergedDate);
      }
    });

    it('should handle missing optional fields gracefully', async () => {
      const summaryData = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 5,
        lastActivityAt: new Date('2024-01-10T12:00:00Z'),
        firstSeenAt: new Date('2024-01-10T12:00:00Z'),
        // title, state, mergedAt are absent (review-only PR)
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(
          createMockQuerySnapshot([createMockDocSnapshot(summaryData)])
        ),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findRecentlyActive(30);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const summary = result.value[0];
        expect(summary?.title).toBeNull();
        expect(summary?.state).toBeNull();
        expect(summary?.mergedAt).toBeNull();
      }
    });

    it('should handle query errors', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findRecentlyActive(30);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });

  describe('findByPullRequest()', () => {
    it('returns the stored summary when it exists', async () => {
      const summaryData = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        title: 'Active PR',
        state: 'open',
        mergedAt: null,
        baseBranch: 'development',
        authorLogin: 'alice',
        headBranch: 'feature/alice',
        mergeConflictStatus: 'conflicting',
        lastConflictCheckedAt: new Date('2024-01-10T12:05:00Z'),
        conflictEpisodeStartedAt: new Date('2024-01-10T12:10:00Z'),
        conflictResolvedAt: null,
        managedConflictCommentId: 12345,
        managedConflictTaskId: 'task_123',
        managedConflictTaskOwnerUserId: 'user-123',
        lastActivityAt: new Date('2024-01-10T12:00:00Z'),
        firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: (): unknown => summaryData,
            }),
          })),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findByPullRequest('intexuraos/test-repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({
          repository: 'intexuraos/test-repo',
          pullRequestNumber: 42,
          baseBranch: 'development',
          authorLogin: 'alice',
          headBranch: 'feature/alice',
          mergeConflictStatus: 'conflicting',
          managedConflictCommentId: 12345,
          managedConflictTaskId: 'task_123',
          managedConflictTaskOwnerUserId: 'user-123',
        });
      }
    });

    it('returns null when the summary does not exist', async () => {
      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              exists: false,
            }),
          })),
        })),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findByPullRequest('intexuraos/test-repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('findOpenByBaseBranch()', () => {
    it('returns only open summaries for the requested repository and base branch', async () => {
      const summaryData = {
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        title: 'Active PR',
        state: 'open',
        mergedAt: null,
        baseBranch: 'release/2026.03',
        authorLogin: 'alice',
        headBranch: 'feature/alice',
        mergeConflictStatus: 'conflicting',
        lastConflictCheckedAt: new Date('2024-01-10T12:05:00Z'),
        conflictEpisodeStartedAt: new Date('2024-01-10T12:10:00Z'),
        conflictResolvedAt: null,
        managedConflictCommentId: 12345,
        managedConflictTaskId: 'task_123',
        managedConflictTaskOwnerUserId: 'user-123',
        lastActivityAt: new Date('2024-01-10T12:00:00Z'),
        firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(
          createMockQuerySnapshot([createMockDocSnapshot(summaryData)])
        ),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findOpenByBaseBranch('intexuraos/test-repo', 'release/2026.03');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toMatchObject({
          repository: 'intexuraos/test-repo',
          pullRequestNumber: 42,
          state: 'open',
          baseBranch: 'release/2026.03',
        });
      }

      expect(mockQuery.where).toHaveBeenNthCalledWith(1, 'repository', '==', 'intexuraos/test-repo');
      expect(mockQuery.where).toHaveBeenNthCalledWith(2, 'state', '==', 'open');
      expect(mockQuery.where).toHaveBeenNthCalledWith(3, 'baseBranch', '==', 'release/2026.03');
    });

    it('handles Firestore errors', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repo = createFirestoreGitHubPRSummariesRepository({ logger: mockLogger });
      const result = await repo.findOpenByBaseBranch('intexuraos/test-repo', 'release/2026.03');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });
});
