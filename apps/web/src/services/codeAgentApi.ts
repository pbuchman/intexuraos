import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CodeTask,
  CodeTaskStatus,
  GitHubPREventsResponse,
  ListCodeTasksResponse,
  RetryCodeTaskRequest,
  RetryCodeTaskResponse,
  StartImplementationResponse,
  SubmitCodeTaskRequest,
  SubmitCodeTaskResponse,
  WorkersStatusResponse,
} from '@/types';

/**
 * List code tasks for the current user
 */
export async function listCodeTasks(
  accessToken: string,
  options?: {
    status?: CodeTaskStatus;
    limit?: number;
    cursor?: string;
  }
): Promise<ListCodeTasksResponse> {
  const params = new URLSearchParams();
  if (options?.status !== undefined) {
    params.set('status', options.status);
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const query = params.toString();
  const path = query !== '' ? `/code/tasks?${query}` : '/code/tasks';
  return await apiRequest<ListCodeTasksResponse>(config.codeAgentUrl, path, accessToken);
}

/**
 * Get a single code task by ID
 */
export async function getCodeTask(accessToken: string, taskId: string): Promise<CodeTask> {
  return await apiRequest<CodeTask>(config.codeAgentUrl, `/code/tasks/${taskId}`, accessToken);
}

/**
 * Submit a new code task
 */
export async function submitCodeTask(
  accessToken: string,
  request: SubmitCodeTaskRequest
): Promise<SubmitCodeTaskResponse> {
  return await apiRequest<SubmitCodeTaskResponse>(config.codeAgentUrl, '/code/submit', accessToken, {
    method: 'POST',
    body: request,
  });
}

/**
 * Retry a failed code task
 */
export async function retryCodeTask(
  accessToken: string,
  request: RetryCodeTaskRequest
): Promise<RetryCodeTaskResponse> {
  return await apiRequest<RetryCodeTaskResponse>(config.codeAgentUrl, '/code/retry', accessToken, {
    method: 'POST',
    body: request,
  });
}

/**
 * Cancel a running code task
 */
export async function cancelCodeTask(accessToken: string, taskId: string): Promise<{ status: 'cancelled' }> {
  return await apiRequest<{ status: 'cancelled' }>(config.codeAgentUrl, '/code/cancel', accessToken, {
    method: 'POST',
    body: { taskId },
  });
}

/**
 * Get worker status (Mac and VM health)
 */
export async function getWorkersStatus(accessToken: string): Promise<WorkersStatusResponse> {
  return await apiRequest<WorkersStatusResponse>(config.codeAgentUrl, '/code/workers/status', accessToken);
}

/**
 * Refresh worker status synchronously
 */
export async function refreshWorkersStatus(accessToken: string): Promise<WorkersStatusResponse> {
  return await apiRequest<WorkersStatusResponse>(config.codeAgentUrl, '/code/workers/refresh-status', accessToken, {
    method: 'POST',
  });
}

/**
 * Send a message to a running or completed task
 */
export async function sendTaskMessage(
  accessToken: string,
  taskId: string,
  request: { message: string }
): Promise<{ action: 'queued' | 'resumed' }> {
  const response = await apiRequest<{ action: 'queued' | 'resumed' }>(
    config.codeAgentUrl,
    `/code/tasks/${taskId}/messages`,
    accessToken,
    { method: 'POST', body: request }
  );
  return response;
}

/**
 * Start Phase 2 implementation from a completed Phase 1 design task
 */
export async function startImplementation(
  accessToken: string,
  taskId: string
): Promise<StartImplementationResponse> {
  return await apiRequest<StartImplementationResponse>(
    config.codeAgentUrl,
    `/code/tasks/${taskId}/implement`,
    accessToken,
    { method: 'POST' }
  );
}

/**
 * Get GitHub PR events for a repository
 */
export async function getGitHubPREvents(
  accessToken: string,
  options?: {
    repository?: string;
    limit?: number;
  }
): Promise<GitHubPREventsResponse> {
  const params = new URLSearchParams();
  if (options?.repository !== undefined) {
    params.set('repository', options.repository);
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const path = query !== '' ? `/code/github-pr-events?${query}` : '/code/github-pr-events';
  return await apiRequest<GitHubPREventsResponse>(config.codeAgentUrl, path, accessToken);
}
