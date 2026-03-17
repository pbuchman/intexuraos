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
  deleteCodeTask,
  getGitHubEventLog,
  hydrateGitHubEventLogRows,
  startImplementation,
} from '../codeAgentApi.js';
import type { CodeTask, ListCodeTasksResponse, WorkersStatusResponse } from '../../types/index.js';

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

      await listCodeTasks(mockAccessToken, { status: ['running'] });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?status=running',
        mockAccessToken
      );
    });

    it('fetches tasks with multiple status filters', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { status: ['running', 'failed'] });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks?status=running%2Cfailed',
        mockAccessToken
      );
    });

    it('skips status param when status array is empty', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ tasks: [], nextCursor: undefined });

      await listCodeTasks(mockAccessToken, { status: [] });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks',
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

      await listCodeTasks(mockAccessToken, { status: ['completed'], limit: 5, cursor: 'xyz789' });

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

  describe('GitHub event log', () => {
    it('fetches the live event log with pagination params', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = {
        rows: [],
        nextCursor: '2026-03-12T10:00:00.000Z',
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await getGitHubEventLog(mockAccessToken, {
        limit: 25,
        cursor: '2026-03-12T09:00:00.000Z',
      });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/github-event-log?limit=25&cursor=2026-03-12T09%3A00%3A00.000Z',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });

    it('hydrates specific event log rows by id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = {
        rows: [
          {
            id: 'delivery-1',
            githubEventName: 'pull_request',
          },
        ],
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await hydrateGitHubEventLogRows(mockAccessToken, ['delivery-1', 'delivery-2']);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/github-event-log/rows',
        mockAccessToken,
        {
          method: 'POST',
          body: { ids: ['delivery-1', 'delivery-2'] },
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('submitCodeTask', () => {
    it('submits a new task with minimal request and 90s timeout', async () => {
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
          timeout: 90000,
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
      };

      await submitCodeTask(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/submit',
        mockAccessToken,
        {
          method: 'POST',
          body: request,
          timeout: 90000,
        }
      );
    });

    it('submits task with workerLocation and 90s timeout', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { status: 'submitted' as const, codeTaskId: 'task-456' };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const request = {
        prompt: 'Fix bug',
        workerType: 'opus' as const,
        workerLocation: 'home-mac',
      };
      const result = await submitCodeTask(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/submit',
        mockAccessToken,
        {
          method: 'POST',
          body: request,
          timeout: 90000,
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes 90s timeout to apiRequest for submit call', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ status: 'submitted', codeTaskId: 'task-789' });

      await submitCodeTask(mockAccessToken, { prompt: 'Test timeout' });

      const callArgs = vi.mocked(apiRequest).mock.calls[0];
      const options = callArgs?.[3] as { timeout?: number } | undefined;
      expect(options?.timeout).toBe(90000);
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

  describe('deleteCodeTask', () => {
    it('calls DELETE on /code/tasks/:taskId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ deleted: true });

      await deleteCodeTask(mockAccessToken, 'task-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks/task-123',
        mockAccessToken,
        { method: 'DELETE' }
      );
    });
  });

  describe('startImplementation', () => {
    it('sends empty object body when no workerType is provided', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { taskId: 'impl-task-1', status: 'started' as const };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await startImplementation(mockAccessToken, 'task-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks/task-123/implement',
        mockAccessToken,
        {
          method: 'POST',
          body: {},
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('sends workerType in body when provided', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = { taskId: 'impl-task-2', status: 'started' as const };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await startImplementation(mockAccessToken, 'task-456', 'opus');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://code-agent.test',
        '/code/tasks/task-456/implement',
        mockAccessToken,
        {
          method: 'POST',
          body: { workerType: 'opus' },
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getWorkersStatus', () => {
    it('fetches worker status', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: WorkersStatusResponse = {
        workers: [
          { name: 'mac-worker', url: 'https://mac.example.com', priority: 1, healthy: true, checkedAt: '2024-01-01T00:00:00Z' },
          { name: 'vm-worker', url: 'https://vm.example.com', priority: 2, healthy: false, checkedAt: '2024-01-01T00:00:00Z' },
        ],
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
