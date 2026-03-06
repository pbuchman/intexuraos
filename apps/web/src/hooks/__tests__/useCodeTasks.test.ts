/**
 * Tests for useCodeTasks hooks.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCodeTasks, useWorkersStatus, findRecentTask } from '../useCodeTasks.js';
import type { CodeTask, WorkersStatusResponse } from '../../types/index.js';

const mockGetAccessToken = vi.fn();
const mockIsAuthenticated = true;
const mockUser = { sub: 'user-123' };

vi.mock('../../context/index.js', () => ({
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
const mockSubmitCodeTask = vi.fn();
const mockDeleteCodeTask = vi.fn();
const mockGetWorkersStatus = vi.fn();

vi.mock('../../services/codeAgentApi.js', () => ({
  listCodeTasks: (...args: unknown[]): unknown => mockListCodeTasks(...args),
  submitCodeTask: (...args: unknown[]): unknown => mockSubmitCodeTask(...args),
  deleteCodeTask: (...args: unknown[]): unknown => mockDeleteCodeTask(...args),
  getWorkersStatus: (...args: unknown[]): unknown => mockGetWorkersStatus(...args),
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
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

    it('deletes a task and removes it from the list', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: undefined,
      });
      mockDeleteCodeTask.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteTask('task-123');
      });

      expect(mockDeleteCodeTask).toHaveBeenCalledWith('test-token', 'task-123');
      expect(result.current.tasks).toHaveLength(0);
    });

    it('propagates deleteTask errors', async () => {
      mockListCodeTasks.mockResolvedValue({
        tasks: [mockTask],
        nextCursor: undefined,
      });
      mockDeleteCodeTask.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useCodeTasks());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deleteTask('task-123');
        })
      ).rejects.toThrow('Delete failed');

      // Task should remain in list since delete failed
      expect(result.current.tasks).toHaveLength(1);
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

  describe('findRecentTask', () => {
    it('returns matching task when prompt matches and created within 2 minutes', () => {
      const now = new Date();
      const recentTask: CodeTask = {
        ...mockTask,
        id: 'task-recent',
        prompt: 'Fix the authentication bug',
        createdAt: new Date(now.getTime() - 60000).toISOString(), // 1 minute ago
      };

      const result = findRecentTask([recentTask], 'Fix the authentication bug');
      expect(result).toEqual(recentTask);
    });

    it('returns null when no matching task found', () => {
      const now = new Date();
      const task: CodeTask = {
        ...mockTask,
        id: 'task-other',
        prompt: 'Build new feature',
        createdAt: new Date(now.getTime() - 60000).toISOString(),
      };

      const result = findRecentTask([task], 'Fix the authentication bug');
      expect(result).toBeNull();
    });

    it('returns null when matching task is too old', () => {
      const now = new Date();
      const oldTask: CodeTask = {
        ...mockTask,
        id: 'task-old',
        prompt: 'Fix the authentication bug',
        createdAt: new Date(now.getTime() - 300000).toISOString(), // 5 minutes ago
      };

      const result = findRecentTask([oldTask], 'Fix the authentication bug');
      expect(result).toBeNull();
    });

    it('returns null for empty task list', () => {
      const result = findRecentTask([], 'Fix the bug');
      expect(result).toBeNull();
    });

    it('matches tasks by trimmed prompt comparison', () => {
      const now = new Date();
      const task: CodeTask = {
        ...mockTask,
        id: 'task-trimmed',
        prompt: '  Fix the bug  ',
        createdAt: new Date(now.getTime() - 30000).toISOString(),
      };

      const result = findRecentTask([task], 'Fix the bug');
      expect(result).toEqual(task);
    });
  });

  describe('useWorkersStatus', () => {
    const mockStatus: WorkersStatusResponse = {
      workers: [
        { name: 'mac-worker', url: 'https://mac.example.com', priority: 1, healthy: true, checkedAt: '2024-01-01T00:00:00Z' },
        { name: 'vm-worker', url: 'https://vm.example.com', priority: 2, healthy: false, checkedAt: '2024-01-01T00:00:00Z' },
      ],
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
      const updatedStatus: WorkersStatusResponse = {
        workers: [
          { name: 'mac-worker', url: 'https://mac.example.com', priority: 1, healthy: true, checkedAt: '2024-01-01T00:00:00Z' },
        ],
      };
      mockGetWorkersStatus.mockResolvedValue(updatedStatus);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetWorkersStatus).toHaveBeenCalledTimes(1);
      expect(result.current.status?.workers).toHaveLength(1);
    });
  });
});
