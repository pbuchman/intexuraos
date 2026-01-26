/**
 * Use case: Process approved code action from actions-agent.
 *
 * Creates a code task with deduplication and dispatches to worker.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
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
  const { codeTaskRepo, taskDispatcher } = deps;
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

  // Step 5: Return success
  const dispatchValue = dispatchResult.value;
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: dispatchValue.workerLocation,
  });
}
