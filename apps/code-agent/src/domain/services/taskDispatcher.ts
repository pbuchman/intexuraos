/**
 * Task dispatcher service interface.
 *
 * Dispatches code tasks to worker machines with HMAC-signed requests.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import type { WorkerLocation } from '../models/worker.js';
import type { WorkerHealthProbe } from '../ports/workerHealthProbe.js';

/**
 * Per-request worker credentials for dispatch.
 * Built from user's worker settings at request time.
 */
export interface DispatchWorkerCredentials {
  /** Ordered array of workers with credentials. First = primary. */
  workers: {
    name: string;
    url: string;
    cfAccessClientId: string;
    cfAccessClientSecret: string;
    dispatchSigningSecret: string;
  }[];
}

/**
 * Request to dispatch a code task to a worker.
 */
export interface DispatchRequest {
  taskId: string;
  linearIssueId?: string;
  /** Labels from the validated Linear issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
  prompt: string;
  systemPromptHash: string;
  repository: string;
  baseBranch: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
  webhookUrl: string;
  webhookSecret: string;
  traceId?: string;
  workerCredentials: DispatchWorkerCredentials;
  /** Optional health statuses for filtering workers. Only healthy workers will be tried first. */
  workerHealthStatuses?: Record<string, { healthy: boolean }>;
  /** For retried tasks: points to the original task ID that this task is retrying. */
  retriedFrom?: string;
  /** Agent type for orchestrator agent-based routing. */
  agentType?: 'planning' | 'execution' | 'pull_request';
  /** Branch name of planning PR to merge into execution worktree. */
  planningPrBranch?: string;
  /** PR URL to close after successful execution. */
  planningPrUrl?: string;
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
    | 'at_capacity'       // All workers returned 503 (INT-619)
    | 'dispatch_failed'
    | 'network_error'
    | 'invalid_response';
  message: string;
}

/**
 * Dependencies for task dispatcher service.
 *
 * Note: Credentials are now per-request via DispatchRequest.workerCredentials.
 * This enables user isolation - each user's dispatch uses their own credentials.
 */
export interface TaskDispatcherDeps {
  logger: Logger;
  workerHealthProbe: WorkerHealthProbe;
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
   * 1. Find available worker from user's configured worker settings
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
   * @param credentials - Optional credentials for the worker. If not provided, cancellation is skipped.
   */
  cancelOnWorker(
    taskId: string,
    location: string,
    credentials?: { url: string; cfAccessClientId: string; cfAccessClientSecret: string }
  ): Promise<void>;

  /**
   * Send a message to a running or completed task on a worker.
   *
   * - Running tasks: message is queued and delivered when current attempt completes.
   * - Terminal tasks: task resumes with the message via --continue.
   *
   * @param taskId - The task ID to send a message to
   * @param message - The message text to send
   * @param credentials - Worker credentials for authentication
   * @returns Action taken ('queued' or 'resumed') or error
   */
  sendMessageToWorker(
    taskId: string,
    message: string,
    credentials: { url: string; cfAccessClientId: string; cfAccessClientSecret: string; dispatchSigningSecret: string }
  ): Promise<Result<{ action: 'queued' | 'resumed'; pendingMessages?: string[] }, { code: string; message: string }>>;
}
