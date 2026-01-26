/**
 * Task dispatcher implementation.
 *
 * Dispatches code tasks to available workers with HMAC-signed requests.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { WorkerConfig } from '../../domain/models/worker.js';
import type { DispatchError, DispatchRequest, DispatchResult } from '../../domain/services/taskDispatcher.js';
import type { TaskDispatcherDeps, TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import { signDispatchRequest, generateNonce } from './hmacSigning.js';

/**
 * Worker task request body sent to worker orchestrator.
 */
interface WorkerTaskRequest {
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
 * Worker task response.
 */
interface WorkerTaskResponse {
  status: 'accepted' | 'rejected';
  reason?: string;
}

/**
 * Task dispatcher implementation with worker fallback.
 */
class TaskDispatcherImpl implements TaskDispatcherService {
  private readonly logger: TaskDispatcherDeps['logger'];
  private readonly cfAccessClientId: string;
  private readonly cfAccessClientSecret: string;
  private readonly dispatchSigningSecret: string;
  private readonly orchestratorMacUrl: string;
  private readonly orchestratorVmUrl: string;

  constructor(deps: TaskDispatcherDeps) {
    this.logger = deps.logger;
    this.cfAccessClientId = deps.cfAccessClientId;
    this.cfAccessClientSecret = deps.cfAccessClientSecret;
    this.dispatchSigningSecret = deps.dispatchSigningSecret;
    this.orchestratorMacUrl = deps.orchestratorMacUrl;
    this.orchestratorVmUrl = deps.orchestratorVmUrl;
  }

  async dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    this.logger.info({ taskId: request.taskId }, 'Dispatching task to worker');

    // Build request body
    const taskRequest: WorkerTaskRequest = {
      taskId: request.taskId,
      prompt: request.prompt,
      systemPromptHash: request.systemPromptHash,
      repository: request.repository,
      baseBranch: request.baseBranch,
      workerType: request.workerType,
      webhookUrl: request.webhookUrl,
      webhookSecret: request.webhookSecret,
    };

    // Only add linearIssueId if provided
    if (request.linearIssueId !== undefined) {
      taskRequest.linearIssueId = request.linearIssueId;
    }

    const body = JSON.stringify(taskRequest);
    const timestamp = Date.now();

    // Generate HMAC signature
    const signatureResult = signDispatchRequest(
      { logger: this.logger, dispatchSigningSecret: this.dispatchSigningSecret },
      { body, timestamp }
    );
    if (!signatureResult.ok) {
      return err({
        code: 'dispatch_failed',
        message: signatureResult.error.message,
      });
    }

    const { signature } = signatureResult.value;
    const nonce = generateNonce();

    // Try to dispatch to available workers
    const result = await this.dispatchToWorker(taskRequest, body, timestamp, signature, nonce);

    return result;
  }

  /**
   * Attempt to dispatch to a worker, with fallback on 503.
   */
  private async dispatchToWorker(
    taskRequest: WorkerTaskRequest,
    body: string,
    timestamp: number,
    signature: string,
    nonce: string
  ): Promise<Result<DispatchResult, DispatchError>> {
    // Get list of workers from worker discovery
    // For now, we'll try both workers in priority order
    const workers = this.getWorkerConfigs();

    for (const worker of workers) {
      try {
        const response = await this.tryDispatch(worker, taskRequest, body, timestamp, signature, nonce);

        if (!response.ok) {
          return response; // Return error immediately
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

        // After the above check, status must be 'rejected' (type narrowing)
        this.logger.warn(
          { taskId: taskRequest.taskId, workerLocation: worker.location, reason: workerResponse.reason },
          'Worker rejected task'
        );
        // Try next worker
        continue;
      } catch (error) {
        this.logger.error(
          { taskId: taskRequest.taskId, workerLocation: worker.location, error },
          'Failed to dispatch to worker'
        );

        if (error instanceof Error && error.message.includes('503')) {
          // Worker busy, try next worker
          continue;
        }

        return err({
          code: 'network_error',
          message: `Network error: ${getErrorMessage(error)}`,
        });
      }
    }

    return err({
      code: 'worker_unavailable',
      message: 'No workers available (all rejected or busy)',
    });
  }

  /**
   * Attempt to dispatch to a specific worker.
   */
  private async tryDispatch(
    worker: WorkerConfig,
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

    const response = await this.fetchWithTimeout(worker.url + '/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': this.cfAccessClientId,
        'CF-Access-Client-Secret': this.cfAccessClientSecret,
        'X-Dispatch-Timestamp': String(timestamp),
        'X-Dispatch-Signature': signature,
        'X-Dispatch-Nonce': nonce,
      },
      body,
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      this.logger.warn(
        { taskId: taskRequest.taskId, workerLocation: worker.location, status: response.status },
        'Worker dispatch request failed'
      );

      if (response.status === 503) {
        const error = new Error(`HTTP ${String(response.status)}`) as Error & { code?: string };
        error.code = '503';
        throw error;
      }

      return err({
        code: 'dispatch_failed',
        message: `Worker returned HTTP ${String(response.status)}`,
      });
    }

    const data = (await response.json()) as WorkerTaskResponse;

    return ok(data);
  }

  /**
   * Fetch with timeout using AbortSignal.
   */
  private async fetchWithTimeout(url: string, options: RequestInit & { signal: AbortSignal }): Promise<Response> {
    return await fetch(url, options);
  }

  /**
   * Get worker configurations from injected URLs.
   *
   * Returns workers sorted by priority (mac first, then vm).
   */
  private getWorkerConfigs(): WorkerConfig[] {
    const workers: WorkerConfig[] = [];

    if (this.orchestratorMacUrl !== '') {
      workers.push({
        location: 'mac',
        url: this.orchestratorMacUrl,
        priority: 1,
      });
    }

    if (this.orchestratorVmUrl !== '') {
      workers.push({
        location: 'vm',
        url: this.orchestratorVmUrl,
        priority: 2,
      });
    }

    return workers;
  }

  async cancelOnWorker(taskId: string, location: 'mac' | 'vm'): Promise<void> {
    this.logger.info({ taskId, location }, 'Sending cancellation request to worker');

    const workers = this.getWorkerConfigs();
    const worker = workers.find((w) => w.location === location);

    if (!worker) {
      this.logger.warn({ taskId, location }, 'Worker configuration not found for cancellation');
      return;
    }

    try {
      const response = await this.fetchWithTimeout(`${worker.url}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'CF-Access-Client-Id': this.cfAccessClientId,
          'CF-Access-Client-Secret': this.cfAccessClientSecret,
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout for cancellation
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
      // Log but don't fail - task is already marked cancelled in Firestore
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
