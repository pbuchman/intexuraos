import type { CodeTaskWorkerType, CodeTaskWorkerTypePolicy } from '@intexuraos/code-task-domain/worker-types';

/**
 * Types for worker settings API.
 */

/**
 * Masked worker config returned from API (secrets hidden).
 */
export interface MaskedWorkerConfig extends Partial<CodeTaskWorkerTypePolicy> {
  registrationKey?: string;
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
  defaultReviewWorkerType?: string;
  defaultRemediationWorkerType?: string;
  defaultExecutionWorkerType?: string;
  defaultPlanningWorkerType?: string;
  defaultPullRequestWorkerType?: string;
  defaultSentryWorkerType?: string;
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
  enabledWorkerTypes?: CodeTaskWorkerType[];
  expectedRevision?: number;
  expectedRegistration?: string;
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
export interface UpdateWorkerResponse extends Partial<CodeTaskWorkerTypePolicy> {
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
 * Response from PATCH /code/worker-settings/default-*-worker-type
 */
export interface UpdateDefaultWorkerTypeResponse {
  updated: boolean;
}

/**
 * Response from POST /code/worker-settings/workers/:name/test
 */
export interface TestWorkerConnectivityResponse {
  testStatus: 'success' | 'failure';
  testMessage: string;
  lastTestedAt: string;
}
