import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { Firestore } from '@intexuraos/infra-firestore';
import {
  createFirestoreLogEntryRepository,
  FirestoreLogEntryRepository,
} from '../../../infra/repositories/firestoreLogEntryRepository.js';
import type { LogEntry } from '../../../domain/models/logEntry.js';

describe('FirestoreLogEntryRepository', () => {
  let mockFirestore: {
    batch: ReturnType<typeof vi.fn>;
    collection: ReturnType<typeof vi.fn>;
  };
  let mockBatch: {
    set: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  let mockDocRef: { id: string };
  let mockEntriesCollection: { doc: ReturnType<typeof vi.fn> };
  let mockTaskDoc: { collection: ReturnType<typeof vi.fn> };
  let mockTasksCollection: { doc: ReturnType<typeof vi.fn> };
  let logger: Logger;

  const createEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
    sequence: 0,
    type: 'raw',
    timestamp: Timestamp.now(),
    rawText: 'test',
    ...overrides,
  });

  beforeEach(() => {
    mockDocRef = { id: 'auto-1' };

    mockEntriesCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
    };

    mockTaskDoc = {
      collection: vi.fn().mockReturnValue(mockEntriesCollection),
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

  describe('createFirestoreLogEntryRepository (factory)', () => {
    it('creates repository instance', () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      expect(repo).toBeInstanceOf(FirestoreLogEntryRepository);
      expect(repo.storeBatch).toBeInstanceOf(Function);
    });
  });

  describe('storeBatch', () => {
    it('returns ok immediately for empty array', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.storeBatch('task-123', []);

      expect(result.ok).toBe(true);
      expect(mockFirestore.batch).not.toHaveBeenCalled();
    });

    it('stores entries in correct subcollection path', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      await repo.storeBatch('task-123', [createEntry()]);

      expect(mockFirestore.collection).toHaveBeenCalledWith('code_tasks');
      expect(mockTasksCollection.doc).toHaveBeenCalledWith('task-123');
      expect(mockTaskDoc.collection).toHaveBeenCalledWith('log_entries');
      expect(mockEntriesCollection.doc).toHaveBeenCalledWith();
    });

    it('stores base fields for raw entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({ rawText: 'hello' });
      await repo.storeBatch('task-123', [entry]);

      expect(mockBatch.set).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          sequence: 0,
          type: 'raw',
          rawText: 'hello',
        })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('stores all optional fields for system entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({
        type: 'system',
        systemSubtype: 'hook_response',
        hookName: 'validate-lint',
        hookExitCode: 0,
        hookOutput: 'OK',
        model: 'claude-opus-4-6',
        toolCount: 5,
        mcpServers: [{ name: 'linear', status: 'connected' }],
      });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['systemSubtype']).toBe('hook_response');
      expect(storedDoc['hookName']).toBe('validate-lint');
      expect(storedDoc['hookExitCode']).toBe(0);
      expect(storedDoc['hookOutput']).toBe('OK');
      expect(storedDoc['model']).toBe('claude-opus-4-6');
      expect(storedDoc['toolCount']).toBe(5);
      expect(storedDoc['mcpServers']).toEqual([{ name: 'linear', status: 'connected' }]);
    });

    it('stores all optional fields for assistant_text entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({ type: 'assistant_text', text: 'Hello world' });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['text']).toBe('Hello world');
    });

    it('stores all optional fields for tool_call entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({
        type: 'tool_call',
        toolName: 'Bash',
        toolContext: 'git status',
      });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['toolName']).toBe('Bash');
      expect(storedDoc['toolContext']).toBe('git status');
    });

    it('stores all optional fields for tool_result entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({
        type: 'tool_result',
        content: 'file contents',
        isError: true,
      });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['content']).toBe('file contents');
      expect(storedDoc['isError']).toBe(true);
    });

    it('stores all optional fields for result entry', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({
        type: 'result',
        resultType: 'success',
        durationMs: 5000,
        numTurns: 3,
        totalCostUsd: 0.245,
      });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['resultType']).toBe('success');
      expect(storedDoc['durationMs']).toBe(5000);
      expect(storedDoc['numTurns']).toBe(3);
      expect(storedDoc['totalCostUsd']).toBe(0.245);
      expect(storedDoc['errorMessage']).toBeUndefined();
    });

    it('stores error result fields', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({
        type: 'result',
        resultType: 'error',
        errorMessage: 'Context limit exceeded',
      });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(storedDoc['resultType']).toBe('error');
      expect(storedDoc['errorMessage']).toBe('Context limit exceeded');
    });

    it('omits undefined optional fields from stored document', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entry = createEntry({ type: 'raw', rawText: 'test' });
      await repo.storeBatch('task-123', [entry]);

      const storedDoc = mockBatch.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(Object.keys(storedDoc)).toEqual(
        expect.arrayContaining(['sequence', 'type', 'timestamp', 'rawText'])
      );
      expect(storedDoc['systemSubtype']).toBeUndefined();
      expect(storedDoc['hookName']).toBeUndefined();
      expect(storedDoc['toolName']).toBeUndefined();
      expect(storedDoc['content']).toBeUndefined();
    });

    it('stores multiple entries in single batch', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      const entries = [
        createEntry({ sequence: 0, type: 'raw', rawText: 'start' }),
        createEntry({ sequence: 1, type: 'assistant_text', text: 'hi' }),
        createEntry({ sequence: 2, type: 'tool_call', toolName: 'Read' }),
      ];
      const result = await repo.storeBatch('task-123', entries);

      expect(result.ok).toBe(true);
      expect(mockBatch.set).toHaveBeenCalledTimes(3);
      expect(mockBatch.commit).toHaveBeenCalledOnce();
    });

    it('logs debug on successful store', async () => {
      const repo = createFirestoreLogEntryRepository({
        firestore: mockFirestore as unknown as Firestore,
        logger,
      });

      await repo.storeBatch('task-123', [createEntry()]);

      expect(logger.debug).toHaveBeenCalledWith(
        { taskId: 'task-123', count: 1 },
        'Stored log entries'
      );
    });
  });
});
