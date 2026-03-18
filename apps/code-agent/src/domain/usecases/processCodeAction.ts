/**
 * Use case: Process approved code action from actions-agent.
 *
 * Creates a code task with deduplication and dispatches to worker.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WorkerType } from '../../domain/models/codeTask.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import { randomUUID } from 'node:crypto';
import { hasCodeTaskLabel, getWorkerTypeFromLabels } from '../../domain/utils/labelUtils.js';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { sanitizePromptForInjection } from '../../domain/utils/promptInjectionSanitizer.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { backLinkPlanningTask } from './backLinkPlanningTask.js';
import { shouldFanOut, fanOutChildTasks } from './fanOutChildTasks.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';

// TODO: Compute from actual system prompt content instead of using a static placeholder.
const SYSTEM_PROMPT_HASH_PLACEHOLDER = 'system-prompt-hash-v1';

/**
 * Request to process a code action.
 */
export interface ProcessCodeActionRequest {
  actionId: string;
  approvalEventId: string;
  userId: string;
  prompt: string;
  workerType: WorkerType;
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
  taskEnqueueService: TaskEnqueueService;
  linearIssueService: LinearIssueService;
  linearAgentClient: LinearAgentClient;
  whatsappNotifier: WhatsAppNotifier;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
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
  const { logger, codeTaskRepo, linearIssueService, workerSettingsRepo } = deps;
  const { actionId, approvalEventId, userId, prompt, workerType, linearIssueId, repository, baseBranch, traceId } =
    request;

  // Step 1: Fetch user's worker settings (required for dispatch)
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }

  const settings = settingsResult.value;

  // Build worker credentials from user's settings - NO FALLBACKS
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before submitting code tasks',
    });
  }

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
  if (linearIssueId !== undefined && issueResult.linearFallback) {
    logger.error({ linearIssueId }, 'User-provided Linear issue could not be validated');
    return err({
      code: 'internal_error',
      message: `The Linear issue "${linearIssueId}" could not be validated. Please check that it exists and you have access to it.`,
    });
  }

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

  // Step 3b: Fan-out check (INT-962) — if parent issue has children with code-task labels,
  // create separate child tasks instead of dispatching the parent.
  if (finalLinearIssueId !== undefined && shouldFanOut(hasChildren, linearIssueLabels)) {
    logger.info({ linearIssueId: finalLinearIssueId }, 'Fan-out triggered: parent issue has code-task children');

    // Pre-generate parent task to use as a template for child tasks
    const parentTaskId = `task_${randomUUID()}`;
    const parentWebhookSecret = generateWebhookSecret(deps.orchestratorSecret, parentTaskId);

    const parentCreateResult = await codeTaskRepo.create({
      id: parentTaskId,
      userId,
      prompt,
      sanitizedPrompt: sanitizedPromptText,
      systemPromptHash: SYSTEM_PROMPT_HASH_PLACEHOLDER,
      workerType: effectiveWorkerType,
      /* v8 ignore start -- ts-type: nullish coalescing fallback (enabledWorkers[0] always exists after length check) @preserve */
      workerLocation: enabledWorkers[0]?.name ?? 'unknown',
      /* v8 ignore stop @preserve */
      repository: repository ?? 'pbuchman/intexuraos',
      baseBranch: baseBranch ?? 'development',
      traceId: traceId ?? `trace-${String(Date.now())}`,
      actionId,
      approvalEventId,
      webhookSecret: parentWebhookSecret,
      linearIssueId: finalLinearIssueId,
      agentType: 'execution',
    });

    if (!parentCreateResult.ok) {
      const error = parentCreateResult.error;
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
      return err({ code: 'internal_error', message: error.message });
    }

    const parentTask = parentCreateResult.value;

    const fanOutResult = await fanOutChildTasks(
      {
        logger,
        codeTaskRepo,
        linearAgentClient: deps.linearAgentClient,
        taskEnqueueService: deps.taskEnqueueService,
        orchestratorSecret: deps.orchestratorSecret,
      },
      {
        parentTask,
        userId,
        linearIssueId: finalLinearIssueId,
      },
    );

    // Fan-out failed — fall back to normal dispatch regardless of error type.
    // The parent task was already created; enqueue it for dispatch.
    if (!fanOutResult.ok) {
      const isNoChildren = fanOutResult.error.code === 'no_qualifying_children';
      if (isNoChildren) {
        logger.info({ linearIssueId: finalLinearIssueId }, 'Fan-out found no qualifying children, falling back to normal dispatch');
      } else {
        logger.warn({ linearIssueId: finalLinearIssueId, error: fanOutResult.error }, 'Fan-out failed, falling back to normal dispatch');
      }

      await backLinkPlanningTask(codeTaskRepo, logger, parentTask);

      const enqueueResult = await deps.taskEnqueueService.enqueue({ taskId: parentTask.id, userId });
      if (!enqueueResult.ok) {
        if (enqueueResult.error.code === 'queue_full') {
          return err({ code: 'queue_full', message: enqueueResult.error.message });
        }
        return err({ code: 'internal_error', message: enqueueResult.error.message });
      }
    }

    // Fan-out succeeded or fell back to normal enqueue — return the parent task ID
    return ok({
      codeTaskId: parentTask.id,
      resourceUrl: `/#/code-tasks/${parentTask.id}`,
      workerLocation: 'queued' as WorkerLocation,
    });
  }

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
    workerType: WorkerType;
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
    systemPromptHash: SYSTEM_PROMPT_HASH_PLACEHOLDER,
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
  if (finalLinearIssueId !== undefined) {
    createInput.linearIssueId = finalLinearIssueId;
  }

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

  // Step 6: Enqueue task for dispatch (INT-949)
  const enqueueResult = await deps.taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  // Step 7: Record metrics for task submission
  const source = request.source ?? 'web';
  try {
    await deps.metricsClient.incrementTasksSubmitted(effectiveWorkerType, source);
  } catch (error: unknown) {
    logger.error({ error, taskId: task.id, workerType: effectiveWorkerType, source }, 'Failed to record task submission metric');
  }

  // Step 8: Return success — task is in queue, drainTaskQueue will dispatch it
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: 'queued' as WorkerLocation,
  });
}
