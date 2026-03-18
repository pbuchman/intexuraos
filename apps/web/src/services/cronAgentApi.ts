import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CronExecution,
  CronExecutionStatus,
  CronSchedule,
  CronScheduleStatus,
  CreateScheduleRequest,
  ListExecutionsResponse,
  ListSchedulesResponse,
  ServiceInfo,
} from '@/types';

/**
 * List cron schedules for the current user
 */
export async function listSchedules(
  accessToken: string,
  options?: {
    status?: CronScheduleStatus[];
    limit?: number;
    cursor?: string;
  }
): Promise<ListSchedulesResponse> {
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
  const path = query !== '' ? `/cron/schedules?${query}` : '/cron/schedules';
  return await apiRequest<ListSchedulesResponse>(config.cronAgentUrl, path, accessToken);
}

/**
 * Create a new cron schedule
 */
export async function createSchedule(
  accessToken: string,
  request: CreateScheduleRequest
): Promise<CronSchedule> {
  return await apiRequest<CronSchedule>(config.cronAgentUrl, '/cron/schedules', accessToken, {
    method: 'POST',
    body: request,
    timeout: 60000, // 60s — LLM cron parsing may take time
  });
}

/**
 * Get a single cron schedule by ID
 */
export async function getSchedule(accessToken: string, id: string): Promise<CronSchedule> {
  return await apiRequest<CronSchedule>(config.cronAgentUrl, `/cron/schedules/${id}`, accessToken);
}

/**
 * Update a cron schedule
 */
export async function updateSchedule(
  accessToken: string,
  id: string,
  updates: Partial<CreateScheduleRequest & { status: CronScheduleStatus }>
): Promise<CronSchedule> {
  return await apiRequest<CronSchedule>(config.cronAgentUrl, `/cron/schedules/${id}`, accessToken, {
    method: 'PATCH',
    body: updates,
    timeout: 60000, // 60s — description changes may re-parse via LLM
  });
}

/**
 * Soft-delete a cron schedule
 */
export async function deleteSchedule(accessToken: string, id: string): Promise<void> {
  await apiRequest<{ success: true }>(config.cronAgentUrl, `/cron/schedules/${id}`, accessToken, {
    method: 'DELETE',
  });
}

/**
 * Manually trigger a cron schedule execution
 */
export async function triggerSchedule(
  accessToken: string,
  id: string
): Promise<CronExecution> {
  return await apiRequest<CronExecution>(
    config.cronAgentUrl,
    `/cron/schedules/${id}/trigger`,
    accessToken,
    { method: 'POST', timeout: 120000 } // 120s — execution may take time
  );
}

/**
 * List cron executions with optional filters
 */
export async function listExecutions(
  accessToken: string,
  options?: {
    scheduleId?: string;
    status?: CronExecutionStatus[];
    limit?: number;
    cursor?: string;
  }
): Promise<ListExecutionsResponse> {
  const params = new URLSearchParams();
  if (options?.scheduleId !== undefined) {
    params.set('scheduleId', options.scheduleId);
  }
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
  const path = query !== '' ? `/cron/executions?${query}` : '/cron/executions';
  return await apiRequest<ListExecutionsResponse>(config.cronAgentUrl, path, accessToken);
}

/**
 * Get a single cron execution by ID
 */
export async function getExecution(accessToken: string, id: string): Promise<CronExecution> {
  return await apiRequest<CronExecution>(config.cronAgentUrl, `/cron/executions/${id}`, accessToken);
}

/**
 * List available services and their tools (JWT-protected)
 */
export async function listAvailableServices(accessToken: string): Promise<ServiceInfo[]> {
  const result = await apiRequest<{ services: ServiceInfo[] }>(
    config.cronAgentUrl,
    '/cron/services',
    accessToken
  );
  return result.services;
}
