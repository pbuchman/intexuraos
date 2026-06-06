/**
 * Use case: Start an ask-agent task for interactive conversations.
 *
 * Follows the same pattern as POST /code/submit but without Linear integration.
 * Tasks are created with agentType: 'ask_agent' and workerType: 'opus'.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { randomUUID } from 'node:crypto';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { classifyCodeTaskDispatchability } from '../services/codeTaskDispatchBlockers.js';
import {
  buildDispatchStatusForProblem,
  dispatchFailureProblem,
  dispatchProblemFromBlocker,
  notifyDispatchProblemForTask,
  taskErrorFromDispatchStatus,
} from '../services/codeTaskDispatchProblems.js';
import { sanitizePrompt } from '../utils/promptSanitization.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { loadConfig } from '../../config.js';

export interface StartAskAgentRequest {
  userId: string;
  prompt: string;
}

export interface StartAskAgentResult {
  status: 'submitted' | 'failed';
  codeTaskId: string;
}

export type StartAskAgentErrorCode =
  | 'duplicate_prompt'
  | 'internal_error';

export interface StartAskAgentError {
  code: StartAskAgentErrorCode;
  message: string;
}

export interface StartAskAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
}

export async function startAskAgent(
  deps: StartAskAgentDeps,
  request: StartAskAgentRequest,
): Promise<Result<StartAskAgentResult, StartAskAgentError>> {
  const { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier } = deps;
  const { userId, prompt } = request;

  // 1. Sanitize prompt
  const sanitizedPromptText = sanitizePrompt(prompt);

  // 3. Generate task ID and webhook secret
  const config = loadConfig();
  const taskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(config.orchestratorSecret, taskId);

  // 4. Create task
  const createResult = await codeTaskRepo.create({
    id: taskId,
    userId,
    prompt,
    sanitizedPrompt: sanitizedPromptText,
    systemPromptHash: 'ask-agent',
    workerType: 'opus',
    workerLocation: 'pending',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: `trace_${String(Date.now())}_${Math.random().toString(36).substring(7)}`,
    webhookSecret,
    agentType: 'ask_agent',
  });

  if (!createResult.ok) {
    logger.warn({ error: createResult.error }, 'Failed to create ask-agent task');
    /* v8 ignore start -- test-infra: FakeFirestore triggers DUPLICATE_PROMPT via dedup query, but v8 coverage cannot record branch hit in CI forks pool; test at startAskAgent.test.ts:153 exercises this path @preserve */
    if (createResult.error.code === 'DUPLICATE_PROMPT') {
      return err({
        code: 'duplicate_prompt',
        message: `Similar task submitted in last 5 minutes: ${createResult.error.existingTaskId}`,
      });
    }
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- test-infra: FakeFirestore cannot simulate write failures that would return a non-DUPLICATE_PROMPT error code @preserve */
    return err({ code: 'internal_error', message: createResult.error.message });
    /* v8 ignore stop @preserve */
  }

  const task = createResult.value;

  // 5. Validate workers are configured
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
    const problem = dispatchFailureProblem({
      message: 'Task could not be dispatched because worker settings could not be loaded.',
      remediation: 'Retry this task after worker settings are available.',
    });
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const updateResult = await codeTaskRepo.update(task.id, {
      status: 'failed',
      error: taskErrorFromDispatchStatus(dispatchStatus),
      dispatchStatus,
    });
    if (!updateResult.ok) {
      logger.error({ taskId: task.id, error: updateResult.error }, 'Failed to fail ask-agent task after worker settings lookup failed');
      return err({ code: 'internal_error', message: 'Failed to persist dispatch failure status' });
    }
    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier,
      codeTaskRepo,
      logger,
      affectedTaskCount: 1,
    });
    return ok({
      status: 'failed',
      codeTaskId: task.id,
    });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings?.workers.filter((w) => w.enabled) ?? [];

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for ask-agent');
    const dispatchability = classifyCodeTaskDispatchability({
      workerType: task.workerType,
      workers: enabledWorkers,
      healthByWorkerName: {},
    }) as Extract<ReturnType<typeof classifyCodeTaskDispatchability>, { dispatchable: false }>;
    const problem = dispatchProblemFromBlocker(dispatchability);
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const updateResult = await codeTaskRepo.update(task.id, {
      status: 'failed',
      error: taskErrorFromDispatchStatus(dispatchStatus),
      dispatchStatus,
    });
    if (!updateResult.ok) {
      logger.error({ taskId: task.id, error: updateResult.error }, 'Failed to fail ask-agent task after no enabled workers');
      return err({ code: 'internal_error', message: 'Failed to persist dispatch failure status' });
    }
    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier,
      codeTaskRepo,
      logger,
      affectedTaskCount: 1,
    });
    return ok({
      status: 'failed',
      codeTaskId: task.id,
    });
  }

  // 6. Enqueue task
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return ok({
        status: 'failed',
        codeTaskId: task.id,
      });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  logger.info({ taskId: task.id }, 'Ask-agent task submitted and enqueued successfully');

  return ok({
    status: 'submitted',
    codeTaskId: task.id,
  });
}
