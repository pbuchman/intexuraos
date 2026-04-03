/**
 * Tests for findRecentTask and useWorkersStatus hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { findRecentTask, useWorkersStatus } from '../useCodeTasks.js';
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

const mockGetWorkersStatus = vi.fn();

vi.mock('../../services/codeAgentApi.js', () => ({
  getWorkersStatus: (...args: unknown[]): unknown => mockGetWorkersStatus(...args),
}));

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-1',
    workerType: 'auto',
    workerLocation: 'cloud',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: 'pending',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as CodeTask;
}

describe('findRecentTask', () => {
  it('returns a task matching the prompt within the 2-minute window', () => {
    const now = new Date();
    const task = createTask({ prompt: 'Fix the bug', createdAt: now.toISOString() });

    const result = findRecentTask([task], 'Fix the bug');

    expect(result).toBe(task);
  });

  it('matches prompts with surrounding whitespace', () => {
    const now = new Date();
    const task = createTask({ prompt: '  Fix the bug  ', createdAt: now.toISOString() });

    const result = findRecentTask([task], '  Fix the bug  ');

    expect(result).toBe(task);
  });

  it('returns null when prompt does not match', () => {
    const now = new Date();
    const task = createTask({ prompt: 'Fix the bug', createdAt: now.toISOString() });

    const result = findRecentTask([task], 'Add a feature');

    expect(result).toBeNull();
  });

  it('returns null when task is older than 2 minutes', () => {
    const threeMinutesAgo = new Date(Date.now() - 180000);
    const task = createTask({ prompt: 'Fix the bug', createdAt: threeMinutesAgo.toISOString() });

    const result = findRecentTask([task], 'Fix the bug');

    expect(result).toBeNull();
  });

  it('returns null for an empty task list', () => {
    const result = findRecentTask([], 'Fix the bug');

    expect(result).toBeNull();
  });

  it('returns the first matching task when multiple match', () => {
    const now = new Date();
    const task1 = createTask({ id: 'task-1', prompt: 'Fix the bug', createdAt: now.toISOString() });
    const task2 = createTask({ id: 'task-2', prompt: 'Fix the bug', createdAt: now.toISOString() });

    const result = findRecentTask([task1, task2], 'Fix the bug');

    expect(result).toBe(task1);
  });
});

describe('useWorkersStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
