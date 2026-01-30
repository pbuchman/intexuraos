/**
 * Types for worker settings API.
 */

export type WorkerType = 'mac' | 'vm';

/**
 * Masked worker config returned from API (secrets hidden).
 */
export interface MaskedWorkerConfig {
  url: string;
  cfAccessClientId: string; // masked (e.g., "•••••abc")
  cfAccessClientSecret: string; // masked
  dispatchSigningSecret: string; // masked
  enabled: boolean;
  lastTestedAt?: string;
  testStatus?: 'success' | 'failure';
  testMessage?: string;
}

/**
 * Response from GET /code/worker-settings
 */
export interface WorkerSettingsResponse {
  mac?: MaskedWorkerConfig;
  vm?: MaskedWorkerConfig;
  workerPriority?: WorkerType[];
}

/**
 * Request body for PATCH /code/worker-settings/:workerType
 */
export interface WorkerConfigInput {
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

/**
 * Response from PATCH /code/worker-settings/:workerType
 */
export interface UpdateWorkerConfigResponse {
  updated: boolean;
}

/**
 * Response from DELETE /code/worker-settings/:workerType
 */
export interface DeleteWorkerConfigResponse {
  deleted: boolean;
}

/**
 * Response from POST /code/worker-settings/:workerType/test
 */
export interface TestWorkerConnectivityResponse {
  testStatus: 'success' | 'failure';
  testMessage: string;
  lastTestedAt: string;
}
