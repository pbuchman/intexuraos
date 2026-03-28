/**
 * Task dispatcher implementation.
 *
 * Dispatches code tasks to available workers with HMAC-signed requests.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { AgentType, WorkerType } from '../../domain/models/codeTask.js';
import type { WorkerCredentials } from '../../domain/models/workerSettings.js';
import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  DispatchWorkerCredentials,
} from '../../domain/services/taskDispatcher.js';
import type { TaskDispatcherDeps, TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import type { WorkerConfig as WorkerSettingsConfig } from '../../domain/models/workerSettings.js';
import { signDispatchRequest, generateNonce } from './hmacSigning.js';

/**
 * Check if an HTTP status code is a retryable infrastructure error.
 * Includes standard gateway errors (502/503/504) and Cloudflare-specific errors (520-530).
 */
function isRetryableInfraStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
    || (status >= 520 && status <= 530);
}

/** Extract human-readable error message from a response body (may be JSON `{"error":"..."}` or plain text). */
function extractErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Not JSON — use as-is
  }
  return text;
}

/**
 * Worker task request body sent to worker orchestrator.
 */
interface WorkerTaskRequest {
  taskId: string;
  prompt: string;
  systemPromptHash: string;
  repository: string;
  baseBranch: string;
  workerType: WorkerType;
  webhookUrl: string;
  webhookSecret: string;
  /** Labels from the validated Linear issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
  linearIssueId?: string;
  traceId?: string;
  agentType?: AgentType;
  trackingCommentId?: string;
  prNumber?: number;
  continuationPrNumber?: number;
  continuationPrBranch?: string;
  planningPrBranch?: string;
  planningPrUrl?: string;
  reviewTypes?: string[];
}

/**
 * Worker task response.
 */
interface WorkerTaskResponse {
  status: 'accepted' | 'rejected';
  reason?: string;
}

/**
 * Internal worker config with credentials for dispatch.
 */
interface WorkerConfigWithCredentials {
  name: string;
  location: string;
  url: string;
  priority: number;
  credentials: WorkerCredentials;
}

/**
 * Task dispatcher implementation with worker fallback.
 *
 * Credentials are per-request, not stored in the instance.
 * This enables user isolation - each dispatch uses the requesting user's credentials.
 */
class TaskDispatcherImpl implements TaskDispatcherService {
  private readonly logger: TaskDispatcherDeps['logger'];
  private readonly workerHealthProbe: WorkerHealthProbe;

  constructor(deps: TaskDispatcherDeps) {
    this.logger = deps.logger;
    this.workerHealthProbe = deps.workerHealthProbe;
  }

  async dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    this.logger.info({ taskId: request.taskId }, 'Dispatching task to worker');

    // Build request body (field order must match DispatchRequest for consistent HMAC)
    const taskRequest: WorkerTaskRequest = {
      taskId: request.taskId,
      prompt: request.prompt,
      systemPromptHash: request.systemPromptHash,
      repository: request.repository,
      baseBranch: request.baseBranch,
      workerType: request.workerType,
      webhookUrl: request.webhookUrl,
      webhookSecret: request.webhookSecret,
      linearIssueLabels: request.linearIssueLabels,
      hasChildren: request.hasChildren,
    };

    // Only add linearIssueId if provided
    if (request.linearIssueId !== undefined) {
      taskRequest.linearIssueId = request.linearIssueId;
    }

    // Only add traceId if provided
    if (request.traceId !== undefined) {
      taskRequest.traceId = request.traceId;
    }
    if (request.agentType !== undefined) {
      taskRequest.agentType = request.agentType;
    }
    if (request.trackingCommentId !== undefined) {
      taskRequest.trackingCommentId = request.trackingCommentId;
    }
    if (request.prNumber !== undefined) {
      taskRequest.prNumber = request.prNumber;
    }
    if (request.continuationPrNumber !== undefined) {
      taskRequest.continuationPrNumber = request.continuationPrNumber;
    }
    if (request.continuationPrBranch !== undefined) {
      taskRequest.continuationPrBranch = request.continuationPrBranch;
    }
    if (request.planningPrBranch !== undefined) {
      taskRequest.planningPrBranch = request.planningPrBranch;
    }
    if (request.planningPrUrl !== undefined) {
      taskRequest.planningPrUrl = request.planningPrUrl;
    }
    if (request.reviewTypes !== undefined) {
      taskRequest.reviewTypes = request.reviewTypes;
    }

    const body = JSON.stringify(taskRequest);
    const timestamp = Date.now();

    // Get workers from per-request credentials
    const workers = this.getWorkerConfigsFromCredentials(request.workerCredentials);

    if (workers.length === 0) {
      return err({
        code: 'worker_unavailable',
        message: 'No workers configured for this user',
      });
    }

    // Probe all workers in parallel for real-time capacity
    const probeConfigs: WorkerSettingsConfig[] = workers.map((w) => ({
      name: w.name,
      url: w.credentials.url,
      cfAccessClientId: w.credentials.cfAccessClientId,
      cfAccessClientSecret: w.credentials.cfAccessClientSecret,
      dispatchSigningSecret: w.credentials.dispatchSigningSecret,
      enabled: true,
    }));

    const healthResults = await this.workerHealthProbe.probeAllWorkers(probeConfigs);

    // Filter to healthy workers and extract available capacity in a single pass.
    // This avoids separate filter + lookup that would create unreachable fallback branches.
    const workersWithCapacity: { worker: WorkerConfigWithCredentials; available: number }[] = [];
    for (const w of workers) {
      const health = healthResults[w.name];
      if (health?._tag === 'healthy') {
        workersWithCapacity.push({ worker: w, available: health.available });
      }
    }

    if (workersWithCapacity.length === 0) {
      this.logger.warn(
        { totalWorkers: workers.length },
        'All worker health probes failed, no workers available for dispatch'
      );
      return err({
        code: 'worker_unavailable',
        message: 'All worker health probes failed',
      });
    }

    // Sort by available capacity descending, priority as tiebreaker
    workersWithCapacity.sort((a, b) => {
      if (b.available !== a.available) return b.available - a.available;
      return a.worker.priority - b.worker.priority;
    });

    this.logger.info(
      {
        workerOrder: workersWithCapacity.map((wc) => ({
          name: wc.worker.name,
          available: wc.available,
        })),
      },
      'Workers sorted by available capacity for dispatch'
    );

    const sortedWorkers = workersWithCapacity.map((wc) => wc.worker);

    // Try to dispatch to available workers
    const result = await this.dispatchToWorker(taskRequest, body, timestamp, sortedWorkers);

    return result;
  }

  /**
   * Attempt to dispatch to a worker, with fallback on 502/503/504 and Cloudflare 520-530.
   * Uses per-request worker credentials for user isolation.
   */
  private async dispatchToWorker(
    taskRequest: WorkerTaskRequest,
    body: string,
    timestamp: number,
    workers: WorkerConfigWithCredentials[]
  ): Promise<Result<DispatchResult, DispatchError>> {
    let sawCapacity503 = false;
    let sawExplicitRejection = false;

    for (const worker of workers) {
      // Generate nonce for replay protection
      const nonce = generateNonce();

      // Generate HMAC signature using this worker's signing secret
      const signatureResult = signDispatchRequest(
        { logger: this.logger, dispatchSigningSecret: worker.credentials.dispatchSigningSecret },
        { body, timestamp, nonce }
      );
      if (!signatureResult.ok) {
        this.logger.warn(
          { taskId: taskRequest.taskId, workerLocation: worker.location },
          'Failed to sign dispatch request'
        );
        sawExplicitRejection = true;
        continue;
      }

      const { signature } = signatureResult.value;

      try {
        const response = await this.tryDispatch(worker, taskRequest, body, timestamp, signature, nonce);

        if (!response.ok) {
          return response;
        }

        const workerResponse = response.value;

        if (workerResponse.status === 'accepted') {
          this.logger.info(
            { taskId: taskRequest.taskId, workerLocation: worker.location },
            'Task dispatched successfully to worker'
          );

          return ok({
            dispatched: true,
            workerLocation: worker.location,
          });
        }

        this.logger.warn(
          { taskId: taskRequest.taskId, workerLocation: worker.location, reason: workerResponse.reason },
          'Worker rejected task'
        );
        sawExplicitRejection = true;
        continue;
      } catch (error) {
        this.logger.error(
          { taskId: taskRequest.taskId, workerLocation: worker.location, error },
          'Failed to dispatch to worker'
        );

        if (error instanceof Error && error.message.includes('503')) {
          sawCapacity503 = true;
          continue;
        }

        // Same range as isRetryableInfraStatus, minus 503 (handled above for capacity tracking)
        const cfPattern = /\b(502|504|52[0-9]|530)\b/;
        if (error instanceof Error && cfPattern.test(error.message)) {
          continue;
        }

        return err({
          code: 'network_error',
          message: `Network error: ${getErrorMessage(error)}`,
        });
      }
    }

    // INT-619/INT-624: Distinguish capacity-related failures from other failures.
    // Infrastructure errors (502/504/520-530) are neutral — they don't count for or against capacity.
    if (sawCapacity503 && !sawExplicitRejection) {
      return err({
        code: 'at_capacity',
        message: 'All available workers are busy (returned 503)',
      });
    }

    return err({
      code: 'worker_unavailable',
      message: 'No workers available (all rejected or busy)',
    });
  }

  /**
   * Attempt to dispatch to a specific worker.
   * Uses per-request credentials for user isolation.
   */
  private async tryDispatch(
    worker: WorkerConfigWithCredentials,
    taskRequest: WorkerTaskRequest,
    body: string,
    timestamp: number,
    signature: string,
    nonce: string
  ): Promise<Result<WorkerTaskResponse, DispatchError>> {
    this.logger.debug(
      { taskId: taskRequest.taskId, workerLocation: worker.location },
      `Attempting dispatch to ${worker.location}`
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'CF-Access-Client-Id': worker.credentials.cfAccessClientId,
      'CF-Access-Client-Secret': worker.credentials.cfAccessClientSecret,
      'X-Dispatch-Timestamp': String(timestamp),
      'X-Dispatch-Signature': signature,
      'X-Dispatch-Nonce': nonce,
    };

    if (taskRequest.traceId !== undefined) {
      headers['X-Trace-Id'] = taskRequest.traceId;
    }

    const response = await this.fetchWithTimeout(worker.credentials.url + '/tasks', {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      this.logger.warn(
        { taskId: taskRequest.taskId, workerLocation: worker.location, status: response.status },
        'Worker dispatch request failed'
      );

      // 502/503/504 and Cloudflare 520-530 are transient infrastructure errors — retry via worker fallback
      if (isRetryableInfraStatus(response.status)) {
        const error = new Error(`HTTP ${String(response.status)}`) as Error & { code?: string };
        error.code = String(response.status);
        throw error;
      }

      return err({
        code: 'dispatch_failed',
        message: `Worker returned HTTP ${String(response.status)}`,
      });
    }

    let data: WorkerTaskResponse;
    try {
      data = (await response.json()) as WorkerTaskResponse;
    } catch {
      return err({
        code: 'dispatch_failed',
        message: 'Worker returned invalid JSON response',
      });
    }

    return ok(data);
  }

  /**
   * Fetch with timeout using AbortSignal.
   */
  private async fetchWithTimeout(url: string, options: RequestInit & { signal: AbortSignal }): Promise<Response> {
    return await fetch(url, options);
  }

  /**
   * Build worker configurations from per-request credentials.
   * Workers are already sorted by user's priority (array order).
   */
  private getWorkerConfigsFromCredentials(credentials: DispatchWorkerCredentials): WorkerConfigWithCredentials[] {
    return credentials.workers.map((worker, index) => ({
      name: worker.name,
      location: worker.name,
      url: worker.url,
      priority: index + 1,
      credentials: {
        name: worker.name,
        url: worker.url,
        cfAccessClientId: worker.cfAccessClientId,
        cfAccessClientSecret: worker.cfAccessClientSecret,
        dispatchSigningSecret: worker.dispatchSigningSecret,
      },
    }));
  }

  async sendMessageToWorker(
    taskId: string,
    message: string,
    credentials: { url: string; cfAccessClientId: string; cfAccessClientSecret: string; dispatchSigningSecret: string }
  ): Promise<Result<{ action: 'queued' | 'resumed' }, { code: string; message: string }>> {
    this.logger.info({ taskId }, 'Sending message to worker task');

    const body = JSON.stringify({ message });
    const timestamp = Date.now();
    const nonce = generateNonce();

    const signatureResult = signDispatchRequest(
      { logger: this.logger, dispatchSigningSecret: credentials.dispatchSigningSecret },
      { body, timestamp, nonce }
    );
    if (!signatureResult.ok) {
      return err({
        code: 'signing_failed',
        message: `Failed to sign message request: ${signatureResult.error.message}`,
      });
    }

    try {
      const response = await this.fetchWithTimeout(`${credentials.url}/tasks/${taskId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': credentials.cfAccessClientId,
          'CF-Access-Client-Secret': credentials.cfAccessClientSecret,
          'X-Dispatch-Timestamp': String(timestamp),
          'X-Dispatch-Signature': signatureResult.value.signature,
          'X-Dispatch-Nonce': nonce,
        },
        body,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        // 502/503/504 and Cloudflare 520-530 are transient infrastructure errors
        if (isRetryableInfraStatus(response.status)) {
          return err({
            code: 'worker_unavailable',
            message: `Worker is unreachable (HTTP ${String(response.status)})`,
          });
        }
        const errorText = await response.text().catch(() => 'Unknown error');
        const errorMessage = extractErrorMessage(errorText);
        return err({
          code: 'worker_error',
          message: `Worker returned HTTP ${String(response.status)}: ${errorMessage}`,
        });
      }

      const data = (await response.json()) as { action: 'queued' | 'resumed'; pendingMessages?: string[] };
      return ok(data);
    } catch (error) {
      return err({
        code: 'network_error',
        message: `Failed to send message to worker: ${getErrorMessage(error)}`,
      });
    }
  }

  async cancelOnWorker(taskId: string, location: string, credentials?: { url: string; cfAccessClientId: string; cfAccessClientSecret: string }): Promise<void> {
    this.logger.info({ taskId, location }, 'Sending cancellation request to worker');

if (credentials === undefined) {
      this.logger.warn({ taskId, location }, 'No credentials provided for cancellation, skipping worker notification');
      return;
    }

    try {
      const response = await this.fetchWithTimeout(`${credentials.url}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'CF-Access-Client-Id': credentials.cfAccessClientId,
          'CF-Access-Client-Secret': credentials.cfAccessClientSecret,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.logger.warn(
          { taskId, location, status: response.status },
          'Worker cancellation request failed'
        );
        return;
      }

      this.logger.info({ taskId, location }, 'Worker cancellation request successful');
    } catch (error) {
      this.logger.warn({ taskId, location, error: getErrorMessage(error) }, 'Failed to notify worker of cancellation');
    }
  }
}

/**
 * Factory function to create task dispatcher service.
 */
export function createTaskDispatcherService(deps: TaskDispatcherDeps): TaskDispatcherService {
  return new TaskDispatcherImpl(deps);
}
