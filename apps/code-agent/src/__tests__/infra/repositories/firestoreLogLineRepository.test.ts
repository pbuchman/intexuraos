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
  });

  describe('deleteAll', () => {
    it('returns ok immediately when no log lines exist', async () => {
      mockLinesCollection.get.mockResolvedValue({ docs: [] });
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

      const result = await repo.deleteAll('task-1');

      expect(result.ok).toBe(true);
      expect(mockFirestore.batch).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { taskId: 'task-1', count: 0 },
        'Deleted all log lines'
      );
    });

    it('deletes all documents in log_lines subcollection', async () => {
      const docRef1 = { id: 'doc-1' };
      const docRef2 = { id: 'doc-2' };
      mockLinesCollection.get.mockResolvedValue({
        docs: [{ ref: docRef1 }, { ref: docRef2 }],
      });
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

      const result = await repo.deleteAll('task-1');

      expect(result.ok).toBe(true);
      expect(mockBatch.delete).toHaveBeenCalledTimes(2);
      expect(mockBatch.delete).toHaveBeenCalledWith(docRef1);
      expect(mockBatch.delete).toHaveBeenCalledWith(docRef2);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('accesses correct subcollection path', async () => {
      mockLinesCollection.get.mockResolvedValue({ docs: [] });
      const repo = createFirestoreLogLineRepository({ firestore: mockFirestore, logger });

      await repo.deleteAll('task-42');

      expect(mockFirestore.collection).toHaveBeenCalledWith('code_tasks');
      expect(mockTasksCollection.doc).toHaveBeenCalledWith('task-42');
      expect(mockTaskDoc.collection).toHaveBeenCalledWith('log_lines');
    });
  });
});
