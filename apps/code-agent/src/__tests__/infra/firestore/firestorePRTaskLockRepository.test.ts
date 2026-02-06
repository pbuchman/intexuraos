import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { createFirestorePRTaskLockRepository } from '../../../infra/firestore/firestorePRTaskLockRepository.js';

describe('createFirestorePRTaskLockRepository', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockTransaction = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  const mockDocRef = {
    get: vi.fn(),
    delete: vi.fn(),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDocRef),
  };

  const mockFirestore = {
    collection: vi.fn(() => mockCollection),
    runTransaction: vi.fn((fn) => fn(mockTransaction)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFirestore.collection.mockReturnValue(mockCollection);
    mockCollection.doc.mockReturnValue(mockDocRef);
    mockFirestore.runTransaction.mockImplementation((fn) => fn(mockTransaction));
  });

  describe('acquireLock', () => {
    it('should acquire a new lock successfully when none exists', async () => {
      const lockKey = 'repo:123';
      const taskId = 'task-1';
      const userId = 'user-1';

      mockTransaction.get.mockResolvedValue({
        exists: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.acquireLock(lockKey, taskId, userId);

      expect(mockFirestore.collection).toHaveBeenCalledWith('pr_task_locks');
      expect(mockCollection.doc).toHaveBeenCalledWith(lockKey);
      expect(mockTransaction.set).toHaveBeenCalled();

      if (result.ok === true) {
        expect(result.value.activeTaskId).toBe(taskId);
        expect(result.value.lockedBy).toBe(userId);
      } else {
        throw new Error('Expected result to be ok');
      }
    });

    it('should overwrite an expired lock', async () => {
      const lockKey = 'repo:123';
      const taskId = 'task-new';
      const userId = 'user-1';
      const pastTime = Timestamp.fromMillis(Date.now() - 100000);

      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({
          expiresAt: pastTime,
          activeTaskId: 'task-old',
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.acquireLock(lockKey, taskId, userId);

      if (result.ok === true) {
        expect(result.value.activeTaskId).toBe(taskId);
        expect(mockTransaction.set).toHaveBeenCalled();
      } else {
        throw new Error('Expected result to be ok');
      }
    });

    it('should return LOCK_HELD error if lock is active', async () => {
      const lockKey = 'repo:123';
      const taskId = 'task-new';
      const userId = 'user-1';
      const futureTime = Timestamp.fromMillis(Date.now() + 100000);

      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({
          expiresAt: futureTime,
          activeTaskId: 'task-old',
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.acquireLock(lockKey, taskId, userId);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('LOCK_HELD');
        if (result.error.code === 'LOCK_HELD') {
          expect(result.error.lockedByTaskId).toBe('task-old');
        }
      }
    });

    it('should return FIRESTORE_ERROR on transaction failure', async () => {
      const lockKey = 'repo:123';
      const dbError = new Error('Transaction failed');

      mockFirestore.runTransaction.mockRejectedValue(dbError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.acquireLock(lockKey, 'task-1', 'user-1');

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(result.error.message).toContain('Transaction failed');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('releaseLock', () => {
    it('should release a lock successfully', async () => {
      const lockKey = 'repo:123';
      mockDocRef.delete.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.releaseLock(lockKey);

      expect(result.ok).toBe(true);
      expect(mockDocRef.delete).toHaveBeenCalled();
    });

    it('should return FIRESTORE_ERROR on delete failure', async () => {
      const lockKey = 'repo:123';
      const dbError = new Error('Delete failed');
      mockDocRef.delete.mockRejectedValue(dbError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.releaseLock(lockKey);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('findLock', () => {
    it('should return null when lock does not exist', async () => {
      const lockKey = 'repo:123';
      mockDocRef.get.mockResolvedValue({
        exists: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.findLock(lockKey);

      if (result.ok === true) {
        expect(result.value).toBe(null);
      } else {
        throw new Error('Expected result to be ok');
      }
    });

    it('should return lock data when it exists', async () => {
      const lockKey = 'repo:123';
      const now = Timestamp.now();
      const lockData = {
        id: lockKey,
        activeTaskId: 'task-1',
        lockedAt: now,
        lockedBy: 'user-1',
        expiresAt: now,
      };

      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => lockData,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.findLock(lockKey);

      if (result.ok === true) {
        expect(result.value).not.toBe(null);
        expect(result.value?.activeTaskId).toBe('task-1');
      } else {
        throw new Error('Expected result to be ok');
      }
    });

    it('should return FIRESTORE_ERROR on get failure', async () => {
      const lockKey = 'repo:123';
      const dbError = new Error('Get failed');
      mockDocRef.get.mockRejectedValue(dbError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = createFirestorePRTaskLockRepository({ firestore: mockFirestore as any, logger: mockLogger });
      const result = await repo.findLock(lockKey);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
