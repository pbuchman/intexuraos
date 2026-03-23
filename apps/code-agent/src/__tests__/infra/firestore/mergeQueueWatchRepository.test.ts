/**
 * Tests for Firestore merge queue watch repository.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { CreateWatchInput } from '../../../domain/repositories/mergeQueueWatchRepository.js';
import type { AppendMergedPrInput } from '../../../domain/repositories/mergeQueueWatchRepository.js';

// Mock getFirestore BEFORE importing the repository
vi.mock('@intexuraos/infra-firestore', async () => {
  const firestore = await vi.importActual<typeof import('@google-cloud/firestore')>('@google-cloud/firestore');
  return {
    getFirestore: vi.fn(),
    FieldValue: firestore.FieldValue,
  };
});

// Mock crypto.randomUUID for deterministic IDs
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
}));

import { createFirestoreMergeQueueWatchRepository } from '../../../infra/firestore/mergeQueueWatchRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function createWatchInput(
  overrides: Partial<CreateWatchInput> = {}
): CreateWatchInput {
  return {
    userId: 'user_123',
    gitHubUsername: 'testuser',
    owner: 'intexuraos',
    repo: 'test-repo',
    baseBranch: 'main',
    ...overrides,
  };
}

describe('createFirestoreMergeQueueWatchRepository', () => {
  describe('create()', () => {
    it('should create a watch with status active and empty arrays', async () => {
      const mockDocRef = {
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockSnapshot = {
        empty: true,
        docs: [],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const input = createWatchInput();
      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.id).toBe('watch_test-uuid-1234');
        expect(result.value.userId).toBe('user_123');
        expect(result.value.gitHubUsername).toBe('testuser');
        expect(result.value.owner).toBe('intexuraos');
        expect(result.value.repo).toBe('test-repo');
        expect(result.value.baseBranch).toBe('main');
        expect(result.value.status).toBe('active');
        expect(result.value.mergedPrs).toEqual([]);
        expect(result.value.skippedPrs).toEqual([]);
        expect(result.value.lastError).toBeNull();
        expect(result.value.lastErrorAt).toBeNull();
        expect(result.value.lastTickAt).toBeNull();
        expect(result.value.drainedAt).toBeNull();
        expect(result.value.cancelledAt).toBeNull();
      }

      expect(mockCollection.doc).toHaveBeenCalledWith('watch_test-uuid-1234');
      expect(mockDocRef.set).toHaveBeenCalledTimes(1);
    });

    it('should reject duplicate active watch with CONFLICT', async () => {
      const mockSnapshot = {
        empty: false,
        docs: [{ id: 'watch_existing', data: (): Record<string, unknown> => ({}) }],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        doc: vi.fn(),
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.create(createWatchInput());

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('CONFLICT');
        expect(result.error.message).toContain('Active watch already exists');
      }
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      };

      const mockCollection = {
        doc: vi.fn(),
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.create(createWatchInput());

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(result.error.message).toContain('Firestore unavailable');
      }
    });
  });

  describe('findById()', () => {
    it('should return watch by ID', async () => {
      const watchData = {
        userId: 'user_123',
        gitHubUsername: 'testuser',
        owner: 'intexuraos',
        repo: 'test-repo',
        baseBranch: 'main',
        status: 'active',
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      };

      const mockDocRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'watch_abc',
          data: () => watchData,
        }),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findById('watch_abc');

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.id).toBe('watch_abc');
        expect(result.value.userId).toBe('user_123');
        expect(result.value.status).toBe('active');
      }
    });

    it('should return NOT_FOUND for nonexistent watch', async () => {
      const mockDocRef = {
        get: vi.fn().mockResolvedValue({
          exists: false,
          id: 'watch_nonexistent',
        }),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findById('watch_nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('watch_nonexistent');
      }
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockDocRef = {
        get: vi.fn().mockRejectedValue(new Error('Connection lost')),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findById('watch_fail');

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findActiveByUserAndBranch()', () => {
    it('should return active watch when found', async () => {
      const watchData = {
        userId: 'user_123',
        gitHubUsername: 'testuser',
        owner: 'intexuraos',
        repo: 'test-repo',
        baseBranch: 'main',
        status: 'active',
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      };

      const mockSnapshot = {
        empty: false,
        docs: [{ id: 'watch_found', data: (): typeof watchData => watchData }],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findActiveByUserAndBranch('user_123', 'intexuraos', 'test-repo', 'main');

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('watch_found');
        expect(result.value?.status).toBe('active');
      }
    });

    it('should return null when snapshot is non-empty but docs[0] is undefined (corrupt snapshot)', async () => {
      const mockSnapshot = {
        empty: false,
        docs: [] as unknown[],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findActiveByUserAndBranch('user_123', 'intexuraos', 'test-repo', 'main');

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null when no active watch found', async () => {
      const mockSnapshot = {
        empty: true,
        docs: [],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findActiveByUserAndBranch('user_123', 'intexuraos', 'test-repo', 'main');

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toBeNull();
      }
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findActiveByUserAndBranch('user_123', 'intexuraos', 'test-repo', 'main');

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findAllActive()', () => {
    it('should return only active watches', async () => {
      const activeWatch = {
        userId: 'user_123',
        gitHubUsername: 'testuser',
        owner: 'intexuraos',
        repo: 'test-repo',
        baseBranch: 'main',
        status: 'active',
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      };

      const mockSnapshot = {
        docs: [
          { id: 'watch_1', data: (): typeof activeWatch => activeWatch },
          { id: 'watch_2', data: (): typeof activeWatch => ({ ...activeWatch, baseBranch: 'develop' }) },
        ],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findAllActive();

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.id).toBe('watch_1');
        expect(result.value[1]?.id).toBe('watch_2');
      }
    });

    it('should return empty array when no active watches', async () => {
      const mockSnapshot = {
        docs: [],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findAllActive();

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findAllActive();

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findByUserAndRepo()', () => {
    it('should return all watches for user and repo', async () => {
      const watchData = {
        userId: 'user_123',
        gitHubUsername: 'testuser',
        owner: 'intexuraos',
        repo: 'test-repo',
        baseBranch: 'main',
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date(),
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      };

      const mockSnapshot = {
        docs: [
          { id: 'watch_active', data: (): Record<string, unknown> => ({ ...watchData, status: 'active' }) },
          { id: 'watch_drained', data: (): Record<string, unknown> => ({ ...watchData, status: 'drained' }) },
        ],
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockSnapshot),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findByUserAndRepo('user_123', 'intexuraos', 'test-repo');

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.id).toBe('watch_active');
        expect(result.value[1]?.id).toBe('watch_drained');
      }
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      const mockCollection = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.findByUserAndRepo('user_123', 'intexuraos', 'test-repo');

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('update()', () => {
    it('should update status, lastTickAt, and skippedPrs', async () => {
      const mockDocRef = {
        update: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const now = new Date();
      const result = await repo.update('watch_abc', {
        status: 'drained',
        lastTickAt: now,
        skippedPrs: [{ prNumber: 5, reason: 'merge_conflict' }],
      });

      expect(result.ok).toBe(true);
      expect(mockDocRef.update).toHaveBeenCalledWith({
        status: 'drained',
        lastTickAt: now,
        skippedPrs: [{ prNumber: 5, reason: 'merge_conflict' }],
      });
    });

    it('should only update provided fields', async () => {
      const mockDocRef = {
        update: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.update('watch_abc', {
        status: 'cancelled',
      });

      expect(result.ok).toBe(true);
      expect(mockDocRef.update).toHaveBeenCalledWith({
        status: 'cancelled',
      });
    });

    it('should write null values when explicitly provided', async () => {
      const mockDocRef = {
        update: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.update('watch_abc', {
        lastError: null,
        lastErrorAt: null,
        drainedAt: null,
        cancelledAt: null,
      });

      expect(result.ok).toBe(true);
      expect(mockDocRef.update).toHaveBeenCalledWith({
        lastError: null,
        lastErrorAt: null,
        drainedAt: null,
        cancelledAt: null,
      });
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockDocRef = {
        update: vi.fn().mockRejectedValue(new Error('Update failed')),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.update('watch_abc', { status: 'cancelled' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('appendMergedPr()', () => {
    it('should append to mergedPrs array using FieldValue.arrayUnion', async () => {
      const mockDocRef = {
        update: vi.fn().mockResolvedValue(undefined),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const mergedPr: AppendMergedPrInput = {
        prNumber: 42,
        title: 'Fix bug',
        author: 'testuser',
      };

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.appendMergedPr('watch_abc', mergedPr);

      expect(result.ok).toBe(true);
      expect(mockCollection.doc).toHaveBeenCalledWith('watch_abc');
      expect(mockDocRef.update).toHaveBeenCalledTimes(1);

      const updateArg = mockDocRef.update.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(updateArg['mergedPrs']).toBeDefined();
    });

    it('should return FIRESTORE_ERROR on failure', async () => {
      const mockDocRef = {
        update: vi.fn().mockRejectedValue(new Error('Append failed')),
      };

      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn().mockReturnValue(mockCollection),
      } as never);

      const mergedPr: AppendMergedPrInput = {
        prNumber: 42,
        title: 'Fix bug',
        author: 'testuser',
      };

      const repo = createFirestoreMergeQueueWatchRepository({ logger: mockLogger });
      const result = await repo.appendMergedPr('watch_abc', mergedPr);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });
});
