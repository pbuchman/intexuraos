/**
 * Tests for useCodeTasks hooks.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCodeTask, useCodeTasks, useWorkersStatus } from '../useCodeTasks';
import type { CodeTask, WorkersStatusResponse } from '../../types';

const mockGetAccessToken = vi.fn();
const mockIsAuthenticated = true;
const mockUser = { sub: 'user-123' };

vi.mock('../../context', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: typeof mockUser;
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
    user: mockUser,
  }),
}));

const mockListCodeTasks = vi.fn();
const mockGetCodeTask = vi.fn();
const mockSubmitCodeTask = vi.fn();
const mockCancelCodeTask = vi.fn();
const mockGetWorkersStatus = vi.fn();

vi.mock('../../services/codeAgentApi', () => ({
  listCodeTasks: (...args: unknown[]): unknown => mockListCodeTasks(...args),
  getCodeTask: (...args: unknown[]): unknown => mockGetCodeTask(...args),
  submitCodeTask: (...args: unknown[]): unknown => mockSubmitCodeTask(...args),
  cancelCodeTask: (...args: unknown[]): unknown => mockCancelCodeTask(...args),
  getWorkersStatus: (...args: unknown[]): unknown => mockGetWorkersStatus(...args),
}));

const mockOnSnapshot = vi.fn();
const mockDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]): unknown => mockDoc(...args),
  onSnapshot: (...args: unknown[]): unknown => mockOnSnapshot(...args),
}));

vi.mock('../../services/firebase', () => ({
  getFirestoreClient: vi.fn(() => ({})),
  authenticateFirebase: vi.fn(),
  isFirebaseAuthenticated: vi.fn(() => false),
  initializeFirebase: vi.fn(),
}));

describe('useCodeTasks hooks', () => {
  const mockTask: CodeTask = {
    id: 'task-123',
    userId: 'user-456',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-789',
    workerType: 'opus',
    workerLocation: 'mac',
    repository: 'test-repo',
    baseBranch: 'main',
    traceId: 'trace-abc',
    status: 'running',
    dedupKey: 'dedup-key',
    callbackReceived: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockCompletedTask: CodeTask = {
    ...mockTask,
    status: 'completed',
    result: {
      branch: 'feature/fix',
      commits: 3,
      summary: 'Fixed the bug',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockOnSnapshot.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useCodeTask', () => {
    it('fetches task on mount', async () => {
      mockGetCodeTask.mockResolvedValue(mockTask);

      const { result } = renderHook(() => useCodeTask('task-123'));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetCodeTask).toHaveBeenCalledWith('test-token', 'task-123');
      expect(result.current.task).toEqual(mockTask);
      expect(result.current.error).toBeNull();
    });

    it('handles empty id', async () => {
      const { result } = renderHook(() => useCodeTask(''));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetCodeTask).not.toHaveBeenCalled();
      expect(result.current.task).toBeNull();
    });

    it('handles fetch error', async () => {
      mockGetCodeTask.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useCodeTask('task-123'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.task).toBeNull();
    });

    it('refreshes task data', async () => {
      mockGetCodeTask.mockResolvedValue(mockTask);

      const { result } = renderHook(() => useCodeTask('task-123'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockGetCodeTask.mockClear();
      mockGetCodeTask.mockResolvedValue(mockCompletedTask);

      await act(async () => {
        await result.current.refresh(false);
      });

      expect(mockGetCodeTask).toHaveBeenCalledTimes(1);
      expect(result.current.task?.status).toBe('completed');
    });

    it('cancels task', async () => {
      mockGetCodeTask.mockResolvedValue(mockTask);
      mockCancelCodeTask.mockResolvedValue({ status: 'cancelled' });

      const { result } = renderHook(() => useCodeTask('task-123'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockGetCodeTask.mockResolvedValue({ ...mockTask, status: 'cancelled' });

      await act(async () => {
        await result.current.cancelTask();
      });

      expect(mockCancelCodeTask).toHaveBeenCalledWith('test-token', 'task-123');
    });

    it('does not set up Firestore listener for completed tasks', async () => {
      mockGetCodeTask.mockResolvedValue(mockCompletedTask);

      renderHook(() => useCodeTask('task-123'));

      await waitFor(() => {
        expect(mockGetCodeTask).toHaveBeenCalled();
      });

      expect(mockOnSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('useCodeTasks', () => {
    it('fetches tasks on mount', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: 'cursor-abc',
      });

      const { result } = renderHook(() => useCodeTasks());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockListCodeTasks).toHaveBeenCalledWith('test-token', {});
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('fetches tasks with status filter', async () => {
      mockListCodeTasks.mockResolvedValue({ tasks: [], nextCursor: undefined });

      const { result } = renderHook(() => useCodeTasks({ status: 'running' }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockListCodeTasks).toHaveBeenCalledWith('test-token', { status: 'running' });
    });

    it('handles fetch error', async () => {
      mockListCodeTasks.mockRejectedValue(new Error('API error'));

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('API error');
      expect(result.current.tasks).toEqual([]);
    });

    it('loads more tasks', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: 'cursor-abc',
      });

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockListCodeTasks.mockResolvedValue({
        tasks: [{ ...mockTask, id: 'task-456' }],
        nextCursor: undefined,
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockListCodeTasks).toHaveBeenLastCalledWith('test-token', { cursor: 'cursor-abc' });
      expect(result.current.tasks).toHaveLength(2);
      expect(result.current.hasMore).toBe(false);
    });

    it('does not load more when no cursor', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: undefined,
      });

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const callCount = mockListCodeTasks.mock.calls.length;

      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockListCodeTasks).toHaveBeenCalledTimes(callCount);
    });

    it('submits new task', async () => {
      mockListCodeTasks.mockResolvedValue({ tasks: [], nextCursor: undefined });
      mockSubmitCodeTask.mockResolvedValue({ status: 'submitted', codeTaskId: 'new-task' });

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const taskId = await act(async () => {
        return await result.current.submitTask({ prompt: 'Build feature' });
      });

      expect(mockSubmitCodeTask).toHaveBeenCalledWith('test-token', { prompt: 'Build feature' });
      expect(taskId).toBe('new-task');
    });

    it('refreshes list', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: undefined,
      });

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockListCodeTasks.mockClear();

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockListCodeTasks).toHaveBeenCalledTimes(1);
    });
  });

  describe('useWorkersStatus', () => {
    const mockStatus: WorkersStatusResponse = {
      mac: { healthy: true, capacity: 2, checkedAt: '2024-01-01T00:00:00Z' },
      vm: { healthy: false, capacity: 0, checkedAt: '2024-01-01T00:00:00Z' },
    };

    it('fetches worker status on mount', async () => {
      mockGetWorkersStatus.mockResolvedValue(mockStatus);

      const { result } = renderHook(() => useWorkersStatus());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetWorkersStatus).toHaveBeenCalledWith('test-token');
      expect(result.current.status).toEqual(mockStatus);
      expect(result.current.error).toBeNull();
    });

    it('handles fetch error', async () => {
      mockGetWorkersStatus.mockRejectedValue(new Error('Status unavailable'));

      const { result } = renderHook(() => useWorkersStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Status unavailable');
      expect(result.current.status).toBeNull();
    });

    it('refreshes status', async () => {
      mockGetWorkersStatus.mockResolvedValue(mockStatus);

      const { result } = renderHook(() => useWorkersStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockGetWorkersStatus.mockClear();
      mockGetWorkersStatus.mockResolvedValue({
        ...mockStatus,
        mac: { ...mockStatus.mac, capacity: 1 },
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetWorkersStatus).toHaveBeenCalledTimes(1);
      expect(result.current.status?.mac.capacity).toBe(1);
    });
  });
});
