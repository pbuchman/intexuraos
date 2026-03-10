/**
 * Tests for useCodeTaskLogs hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodeTaskLogs } from '../useCodeTaskLogs.js';
import type { CodeTask } from '../../types/index.js';

const mockGetAccessToken = vi.fn();
const mockUser = { sub: 'user-123' };
const mockGetCodeTask = vi.fn();
const mockInitializeFirebase = vi.fn();
const mockAuthenticateFirebase = vi.fn();
const mockIsFirebaseAuthenticated = vi.fn();
const mockGetFirestoreClient = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockQuery = vi.fn();
const mockOrderBy = vi.fn();
const mockGetDocs = vi.fn();
const mockOnSnapshot = vi.fn();

interface TaskSnapshotValue {
  exists: () => boolean;
  data: () => Record<string, unknown>;
}

interface LogDocData {
  sequence: number;
  text: string;
}

interface LogDoc {
  data: () => LogDocData;
}

interface LogDocChange {
  type: 'added' | 'modified';
  doc: LogDoc;
}

interface LogSnapshotValue {
  docs: LogDoc[];
  docChanges: () => LogDocChange[];
}

vi.mock('../../context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: typeof mockUser;
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: true,
    user: mockUser,
  }),
}));

vi.mock('../../services/codeAgentApi.js', () => ({
  getCodeTask: (...args: unknown[]): unknown => mockGetCodeTask(...args),
}));

vi.mock('../../services/firebase.js', () => ({
  getFirestoreClient: (): unknown => mockGetFirestoreClient(),
  authenticateFirebase: (...args: unknown[]): unknown => mockAuthenticateFirebase(...args),
  isFirebaseAuthenticated: (): boolean => mockIsFirebaseAuthenticated(),
  initializeFirebase: (): void => {
    mockInitializeFirebase();
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]): unknown => mockCollection(...args),
  doc: (...args: unknown[]): unknown => mockDoc(...args),
  getDocs: (...args: unknown[]): unknown => mockGetDocs(...args),
  onSnapshot: (...args: unknown[]): unknown => mockOnSnapshot(...args),
  orderBy: (...args: unknown[]): unknown => mockOrderBy(...args),
  query: (...args: unknown[]): unknown => mockQuery(...args),
}));

function createTask(overrides?: Partial<CodeTask>): CodeTask {
  return {
    id: 'task-123',
    userId: 'user-123',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-123',
    workerType: 'auto',
    workerLocation: 'mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    status: 'implemented',
    dedupKey: 'dedup-123',
    callbackReceived: false,
    createdAt: '2026-03-06T12:00:00.000Z',
    updatedAt: '2026-03-06T12:05:00.000Z',
    ...overrides,
  };
}

describe('useCodeTaskLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockGetFirestoreClient.mockReturnValue({ name: 'db' });
    mockCollection.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'collection', args }));
    mockDoc.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'doc', args }));
    mockQuery.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'query', args }));
    mockOrderBy.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'orderBy', args }));
    mockIsFirebaseAuthenticated.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads terminal task logs once with getDocs', async () => {
    mockGetCodeTask.mockResolvedValue(createTask({ status: 'implemented' }));
    mockGetDocs.mockResolvedValue({
      docs: [
        { data: (): LogDocData => ({ sequence: 1, text: '[done] finished' }) },
      ],
    });

    const { result } = renderHook(() => useCodeTaskLogs('task-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetCodeTask).toHaveBeenCalledWith('test-token', 'task-123');
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(result.current.logs).toEqual([{ sequence: 1, text: '[done] finished' }]);
    expect(result.current.listenerHealthy).toBe(false);
  });

  it('streams active task logs and marks listener healthy', async () => {
    const taskSnapshotHandler: { current?: (value: TaskSnapshotValue) => void } = {};
    const logsSnapshotHandler: { current?: (value: LogSnapshotValue) => void } = {};

    mockGetCodeTask.mockResolvedValue(createTask({ status: 'running' }));
    mockOnSnapshot
      .mockImplementationOnce((_ref: unknown, onNext: (value: TaskSnapshotValue) => void): ReturnType<typeof vi.fn> => {
        taskSnapshotHandler.current = onNext;
        return vi.fn();
      })
      .mockImplementationOnce((_ref: unknown, onNext: (value: LogSnapshotValue) => void): ReturnType<typeof vi.fn> => {
        logsSnapshotHandler.current = onNext;
        return vi.fn();
      });

    const { result } = renderHook(() => useCodeTaskLogs('task-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.listenerHealthy).toBe(true);

    await act(async () => {
      logsSnapshotHandler.current?.({
        docs: [
          { data: (): LogDocData => ({ sequence: 1, text: '[tool] first line' }) },
        ],
        docChanges: (): LogDocChange[] => [],
      });
    });

    expect(result.current.logs).toEqual([{ sequence: 1, text: '[tool] first line' }]);

    await act(async () => {
      logsSnapshotHandler.current?.({
        docs: [],
        docChanges: (): LogDocChange[] => [
          { type: 'added', doc: { data: (): LogDocData => ({ sequence: 2, text: '[done] second line' }) } },
        ],
      });
    });

    expect(result.current.logs).toEqual([
      { sequence: 1, text: '[tool] first line' },
      { sequence: 2, text: '[done] second line' },
    ]);

    await act(async () => {
      taskSnapshotHandler.current?.({
        exists: () => true,
        data: () => ({ status: 'failed' }),
      });
    });

    await waitFor(() => {
      expect(mockGetCodeTask).toHaveBeenCalledTimes(2);
    });
  });

  it('marks listener unhealthy when a live listener errors', async () => {
    let taskErrorHandler: ((error: Error) => void) | undefined;

    mockGetCodeTask.mockResolvedValue(createTask({ status: 'running' }));
    mockOnSnapshot
      .mockImplementationOnce((_ref: unknown, _onNext: unknown, onError: typeof taskErrorHandler): ReturnType<typeof vi.fn> => {
        taskErrorHandler = onError;
        return vi.fn();
      })
      .mockImplementationOnce((): ReturnType<typeof vi.fn> => vi.fn());

    const { result } = renderHook(() => useCodeTaskLogs('task-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.listenerHealthy).toBe(true);

    await act(async () => {
      taskErrorHandler?.(new Error('listener failed'));
    });

    expect(result.current.listenerHealthy).toBe(false);
  });
});
