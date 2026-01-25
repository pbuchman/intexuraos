/**
 * Task dispatcher service interface.
 *
 * Dispatches code tasks to worker machines with HMAC-signed requests.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import type { WorkerLocation } from '../models/worker.js';

/**
 * Request to dispatch a code task to a worker.
 */
export interface DispatchRequest {
  taskId: string;
  linearIssueId?: string;
  prompt: string;
  systemPromptHash: string;
  repository: string;
  baseBranch: string;
  workerType: 'opus' | 'auto' | 'glm';
  webhookUrl: string;
  webhookSecret: string;
}

/**
 * Result of successful dispatch.
 */
export interface DispatchResult {
  dispatched: true;
  workerLocation: WorkerLocation;
}

/**
 * Possible errors during dispatch.
 */
export interface DispatchError {
  code:
    | 'worker_unavailable'
    | 'worker_busy'
    | 'dispatch_failed'
    | 'network_error'
    | 'invalid_response';
  message: string;
}

/**
 * Dependencies for task dispatcher service.
 */
export interface TaskDispatcherDeps {
  logger: Logger;
}

/**
 * Task dispatcher service interface.
 *
 * Dispatches code tasks to available workers with HMAC-signed requests.
 * Implements worker fallback on 503 responses.
 */
export interface TaskDispatcherService {
  /**
   * Dispatch a code task to an available worker.
   *
   * Process:
   * 1. Find available worker via workerDiscovery
   * 2. Generate unique nonce and webhook secret
   * 3. Compute HMAC signature
   * 4. POST to worker /tasks endpoint
   * 5. Fall back to other worker on 503
   *
   * @param request - Dispatch request with task details
   * @returns Dispatch result with worker location or error
   */
  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>>;

  /**
   * Cancel a running task on a worker.
   *
   * Sends a DELETE request to the worker to stop task execution.
   * This is a best-effort notification - the task status in Firestore
   * is the source of truth and should be updated before calling this.
   *
   * @param taskId - The task ID to cancel
   * @param location - The worker location where the task is running
   */
  cancelOnWorker(taskId: string, location: WorkerLocation): Promise<void>;
}
