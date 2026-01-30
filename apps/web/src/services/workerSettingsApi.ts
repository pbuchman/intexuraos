import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  WorkerSettingsResponse,
  WorkerType,
  WorkerConfigInput,
  UpdateWorkerConfigResponse,
  DeleteWorkerConfigResponse,
  TestWorkerConnectivityResponse,
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
 * Create or update worker configuration.
 */
export async function updateWorkerConfig(
  accessToken: string,
  workerType: WorkerType,
  config_: WorkerConfigInput
): Promise<UpdateWorkerConfigResponse> {
  return await apiRequest<UpdateWorkerConfigResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/${workerType}`,
    accessToken,
    {
      method: 'PATCH',
      body: config_,
    }
  );
}

/**
 * Delete worker configuration.
 */
export async function deleteWorkerConfig(
  accessToken: string,
  workerType: WorkerType
): Promise<DeleteWorkerConfigResponse> {
  return await apiRequest<DeleteWorkerConfigResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/${workerType}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Test worker connectivity.
 */
export async function testWorkerConnectivity(
  accessToken: string,
  workerType: WorkerType
): Promise<TestWorkerConnectivityResponse> {
  return await apiRequest<TestWorkerConnectivityResponse>(
    config.codeAgentUrl,
    `/code/worker-settings/${workerType}/test`,
    accessToken,
    { method: 'POST' }
  );
}

export type {
  WorkerType,
  MaskedWorkerConfig,
  WorkerSettingsResponse,
  WorkerConfigInput,
  UpdateWorkerConfigResponse,
  DeleteWorkerConfigResponse,
  TestWorkerConnectivityResponse,
} from './workerSettingsApi.types.js';
