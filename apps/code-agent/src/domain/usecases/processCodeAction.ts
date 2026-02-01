/**
 * Use case: Process approved code action from actions-agent.
 *
 * Creates a code task with deduplication and dispatches to worker.
 */

import { err, ok, serializeError, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
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
  | 'worker_not_configured'
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
  workerSettingsRepo: WorkerSettingsRepository;
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
  const { logger, codeTaskRepo, taskDispatcher, whatsappNotifier, workerSettingsRepo } = deps;
  const { actionId, approvalEventId, userId, prompt, workerType, linearIssueId, repository, baseBranch, traceId } =
    request;

  // Step 1: Fetch user's worker settings (required for dispatch)
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  /* v8 ignore start -- test-infra: error path requires Firestore failure @preserve */
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }
  /* v8 ignore stop @preserve */

  const settings = settingsResult.value;

  // Build worker credentials from user's settings - NO FALLBACKS
  /* v8 ignore start -- ts-type: nullish coalescing for when settings is null @preserve */
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: requires user with no enabled workers fixture @preserve */
  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before submitting code tasks',
    });
  }
  /* v8 ignore stop @preserve */

  const workerCredentials: DispatchWorkerCredentials = {
    workers: enabledWorkers.map((w) => ({
      name: w.name,
      url: w.url,
      cfAccessClientId: w.cfAccessClientId,
      cfAccessClientSecret: w.cfAccessClientSecret,
      dispatchSigningSecret: w.dispatchSigningSecret,
    })),
  };

  // Step 2: Linear issue creation (stub for now - use provided or undefined)
  const finalLinearIssueId = linearIssueId;

  // Step 3: Generate webhook secret upfront so it can be stored with the task
  const webhookSecret = generateWebhookSecret();

  // Step 4: Create code task with deduplication
  const createInput: {
    userId: string;
    prompt: string;
    sanitizedPrompt: string;
    systemPromptHash: string;
    workerType: 'opus' | 'auto' | 'glm';
    workerLocation: string;
    repository: string;
    baseBranch: string;
    traceId: string;
    actionId: string;
    approvalEventId: string;
    webhookSecret: string;
    linearIssueId?: string;
    linearIssueTitle?: string;
    linearFallback?: boolean;
  } = {
    userId,
    prompt,
    sanitizedPrompt: prompt, // TODO: Add sanitization
    systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
    workerType,
    /* v8 ignore start -- ts-type: nullish coalescing fallback (enabledWorkers[0] always exists after length check) @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown', // Use first worker as default
    /* v8 ignore stop @preserve */
    repository: repository ?? 'pbuchman/intexuraos',
    baseBranch: baseBranch ?? 'development',
    traceId: traceId ?? `trace-${String(Date.now())}`, // Use provided traceId or generate one
    actionId,
    approvalEventId,
    webhookSecret,
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

  // Step 5: Build webhook URL for callback (use SERVICE_URL for local/E2E environments)
  const serviceUrl = process.env['INTEXURAOS_SERVICE_URL'] ?? 'https://code-agent.intexuraos.cloud';
  const webhookUrl = `${serviceUrl}/internal/webhooks/task-complete`;

  // Step 6: Dispatch to worker with per-user credentials
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
    workerCredentials: DispatchWorkerCredentials;
  } = {
    taskId: task.id,
    prompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    repository: task.repository,
    baseBranch: task.baseBranch,
    workerType: task.workerType,
    webhookUrl,
    webhookSecret,
    workerCredentials,
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

  // Step 7: Record metrics for task submission
  const source = request.source ?? 'web';
  await deps.metricsClient.incrementTasksSubmitted(workerType, source).catch((error: unknown) => {
    logger.warn({ error: serializeError(error), taskId: task.id }, 'Failed to record task submission metric');
  });

  // Step 8: Generate cancel nonce and send task started notification (INT-379)
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

  // Step 9: Return success
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: dispatchValue.workerLocation,
  });
}
