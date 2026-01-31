/**
 * Task dispatcher implementation.
 *
 * Dispatches code tasks to available workers with HMAC-signed requests.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { WorkerConfig } from '../../domain/models/worker.js';
import type { WorkerCredentials } from '../../domain/models/workerSettings.js';
import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  DispatchWorkerCredentials,
} from '../../domain/services/taskDispatcher.js';
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
  traceId?: string;
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
interface WorkerConfigWithCredentials extends WorkerConfig {
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

  constructor(deps: TaskDispatcherDeps) {
    this.logger = deps.logger;
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

    // Only add traceId if provided
    if (request.traceId !== undefined) {
      taskRequest.traceId = request.traceId;
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

    // Try to dispatch to available workers
    const result = await this.dispatchToWorker(taskRequest, body, timestamp, workers);

    return result;
  }

  /**
   * Attempt to dispatch to a worker, with fallback on 503.
   * Uses per-request worker credentials for user isolation.
   */
  private async dispatchToWorker(
    taskRequest: WorkerTaskRequest,
    body: string,
    timestamp: number,
    workers: WorkerConfigWithCredentials[]
  ): Promise<Result<DispatchResult, DispatchError>> {
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
        continue;
      } catch (error) {
        this.logger.error(
          { taskId: taskRequest.taskId, workerLocation: worker.location, error },
          'Failed to dispatch to worker'
        );

        if (error instanceof Error && error.message.includes('503')) {
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

      /* v8 ignore start -- test-infra: requires worker to return error response @preserve */
      if (!response.ok) {
        this.logger.warn(
          { taskId, location, status: response.status },
          'Worker cancellation request failed'
        );
        return;
      }
      /* v8 ignore stop @preserve */

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
