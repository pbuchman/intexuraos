/**
 * Tests for codeAgentApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listCodeTasks,
  getCodeTask,
  submitCodeTask,
  cancelCodeTask,
  getWorkersStatus,
} from '../codeAgentApi';
import type { CodeTask, ListCodeTasksResponse, WorkersStatusResponse } from '../../types';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    codeAgentUrl: 'https://code-agent.test',
  },
}));

describe('codeAgentApi', () => {
  const mockAccessToken = 'test-access-token';

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
  });

  describe('listCodeTasks', () => {
    it('fetches tasks without options', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: ListCodeTasksResponse = {
        tasks: [mockTask],
        nextCursor: 'cursor-next',
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await listCodeTasks(mockAccessToken);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });

    it('fetches tasks with status filter', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { status: 'running' });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?status=running',
        mockAccessToken
      );
    });

    it('fetches tasks with limit', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { limit: 10 });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?limit=10',
        mockAccessToken
      );
    });

    it('fetches tasks with cursor for pagination', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { cursor: 'abc123' });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?cursor=abc123',
        mockAccessToken
      );
    });

    it('fetches tasks with all options', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { status: 'completed', limit: 5, cursor: 'xyz789' });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?status=completed&limit=5&cursor=xyz789',
        mockAccessToken
      );
    });
  });

  describe('getCodeTask', () => {
    it('fetches a single task by ID', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(mockTask);

      const result = await getCodeTask(mockAccessToken, 'task-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks/task-123',
        mockAccessToken
      );
      expect(result).toEqual(mockTask);
    });
  });

  describe('submitCodeTask', () => {
    it('submits a new task with minimal request', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { status: 'submitted' as const, codeTaskId: 'new-task-id' };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await submitCodeTask(mockAccessToken, { prompt: 'Build feature X' });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/submit',
        mockAccessToken,
        {
          method: 'POST',
          body: { prompt: 'Build feature X' },
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('submits a new task with all options', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { status: 'submitted' as const, codeTaskId: 'new-task-id' };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const request = {
        prompt: 'Build feature X',
        workerType: 'auto' as const,
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Feature X',
      };

      await submitCodeTask(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/submit',
        mockAccessToken,
        {
          method: 'POST',
          body: request,
        }
      );
    });
  });

  describe('cancelCodeTask', () => {
    it('cancels a running task', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { status: 'cancelled' as const };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await cancelCodeTask(mockAccessToken, 'task-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/cancel',
        mockAccessToken,
        {
          method: 'POST',
          body: { taskId: 'task-123' },
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getWorkersStatus', () => {
    it('fetches worker status', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: WorkersStatusResponse = {
        mac: { healthy: true, capacity: 2, checkedAt: '2024-01-01T00:00:00Z' },
        vm: { healthy: false, capacity: 0, checkedAt: '2024-01-01T00:00:00Z' },
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await getWorkersStatus(mockAccessToken);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/workers/status',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
