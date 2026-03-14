import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { Firestore } from '@intexuraos/infra-firestore';
import {
  createFirestoreLogLineRepository,
  FirestoreLogLineRepository,
} from '../../../infra/repositories/firestoreLogLineRepository.js';
import type { FormattedLogLine } from '../../../domain/models/logLine.js';

describe('firestoreLogLineRepository', () => {
  let mockFirestore: Firestore;
  let mockBatch: { set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> };
  let mockDocRef: { id: string; ref?: unknown };
  let mockLinesCollection: { doc: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let mockTaskDoc: { collection: ReturnType<typeof vi.fn> };
  let mockTasksCollection: { doc: ReturnType<typeof vi.fn> };
  let logger: Logger;

  const createLine = (overrides: Partial<FormattedLogLine> = {}): FormattedLogLine => ({
    sequence: 0,
    text: 'test line',
    timestamp: Timestamp.now(),
    ...overrides,
  });

  beforeEach(() => {
    mockBatch = {
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };

    mockDocRef = { id: 'auto-1' };

    mockLinesCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };

    mockTaskDoc = {
      collection: vi.fn().mockReturnValue(mockLinesCollection),
    };

    mockTasksCollection = {
      doc: vi.fn().mockReturnValue(mockTaskDoc),
    };

    mockFirestore = {
      batch: vi.fn().mockReturnValue(mockBatch),
      collection: vi.fn().mockReturnValue(mockTasksCollection),
    } as unknown as Firestore;

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

  describe('createFirestoreLogLineRepository (factory)', () => {
    it('creates repository instance', () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

      expect(repo).toBeInstanceOf(FirestoreLogLineRepository);
      expect(repo.storeBatch).toBeTypeOf('function');
    });
  });

  describe('storeBatch', () => {
    it('returns ok immediately for empty array', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

      const result = await repo.storeBatch('task-1', []);

      expect(result.ok).toBe(true);
      expect(mockFirestore.batch).not.toHaveBeenCalled();
    });

    it('stores lines in correct subcollection path with sequence-based doc ID', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const line = createLine({ sequence: 5 });

      await repo.storeBatch('task-1', [line]);

      expect(mockFirestore.collection).toHaveBeenCalledWith('code_tasks');
      expect(mockTasksCollection.doc).toHaveBeenCalledWith('task-1');
      expect(mockTaskDoc.collection).toHaveBeenCalledWith('log_lines');
      expect(mockLinesCollection.doc).toHaveBeenCalledWith('0000000000000005');
    });

    it('stores correct fields', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const timestamp = Timestamp.now();
      const line = createLine({ sequence: 5, text: 'log message', timestamp });

      await repo.storeBatch('task-1', [line]);

      expect(mockBatch.set).toHaveBeenCalledWith(mockDocRef, {
        sequence: 5,
        text: 'log message',
        timestamp,
      });
    });

    it('stores multiple lines in single batch', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const lines = [createLine({ sequence: 1 }), createLine({ sequence: 2 })];

      await repo.storeBatch('task-1', lines);

      expect(mockBatch.set).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('logs debug on successful store', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const lines = [createLine(), createLine()];

      await repo.storeBatch('task-1', lines);

      expect(logger.debug).toHaveBeenCalledWith(
        { taskId: 'task-1', count: 2 },
        'Stored formatted log lines'
      );
    });

    it('splits large arrays into batches of 500', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const lines = Array.from({ length: 1000 }, (_, i) => createLine({ sequence: i }));

      await repo.storeBatch('task-1', lines);

      expect(mockBatch.commit).toHaveBeenCalledTimes(2);
      expect(mockBatch.set).toHaveBeenCalledTimes(1000);
    });

    it('handles arrays that exactly equal batch size', async () => {
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });
      const lines = Array.from({ length: 500 }, (_, i) => createLine({ sequence: i }));

      await repo.storeBatch('task-1', lines);

      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      expect(mockBatch.set).toHaveBeenCalledTimes(500);
    });

    describe('error handling', () => {
      it('returns FIRESTORE_ERROR when commit fails', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Connection timeout'));

        const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

        const result = await repo.storeBatch('task-err', [createLine()]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FIRESTORE_ERROR');
          expect(result.error.message).toBe('Connection timeout');
        }
      });

      it('logs error with taskId and message', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Write quota exceeded'));

        const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

        await repo.storeBatch('task-quota', [createLine()]);

        expect(logger.error).toHaveBeenCalledWith(
          { taskId: 'task-quota', error: 'Write quota exceeded' },
          'Failed to store log lines'
        );
      });

      it('handles non-Error thrown values with fallback message', async () => {
        mockBatch.commit.mockRejectedValue('string error');

        const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

        const result = await repo.storeBatch('task-str', [createLine()]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FIRESTORE_ERROR');
          expect(result.error.message).toBe('string error');
        }
      });

      it('does not log debug message on failure', async () => {
        mockBatch.commit.mockRejectedValue(new Error('Failed'));

        const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

        await repo.storeBatch('task-fail', [createLine()]);

        expect(logger.debug).not.toHaveBeenCalled();
      });
    });
  });

});
