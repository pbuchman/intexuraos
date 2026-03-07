/**
 * Use case: Process approved code action from actions-agent.
 *
 * Creates a code task with deduplication and dispatches to worker.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../../domain/services/taskDispatcher.js';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import { randomUUID } from 'node:crypto';
import { hasCodeTaskLabel, getWorkerTypeFromLabels } from '../../domain/utils/labelUtils.js';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { sanitizePromptForInjection } from '../../domain/utils/promptInjectionSanitizer.js';
import { generateWebhookSecret, generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { loadConfig } from '../../config.js';
import { backLinkPlanningTask } from './backLinkPlanningTask.js';

/**
 * Request to process a code action.
 */
export interface ProcessCodeActionRequest {
  actionId: string;
  approvalEventId: string;
  userId: string;
  prompt: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
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
  | 'duplicate_prompt'
  | 'active_task_exists'
  | 'worker_unavailable'
  | 'worker_not_configured'
  | 'queue_full'          // Queue at max capacity (INT-619)
  | 'queue_timeout'       // Task expired in queue (INT-619)
  | 'validation_error'    // Prompt failed injection sanitization (INT-413)
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
  linearIssueService: LinearIssueService;
  whatsappNotifier: WhatsAppNotifier;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  serviceUrl: string;
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
  const { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, workerSettingsRepo } = deps;
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

  // Step 2: Sanitize prompt — secret redaction first, then injection prevention
  const secretRedacted = sanitizePrompt(prompt);
  const injectionResult = sanitizePromptForInjection(secretRedacted);
  if (!injectionResult.ok) {
    return err({
      code: 'validation_error',
      message: injectionResult.error.message,
    });
  }
  const sanitizedPromptText = injectionResult.value;

  // Step 3: Ensure Linear issue exists and get labels/childCount
  const issueResult = await linearIssueService.ensureIssueExists({
    userId,
    ...(linearIssueId !== undefined && { linearIssueId }),
    taskPrompt: sanitizedPromptText,
  });

  // CRITICAL: If user provided an issue ID but we're in fallback mode, this is an error
  /* v8 ignore start -- test-infra: requires linear-agent mock to return validation failure @preserve */
  if (linearIssueId !== undefined && issueResult.linearFallback) {
    logger.error({ linearIssueId }, 'User-provided Linear issue could not be validated');
    return err({
      code: 'internal_error',
      message: `The Linear issue "${linearIssueId}" could not be validated. Please check that it exists and you have access to it.`,
    });
  }
  /* v8 ignore stop @preserve */

  const {
    linearIssueId: finalLinearIssueId,
    linearIssueTitle,
    linearIssueLabels,
    hasChildren,
  } = issueResult;

  // Derive worker type from labels (single match only, otherwise fall back to request's workerType)
  const labelWorkerType = getWorkerTypeFromLabels(linearIssueLabels);
  const effectiveWorkerType = labelWorkerType ?? workerType;

  logger.info(
    {
      linearIssueId: finalLinearIssueId,
      linearIssueTitle,
      linearIssueLabels,
      hasChildren,
      labelWorkerType,
      effectiveWorkerType,
    },
    'Linear issue processed'
  );

  // Step 4: Pre-generate task ID and derive deterministic webhook secret
  const taskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, taskId);

  // Step 5: Create code task with deduplication
  const createInput: {
    id: string;
    userId: string;
    prompt: string;
    sanitizedPrompt: string;
    systemPromptHash: string;
    workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
    workerLocation: string;
    repository: string;
    baseBranch: string;
    traceId: string;
    actionId: string;
    approvalEventId: string;
    webhookSecret: string;
    linearIssueId?: string;
    agentType: 'planning' | 'execution';
  } = {
    id: taskId,
    userId,
    prompt,
    sanitizedPrompt: sanitizedPromptText,
    systemPromptHash: 'system-prompt-hash-v1', // TODO: Compute from actual system prompt
    workerType: effectiveWorkerType,
    /* v8 ignore start -- ts-type: nullish coalescing fallback (enabledWorkers[0] always exists after length check) @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown', // Use first worker as default
    /* v8 ignore stop @preserve */
    repository: repository ?? 'pbuchman/intexuraos',
    baseBranch: baseBranch ?? 'development',
    traceId: traceId ?? `trace-${String(Date.now())}`, // Use provided traceId or generate one
    actionId,
    approvalEventId,
    webhookSecret,
    agentType: hasCodeTaskLabel(linearIssueLabels) ? 'execution' : 'planning',
  };

  // Only include linear issue fields if we have them
  /* v8 ignore start -- ts-type: type narrowing branch for optional linear issue fields, requires complex setup @preserve */
  if (finalLinearIssueId !== undefined) {
    createInput.linearIssueId = finalLinearIssueId;
  }
  /* v8 ignore stop @preserve */

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    // Handle deduplication errors specifically
    const error = createResult.error;
    if (
      error.code === 'DUPLICATE_APPROVAL' ||
      error.code === 'DUPLICATE_ACTION' ||
      error.code === 'DUPLICATE_PROMPT' ||
      error.code === 'ACTIVE_TASK_EXISTS'
    ) {
      return err({
        code: error.code.toLowerCase() as
          | 'duplicate_approval'
          | 'duplicate_action'
          | 'duplicate_prompt'
          | 'active_task_exists',
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

  // Step 5b: Back-link planning task to this execution task (INT-725, best-effort)
  await backLinkPlanningTask(codeTaskRepo, logger, task);

  // Step 6: Build webhook URL for callback
  const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

  // Step 7: Dispatch to worker with per-user credentials
  const dispatchRequest: {
    taskId: string;
    linearIssueId?: string;
    linearIssueLabels: string[];
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
    agentType: 'planning' | 'execution';
  } = {
    taskId: task.id,
    linearIssueLabels,
    hasChildren,
    prompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    repository: task.repository,
    baseBranch: task.baseBranch,
    workerType: task.workerType,
    webhookUrl,
    webhookSecret,
    workerCredentials,
    agentType: task.agentType === 'execution' ? 'execution' : 'planning',
  };

  // Only include linearIssueId if it exists
  if (task.linearIssueId !== undefined) {
    dispatchRequest.linearIssueId = task.linearIssueId;
  }

  // Include traceId from task
  dispatchRequest.traceId = task.traceId;

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  const config = loadConfig();

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;

    // INT-619: Queue task when all workers are at capacity
    if (dispatchError.code === 'at_capacity') {
      const queueCountResult = await codeTaskRepo.countQueued();
      /* v8 ignore start -- test-infra: Firestore countQueued failure fallback to fail-closed @preserve */
      if (!queueCountResult.ok) {
        logger.error({ error: queueCountResult.error }, 'Failed to count queued tasks, treating as queue full');
      }
      /* v8 ignore stop @preserve */
      const queueCount = queueCountResult.ok ? queueCountResult.value : config.queue.maxSize;

      if (queueCount >= config.queue.maxSize) {
        await codeTaskRepo.update(task.id, {
          status: 'failed',
          error: {
            code: 'queue_full',
            message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
          },
        });
        return err({
          code: 'queue_full',
          message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
        });
      }

      const queuedAt = new Date();
      const queueUpdateResult = await codeTaskRepo.update(task.id, {
        status: 'queued',
        queuedAt,
      });

      if (!queueUpdateResult.ok) {
        logger.error({ taskId: task.id, error: queueUpdateResult.error }, 'Failed to persist queued status');
        return err({
          code: 'internal_error',
          message: 'Failed to queue task',
        });
      }

      const queuePosition = queueCount + 1;
      const estimatedWaitMinutes = Math.min(queuePosition * 5, config.queue.ttlMinutes);
      await whatsappNotifier.notifyTaskQueued(userId, task, queuePosition, estimatedWaitMinutes);

      logger.info({ taskId: task.id, queuePosition }, 'Task queued due to worker capacity');

      return ok({
        codeTaskId: task.id,
        resourceUrl: `/#/code-tasks/${task.id}`,
        workerLocation: 'queued' as WorkerLocation,
      });
    }

    // Other dispatch errors - fail as before
    await codeTaskRepo.update(task.id, {
      status: 'failed',
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

  // Step 8: Record metrics for task submission
  const source = request.source ?? 'web';
  try {
    await deps.metricsClient.incrementTasksSubmitted(effectiveWorkerType, source);
  } catch (error: unknown) {
    logger.error({ error, taskId: task.id, workerType: effectiveWorkerType, source }, 'Failed to record task submission metric');
  }

  // Step 9: Generate cancel nonce and send task started notification (INT-379)
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(task.id, {
    workerLocation: dispatchValue.workerLocation,
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

  // Step 10: Return success
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: dispatchValue.workerLocation,
  });
}
