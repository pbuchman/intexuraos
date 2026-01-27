import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface MockTaskDoc {
  id: string;
  ref: {
    update: Mock;
    collection: Mock;
  };
  data: () => { completedAt: { toDate: () => Date }; logsArchived: boolean };
}

interface MockLogDoc {
  ref: { path: string };
}

const firestoreMocks = vi.hoisted(() => {
  const mockBatchDelete = vi.fn();
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

  const mockBatch = vi.fn().mockReturnValue({
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  });

  const mockGet = vi.fn();
  const mockLimit = vi.fn().mockReturnValue({ get: mockGet });
  const mockWhere = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: mockLimit,
    }),
  });
  const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });

  const mockFirestore = {
    collection: mockCollection,
    batch: mockBatch,
  };

  return {
    mockFirestore,
    mockCollection,
    mockWhere,
    mockLimit,
    mockGet,
    mockBatch,
    mockBatchDelete,
    mockBatchCommit,
  };
});

vi.mock('firebase-admin', () => {
  return {
    default: {
      apps: [],
      initializeApp: vi.fn(),
      firestore: Object.assign(() => firestoreMocks.mockFirestore, {
        FieldValue: {
          serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
        },
        Timestamp: {
          fromDate: vi.fn((date: Date): { toDate: () => Date } => ({ toDate: (): Date => date })),
          now: vi.fn((): { toDate: () => Date } => ({ toDate: (): Date => new Date() })),
        },
      }),
    },
  };
});

import { cleanupOldLogs } from '../cleanup.js';

describe('cleanupOldLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.mockBatch.mockReturnValue({
      delete: firestoreMocks.mockBatchDelete,
      commit: firestoreMocks.mockBatchCommit,
    });
    firestoreMocks.mockBatchCommit.mockResolvedValue(undefined);
  });

  it('should return early if no tasks need cleanup', async () => {
    firestoreMocks.mockGet.mockResolvedValue({
      empty: true,
      docs: [],
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(0);
    expect(result.logsDeleted).toBe(0);
    expect(result.message).toContain('No tasks');
  });

  it('should process tasks with old logs and archive them', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockLogsGet = vi.fn().mockResolvedValue({
      docs: [
        { ref: { path: 'logs/1' } },
        { ref: { path: 'logs/2' } },
        { ref: { path: 'logs/3' } },
      ] as MockLogDoc[],
    });

    const mockTaskDoc: MockTaskDoc = {
      id: 'task-123',
      ref: {
        update: mockUpdate,
        collection: vi.fn().mockReturnValue({ get: mockLogsGet }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    let queryCallCount = 0;
    firestoreMocks.mockGet.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [mockTaskDoc],
        });
      }
      return Promise.resolve({
        empty: true,
        docs: [],
      });
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.logsDeleted).toBe(3);
    expect(firestoreMocks.mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(firestoreMocks.mockBatchCommit).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        logsArchived: true,
      })
    );
  });

  it('should handle batch size limits correctly', async () => {
    const logsArray: MockLogDoc[] = Array.from({ length: 600 }, (_, i) => ({
      ref: { path: `logs/${String(i)}` },
    }));

    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockLogsGet = vi.fn().mockResolvedValue({ docs: logsArray });

    const mockTaskDoc: MockTaskDoc = {
      id: 'task-456',
      ref: {
        update: mockUpdate,
        collection: vi.fn().mockReturnValue({ get: mockLogsGet }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    let queryCallCount = 0;
    firestoreMocks.mockGet.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [mockTaskDoc],
        });
      }
      return Promise.resolve({
        empty: true,
        docs: [],
      });
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.logsDeleted).toBe(600);
    expect(firestoreMocks.mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  it('should continue processing even if one task fails', async () => {
    const mockTaskDoc1: MockTaskDoc = {
      id: 'task-fail',
      ref: {
        update: vi.fn().mockRejectedValue(new Error('Update failed')),
        collection: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [{ ref: { path: 'logs/1' } }] as MockLogDoc[],
          }),
        }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    const mockTaskDoc2: MockTaskDoc = {
      id: 'task-success',
      ref: {
        update: vi.fn().mockResolvedValue(undefined),
        collection: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [{ ref: { path: 'logs/2' } }] as MockLogDoc[],
          }),
        }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    let queryCallCount = 0;
    firestoreMocks.mockGet.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [mockTaskDoc1, mockTaskDoc2],
        });
      }
      return Promise.resolve({
        empty: true,
        docs: [],
      });
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksFailed).toBe(1);
  });

  it('should return error result if Firestore query fails', async () => {
    firestoreMocks.mockGet.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await cleanupOldLogs();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Firestore unavailable');
  });

  it('should handle task with no logs', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockLogsGet = vi.fn().mockResolvedValue({
      docs: [],
    });

    const mockTaskDoc: MockTaskDoc = {
      id: 'task-no-logs',
      ref: {
        update: mockUpdate,
        collection: vi.fn().mockReturnValue({ get: mockLogsGet }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    let queryCallCount = 0;
    firestoreMocks.mockGet.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [mockTaskDoc],
        });
      }
      return Promise.resolve({
        empty: true,
        docs: [],
      });
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.logsDeleted).toBe(0);
    expect(firestoreMocks.mockBatchCommit).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        logsArchived: true,
        logCount: 0,
      })
    );
  });

  it('should handle non-Error exceptions in task processing', async () => {
    const mockTaskDoc: MockTaskDoc = {
      id: 'task-string-error',
      ref: {
        update: vi.fn().mockRejectedValue('String error message'),
        collection: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [{ ref: { path: 'logs/1' } }] as MockLogDoc[],
          }),
        }),
      },
      data: () => ({
        completedAt: { toDate: () => new Date('2024-01-01') },
        logsArchived: false,
      }),
    };

    let queryCallCount = 0;
    firestoreMocks.mockGet.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [mockTaskDoc],
        });
      }
      return Promise.resolve({
        empty: true,
        docs: [],
      });
    });

    const result = await cleanupOldLogs();

    expect(result.success).toBe(true);
    expect(result.tasksFailed).toBe(1);
  });

  it('should handle non-Error exceptions at top level', async () => {
    firestoreMocks.mockGet.mockRejectedValue('Non-error rejection');

    const result = await cleanupOldLogs();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Non-error rejection');
  });
});
