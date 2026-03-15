import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  WorkerSettingsResponse,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  ReorderWorkersRequest,
  AddWorkerResponse,
  UpdateWorkerResponse,
  DeleteWorkerResponse,
  ReorderWorkersResponse,
  TestWorkerConnectivityResponse,
  UpdateDefaultReviewWorkerTypeResponse,
} from './workerSettingsApi.types.js';

/**
 * Get user's worker settings (masked secrets).
 */
export async function getWorkerSettings(accessToken: string): Promise<WorkerSettingsResponse> {
  return await apiRequest<WorkerSettingsResponse>(
    config.codeAgentUrl,
    '/code/worker-settings',
    accessToken
  );
}

/**
 * Add a new worker configuration.
 */
export async function addWorker(
  accessToken: string,
  workerConfig: WorkerConfigInput
): Promise<AddWorkerResponse> {
  return await apiRequest<AddWorkerResponse>(
    config.codeAgentUrl,
    '/code/worker-settings/workers',
    accessToken,
    {
      method: 'POST',
      body: workerConfig,
    }
  );
}

/**
 * Update an existing worker configuration.
 */
export async function updateWorker(
  accessToken: string,
  workerName: string,
  workerConfig: WorkerConfigUpdateInput
): Promise<UpdateWorkerResponse> {
  return await apiRequest<UpdateWorkerResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/workers/${workerName}`,
    accessToken,
    {
      method: 'PATCH',
      body: workerConfig,
    }
  );
}

/**
 * Delete a worker configuration.
 */
export async function deleteWorker(
  accessToken: string,
  workerName: string
): Promise<DeleteWorkerResponse> {
  return await apiRequest<DeleteWorkerResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/workers/${workerName}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Reorder workers by priority.
 */
export async function reorderWorkers(
  accessToken: string,
  request: ReorderWorkersRequest
): Promise<ReorderWorkersResponse> {
  return await apiRequest<ReorderWorkersResponse>(
    config.codeAgentUrl,
    '/code/worker-settings/priority',
    accessToken,
    {
      method: 'PUT',
      body: request,
    }
  );
}

/**
 * Test worker connectivity.
 */
export async function testWorkerConnectivity(
  accessToken: string,
  workerName: string
): Promise<TestWorkerConnectivityResponse> {
  return await apiRequest<TestWorkerConnectivityResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/workers/${workerName}/test`,
    accessToken,
    { method: 'POST' }
  );
}

/**
 * Update default review worker type.
 */
export async function updateDefaultReviewWorkerType(
  accessToken: string,
  workerType: string,
): Promise<UpdateDefaultReviewWorkerTypeResponse> {
  return await apiRequest<UpdateDefaultReviewWorkerTypeResponse>(
    config.codeAgentUrl,
    '/code/worker-settings/default-review-worker-type',
    accessToken,
    { method: 'PATCH', body: { workerType } },
  );
}

export type {
  MaskedWorkerConfig,
  WorkerSettingsResponse,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  ReorderWorkersRequest,
  AddWorkerResponse,
  UpdateWorkerResponse,
  DeleteWorkerResponse,
  ReorderWorkersResponse,
  TestWorkerConnectivityResponse,
  UpdateDefaultReviewWorkerTypeResponse,
} from './workerSettingsApi.types.js';
