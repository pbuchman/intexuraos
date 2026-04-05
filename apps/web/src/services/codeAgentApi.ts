import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  AskAgentStartResponse,
  CodeTask,
  CodeTaskStatus,
  GitHubEventLogResponse,
  GitHubPREventsResponse,
  GitHubPRSummariesResponse,
  ListCodeTasksResponse,
  RetryCodeTaskRequest,
  RetryCodeTaskResponse,
  StartImplementationResponse,
  SubmitCodeTaskRequest,
  SubmitCodeTaskResponse,
  WorkersStatusResponse,
} from '@/types';

export interface QueuedTask {
  id: string;
  prompt: string;
  linearIssueId?: string;
  workerType: string;
  agentType?: string;
  queuedAt: string;
  createdAt: string;
  position: number;
}

export interface QueueResponse {
  tasks: QueuedTask[];
  totalQueued: number;
  maxQueueSize: number;
}

/**
 * List code tasks for the current user
 */
export async function listCodeTasks(
  accessToken: string,
  options?: {
    status?: CodeTaskStatus[];
    limit?: number;
    cursor?: string;
  }
): Promise<ListCodeTasksResponse> {
  const params = new URLSearchParams();
  if (options?.status !== undefined && options.status.length > 0) {
    params.set('status', options.status.join(','));
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
    timeout: 90000, // 90s — submit can take 30+ seconds due to Linear API + worker dispatch
  });
}

/**
 * Delete a code task by ID
 */
export async function deleteCodeTask(accessToken: string, taskId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(config.codeAgentUrl, `/code/tasks/${taskId}`, accessToken, {
    method: 'DELETE',
  });
}

/**
 * Archive a code task by ID
 */
export async function archiveCodeTask(accessToken: string, taskId: string): Promise<void> {
  await apiRequest<{ archived: boolean }>(config.codeAgentUrl, `/code/tasks/${taskId}/archive`, accessToken, {
    method: 'POST',
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
 * Start execution-agent implementation from a completed planning task.
 * @param accessToken - Auth0 access token for authorization.
 * @param taskId - ID of the planning task to implement.
 * @param workerType - Optional worker type override. When omitted, the server uses its default.
 */
export async function startImplementation(
  accessToken: string,
  taskId: string,
  workerType?: string
): Promise<StartImplementationResponse> {
  return await apiRequest<StartImplementationResponse>(
    config.codeAgentUrl,
    `/code/tasks/${taskId}/implement`,
    accessToken,
    {
      method: 'POST',
      body: workerType !== undefined ? { workerType } : {},
    }
  );
}

/**
 * Get GitHub PR events for a repository or specific PR
 */
export async function getGitHubPREvents(
  accessToken: string,
  options?: {
    repository?: string;
    pullRequestNumber?: number;
    limit?: number;
  }
): Promise<GitHubPREventsResponse> {
  const params = new URLSearchParams();
  if (options?.repository !== undefined) {
    params.set('repository', options.repository);
  }
  if (options?.pullRequestNumber !== undefined) {
    params.set('pullRequestNumber', String(options.pullRequestNumber));
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const path = query !== '' ? `/code/github-pr-events?${query}` : '/code/github-pr-events';
  return await apiRequest<GitHubPREventsResponse>(config.codeAgentUrl, path, accessToken);
}

/**
 * Get GitHub PR summaries (last 30 days, sorted by PR number desc)
 */
export async function getGitHubPRSummaries(accessToken: string): Promise<GitHubPRSummariesResponse> {
  return await apiRequest<GitHubPRSummariesResponse>(config.codeAgentUrl, '/code/github-pr-summaries', accessToken);
}

export async function getGitHubEventLog(
  accessToken: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<GitHubEventLogResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }

  const query = params.toString();
  const path = query !== '' ? `/code/github-event-log?${query}` : '/code/github-event-log';
  return await apiRequest<GitHubEventLogResponse>(config.codeAgentUrl, path, accessToken);
}

export async function hydrateGitHubEventLogRows(
  accessToken: string,
  ids: string[]
): Promise<GitHubEventLogResponse> {
  return await apiRequest<GitHubEventLogResponse>(
    config.codeAgentUrl,
    '/code/github-event-log/rows',
    accessToken,
    {
      method: 'POST',
      body: { ids },
    }
  );
}

export interface GitHubEventLogPayloadResponse {
  payload: unknown;
}

export async function getGitHubEventLogPayload(
  accessToken: string,
  id: string,
): Promise<GitHubEventLogPayloadResponse> {
  return await apiRequest<GitHubEventLogPayloadResponse>(
    config.codeAgentUrl,
    `/code/github-event-log/${encodeURIComponent(id)}/payload`,
    accessToken,
  );
}

/**
 * Get the current dispatch queue status
 */
export async function getDispatchQueue(accessToken: string): Promise<QueueResponse> {
  return await apiRequest<QueueResponse>(
    config.codeAgentUrl,
    '/code/queue',
    accessToken,
  );
}

/**
 * Start a new Ask Agent session
 */
export async function startAskAgent(
  accessToken: string,
  request: { prompt: string }
): Promise<AskAgentStartResponse> {
  return await apiRequest<AskAgentStartResponse>(config.codeAgentUrl, '/code/ask-agent/start', accessToken, {
    method: 'POST',
    body: request,
  });
}
