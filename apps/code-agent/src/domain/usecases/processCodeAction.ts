/**
 * Use case: Process approved code action from actions-agent.
 *
 * Creates a code task with deduplication and dispatches to worker.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import { randomBytes } from 'node:crypto';

/**
 * Generate a webhook secret for a task.
 * Format: whsec_{48 hex chars}
 */
function generateWebhookSecret(): string {
  const buffer = randomBytes(24);
  return `whsec_${buffer.toString('hex')}`;
}

/**
 * Generate a cancel nonce for task cancellation (INT-379).
 * Format: 4 hex characters (2 bytes)
 */
function generateCancelNonce(): string {
  const buffer = randomBytes(2);
  return buffer.toString('hex');
}

/**
 * Cancel nonce TTL in milliseconds (15 minutes).
 */
const CANCEL_NONCE_TTL_MS = 15 * 60 * 1000;

/**
 * Request to process a code action.
 */
export interface ProcessCodeActionRequest {
  actionId: string;
  approvalEventId: string;
  userId: string;
  prompt: string;
  workerType: 'opus' | 'auto' | 'glm';
  linearIssueId?: string;
  repository?: string;
  baseBranch?: string;
  traceId?: string;
  source?: 'whatsapp' | 'web';
}

/**
 * Successful result of processing a code action.
 */
export interface ProcessCodeActionResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
}

/**
 * Error codes for process code action.
 */
export type ProcessCodeActionErrorCode =
  | 'unauthorized'
  | 'duplicate_approval'
  | 'duplicate_action'
  | 'worker_unavailable'
  | 'internal_error';

/**
 * Error result from processing a code action.
 */
export interface ProcessCodeActionError {
  code: ProcessCodeActionErrorCode;
  message: string;
  existingTaskId?: string;
}

export interface ProcessCodeActionDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  metricsClient: MetricsClient;
}

/**
 * Process code action use case.
 *
 * Workflow:
 * 1. Create Linear issue if not provided (stub for now)
 * 2. Create code task with 3-layer deduplication
 * 3. Generate webhook URL and secret
 * 4. Dispatch to worker
 * 5. Handle errors appropriately
 */
export async function processCodeAction(
  deps: ProcessCodeActionDeps,
  request: ProcessCodeActionRequest
): Promise<Result<ProcessCodeActionResult, ProcessCodeActionError>> {
  const { logger, codeTaskRepo, taskDispatcher, whatsappNotifier } = deps;
  const { actionId, approvalEventId, userId, prompt, workerType, linearIssueId, repository, baseBranch, traceId } =
    request;

  // Step 1: Linear issue creation (stub for now - use provided or undefined)
  const finalLinearIssueId = linearIssueId;

  // Step 2: Create code task with deduplication
  const createInput: {
    userId: string;
    prompt: string;
    sanitizedPrompt: string;
    systemPromptHash: string;
    workerType: 'opus' | 'auto' | 'glm';
    workerLocation: 'mac' | 'vm';
    repository: string;
    baseBranch: string;
    traceId: string;
    actionId: string;
    approvalEventId: string;
    linearIssueId?: string;
    linearIssueTitle?: string;
    linearFallback?: boolean;
  } = {
    userId,
    prompt,
    sanitizedPrompt: prompt, // TODO: Add sanitization
    systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
    workerType,
    workerLocation: 'mac', // Default to mac, dispatcher will handle availability
    repository: repository ?? 'pbuchman/intexuraos',
    baseBranch: baseBranch ?? 'development',
    traceId: traceId ?? `trace-${String(Date.now())}`, // Use provided traceId or generate one
    actionId,
    approvalEventId,
  };

  // Only include linearIssueId if provided
  if (finalLinearIssueId !== undefined) {
    createInput.linearIssueId = finalLinearIssueId;
  }

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    // Handle deduplication errors specifically
    const error = createResult.error;
    if (error.code === 'DUPLICATE_APPROVAL' || error.code === 'DUPLICATE_ACTION') {
      return err({
        code: error.code.toLowerCase() as 'duplicate_approval' | 'duplicate_action',
        message: error.message,
        existingTaskId: error.existingTaskId,
      });
    }
    // Other repository errors
    return err({
      code: 'internal_error',
      message: error.message,
    });
  }

  const task = createResult.value;

  // Step 3: Generate webhook URL and secret for this task
  const webhookUrl = `https://code-agent.intexuraos.cloud/internal/webhooks/worker`;
  const webhookSecret = generateWebhookSecret(); // Generate per-task secret

  // Step 4: Dispatch to worker
  const dispatchRequest: {
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
  } = {
    taskId: task.id,
    prompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    repository: task.repository,
    baseBranch: task.baseBranch,
    workerType: task.workerType,
    webhookUrl,
    webhookSecret,
  };

  // Only include linearIssueId if it exists
  if (task.linearIssueId !== undefined) {
    dispatchRequest.linearIssueId = task.linearIssueId;
  }

  // Include traceId from task
  dispatchRequest.traceId = task.traceId;

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  if (!dispatchResult.ok) {
    // Update task with error
    const dispatchError = dispatchResult.error;
    await codeTaskRepo.update(task.id, {
      error: {
        code: dispatchError.code,
        message: dispatchError.message,
      },
    });

    return err({
      code: 'worker_unavailable',
      message: dispatchError.message,
    });
  }

  const dispatchValue = dispatchResult.value;

  // Step 4.5: Record metrics for task submission
  const source = request.source ?? 'web'; // Default to web if not specified
  await deps.metricsClient.incrementTasksSubmitted(workerType, source).catch((error: unknown) => {
    logger.warn({ error, taskId: task.id }, 'Failed to record task submission metric');
  });

  // Step 5: Generate cancel nonce and send task started notification (INT-379)
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(task.id, {
    cancelNonce,
    cancelNonceExpiresAt,
  });

  if (updateResult.ok) {
    const updatedTask = updateResult.value;
    const notifyResult = await whatsappNotifier.notifyTaskStarted(userId, updatedTask);
    if (!notifyResult.ok) {
      logger.warn({ taskId: task.id, error: notifyResult.error }, 'Failed to send task started notification');
    }
  } else {
    logger.warn({ taskId: task.id, error: updateResult.error }, 'Failed to update task with cancel nonce');
  }

  // Step 6: Return success
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: dispatchValue.workerLocation,
  });
}
