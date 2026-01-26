/**
 * Tests for FirestoreLogChunkRepository
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { Firestore } from '@intexuraos/infra-firestore';
import {
  createFirestoreLogChunkRepository,
  FirestoreLogChunkRepository,
} from '../../../infra/repositories/firestoreLogChunkRepository.js';
import type { LogChunk } from '../../../domain/models/logChunk.js';

describe('FirestoreLogChunkRepository', () => {
  let mockFirestore: {
    batch: ReturnType<typeof vi.fn>;
    collection: ReturnType<typeof vi.fn>;
  };
  let mockBatch: {
    set: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  let mockDocRef: { id: string };
  let mockLogsCollection: { doc: ReturnType<typeof vi.fn> };
  let mockTaskDoc: { collection: ReturnType<typeof vi.fn> };
  let mockTasksCollection: { doc: ReturnType<typeof vi.fn> };
  let logger: Logger;

  const createLogChunk = (overrides: Partial<LogChunk> = {}): LogChunk => ({
    id: 'chunk-1',
    sequence: 1,
    content: 'test log content',
    timestamp: Timestamp.now(),
    size: 16,
    ...overrides,
  });

  beforeEach(() => {
    mockDocRef = { id: 'auto-1' };

    mockLogsCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
    };

    mockTaskDoc = {
      collection: vi.fn().mockReturnValue(mockLogsCollection),
    };

    mockTasksCollection = {
      doc: vi.fn().mockReturnValue(mockTaskDoc),
    };

    mockBatch = {
      set: vi.fn().mockReturnThis(),
      commit: vi.fn().mockResolvedValue([]),
    };

    mockFirestore = {
      batch: vi.fn().mockReturnValue(mockBatch),
      collection: vi.fn().mockReturnValue(mockTasksCollection),
    };

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createFirestoreLogChunkRepository (factory)', () => {
    it('creates repository instance with storeBatch method', () => {
      const repo = createFirestoreLogChunkRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      expect(repo).toBeDefined();
      expect(repo.storeBatch).toBeInstanceOf(Function);
    });

    it('returns instance of FirestoreLogChunkRepository', () => {
      const repo = createFirestoreLogChunkRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      expect(repo).toBeInstanceOf(FirestoreLogChunkRepository);
    });
  });

  describe('storeBatch', () => {
    describe('with empty array', () => {
      it('returns ok immediately without calling Firestore', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.storeBatch('task-123', []);

        expect(result.ok).toBe(true);
        expect(mockFirestore.batch).not.toHaveBeenCalled();
        expect(mockFirestore.collection).not.toHaveBeenCalled();
      });

      it('does not log anything for empty batch', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        await repo.storeBatch('task-123', []);

        expect(logger.debug).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });

    describe('with single chunk', () => {
      it('stores chunk in correct subcollection path', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunk = createLogChunk();
        await repo.storeBatch('task-123', [chunk]);

        expect(mockFirestore.collection).toHaveBeenCalledWith('code_tasks');
        expect(mockTasksCollection.doc).toHaveBeenCalledWith('task-123');
        expect(mockTaskDoc.collection).toHaveBeenCalledWith('logs');
        expect(mockLogsCollection.doc).toHaveBeenCalledWith();
      });

      it('creates batch and commits', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunk = createLogChunk();
        await repo.storeBatch('task-123', [chunk]);

        expect(mockFirestore.batch).toHaveBeenCalledTimes(1);
        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      });

      it('sets correct data structure on document', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const timestamp = Timestamp.now();
        const chunk = createLogChunk({
          sequence: 5,
          content: 'hello world',
          timestamp,
          size: 11,
        });

        await repo.storeBatch('task-123', [chunk]);

        expect(mockBatch.set).toHaveBeenCalledWith(mockDocRef, {
          sequence: 5,
          content: 'hello world',
          timestamp,
          size: 11,
        });
      });

      it('returns ok on success', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.storeBatch('task-123', [createLogChunk()]);

        expect(result.ok).toBe(true);
      });

      it('logs debug message on success', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        await repo.storeBatch('task-123', [createLogChunk()]);

        expect(logger.debug).toHaveBeenCalledWith(
          { taskId: 'task-123', count: 1 },
          'Stored log chunks'
        );
      });
    });

    describe('with multiple chunks', () => {
      it('creates document reference for each chunk', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunks = [
          createLogChunk({ sequence: 1, content: 'first' }),
          createLogChunk({ sequence: 2, content: 'second' }),
          createLogChunk({ sequence: 3, content: 'third' }),
        ];

        await repo.storeBatch('task-456', chunks);

        expect(mockLogsCollection.doc).toHaveBeenCalledTimes(3);
      });

      it('sets each chunk with correct data', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const timestamp1 = Timestamp.now();
        const timestamp2 = Timestamp.now();
        const chunks = [
          createLogChunk({ sequence: 1, content: 'first', timestamp: timestamp1, size: 5 }),
          createLogChunk({ sequence: 2, content: 'second', timestamp: timestamp2, size: 6 }),
        ];

        await repo.storeBatch('task-456', chunks);

        expect(mockBatch.set).toHaveBeenCalledTimes(2);
        expect(mockBatch.set).toHaveBeenNthCalledWith(1, mockDocRef, {
          sequence: 1,
          content: 'first',
          timestamp: timestamp1,
          size: 5,
        });
        expect(mockBatch.set).toHaveBeenNthCalledWith(2, mockDocRef, {
          sequence: 2,
          content: 'second',
          timestamp: timestamp2,
          size: 6,
        });
      });

      it('commits batch only once', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunks = [
          createLogChunk({ sequence: 1 }),
          createLogChunk({ sequence: 2 }),
          createLogChunk({ sequence: 3 }),
        ];

        await repo.storeBatch('task-789', chunks);

        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      });

      it('logs correct count in debug message', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunks = [
          createLogChunk({ sequence: 1 }),
          createLogChunk({ sequence: 2 }),
          createLogChunk({ sequence: 3 }),
          createLogChunk({ sequence: 4 }),
          createLogChunk({ sequence: 5 }),
        ];

        await repo.storeBatch('task-multi', chunks);

        expect(logger.debug).toHaveBeenCalledWith(
          { taskId: 'task-multi', count: 5 },
          'Stored log chunks'
        );
      });
    });

    describe('error handling', () => {
      it('returns FIRESTORE_ERROR when commit fails', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Connection timeout'));

        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.storeBatch('task-err', [createLogChunk()]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FIRESTORE_ERROR');
          expect(result.error.message).toBe('Connection timeout');
        }
      });

      it('logs error with taskId and message', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Write quota exceeded'));

        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        await repo.storeBatch('task-quota', [createLogChunk()]);

        expect(logger.error).toHaveBeenCalledWith(
          { taskId: 'task-quota', error: 'Write quota exceeded' },
          'Failed to store log chunks'
        );
      });

      it('handles non-Error thrown values with fallback message', async () => {
        mockBatch.commit.mockRejectedValue('string error');

        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.storeBatch('task-str', [createLogChunk()]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FIRESTORE_ERROR');
          expect(result.error.message).toBe('Unknown error');
        }
      });

      it('handles undefined thrown values', async () => {
        mockBatch.commit.mockRejectedValue(undefined);

        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.storeBatch('task-undef', [createLogChunk()]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FIRESTORE_ERROR');
        }
      });

      it('does not log debug message on failure', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Failed'));

        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        await repo.storeBatch('task-fail', [createLogChunk()]);

        expect(logger.debug).not.toHaveBeenCalled();
      });
    });

    describe('data integrity', () => {
      it('does not include chunk id in stored data', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunk = createLogChunk({ id: 'should-not-be-stored' });
        await repo.storeBatch('task-123', [chunk]);

        const setCall = mockBatch.set.mock.calls[0];
        const storedData = setCall?.[1] as Record<string, unknown>;
        expect(storedData).not.toHaveProperty('id');
      });

      it('preserves Timestamp objects', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const specificTimestamp = Timestamp.fromDate(new Date('2025-01-15T10:30:00Z'));
        const chunk = createLogChunk({ timestamp: specificTimestamp });

        await repo.storeBatch('task-123', [chunk]);

        const setCall = mockBatch.set.mock.calls[0];
        const storedData = setCall?.[1] as Record<string, unknown>;
        expect(storedData['timestamp']).toBe(specificTimestamp);
      });

      it('handles chunks with special characters in content', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const specialContent = '\x1b[32mGreen text\x1b[0m with unicode: 日本語 🎉';
        const chunk = createLogChunk({ content: specialContent, size: Buffer.byteLength(specialContent) });

        await repo.storeBatch('task-special', [chunk]);

        const setCall = mockBatch.set.mock.calls[0];
        const storedData = setCall?.[1] as Record<string, unknown>;
        expect(storedData['content']).toBe(specialContent);
      });

      it('handles large sequence numbers', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunk = createLogChunk({ sequence: 999999999 });
        await repo.storeBatch('task-large-seq', [chunk]);

        const setCall = mockBatch.set.mock.calls[0];
        const storedData = setCall?.[1] as Record<string, unknown>;
        expect(storedData['sequence']).toBe(999999999);
      });

      it('handles zero size chunks', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const chunk = createLogChunk({ content: '', size: 0 });
        await repo.storeBatch('task-empty-content', [chunk]);

        const setCall = mockBatch.set.mock.calls[0];
        const storedData = setCall?.[1] as Record<string, unknown>;
        expect(storedData['content']).toBe('');
        expect(storedData['size']).toBe(0);
      });
    });

    describe('different task IDs', () => {
      it('uses correct taskId in collection path', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        await repo.storeBatch('unique-task-id-abc123', [createLogChunk()]);

        expect(mockTasksCollection.doc).toHaveBeenCalledWith('unique-task-id-abc123');
      });

      it('handles task IDs with special characters', async () => {
        const repo = createFirestoreLogChunkRepository({
          firestore: mockFirestore as unknown as Firestore,
          logger,
        });

        const taskId = 'task_with-special.chars';
        await repo.storeBatch(taskId, [createLogChunk()]);

        expect(mockTasksCollection.doc).toHaveBeenCalledWith(taskId);
        expect(logger.debug).toHaveBeenCalledWith(
          { taskId, count: 1 },
          'Stored log chunks'
        );
      });
    });
  });
});
