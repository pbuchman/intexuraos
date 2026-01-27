import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CodeTask,
  CodeTaskStatus,
  ListCodeTasksResponse,
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
