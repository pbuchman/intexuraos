/**
 * Types for worker settings API.
 */

/**
 * Masked worker config returned from API (secrets hidden).
 */
export interface MaskedWorkerConfig {
  name: string;
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
  workers: MaskedWorkerConfig[];
}

/**
 * Request body for POST /code/worker-settings/workers
 */
export interface WorkerConfigInput {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

/**
 * Request body for PATCH /code/worker-settings/workers/:name
 */
export interface WorkerConfigUpdateInput {
  url?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  dispatchSigningSecret?: string;
  enabled?: boolean;
}

/**
 * Request body for PUT /code/worker-settings/priority
 */
export interface ReorderWorkersRequest {
  workerNames: string[];
}

/**
 * Response from POST /code/worker-settings/workers
 */
export interface AddWorkerResponse {
  added: boolean;
}

/**
 * Response from PATCH /code/worker-settings/workers/:name
 */
export interface UpdateWorkerResponse {
  updated: boolean;
}

/**
 * Response from DELETE /code/worker-settings/workers/:name
 */
export interface DeleteWorkerResponse {
  deleted: boolean;
}

/**
 * Response from PUT /code/worker-settings/priority
 */
export interface ReorderWorkersResponse {
  reordered: boolean;
}

/**
 * Response from POST /code/worker-settings/workers/:name/test
 */
export interface TestWorkerConnectivityResponse {
  testStatus: 'success' | 'failure';
  testMessage: string;
  lastTestedAt: string;
}

