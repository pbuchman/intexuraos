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
import type { RateLimitService } from '../services/rateLimitService.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import { sanitizePrompt } from '../utils/promptSanitization.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { loadConfig } from '../../config.js';

export interface StartAskAgentRequest {
  userId: string;
  prompt: string;
}

export interface StartAskAgentResult {
  status: 'submitted';
  codeTaskId: string;
}

export type StartAskAgentErrorCode =
  | 'rate_limited'
  | 'service_unavailable'
  | 'worker_not_configured'
  | 'duplicate_prompt'
  | 'queue_full'
  | 'internal_error';

export interface StartAskAgentError {
  code: StartAskAgentErrorCode;
  message: string;
}

export interface StartAskAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  rateLimitService: RateLimitService;
  workerSettingsRepo: WorkerSettingsRepository;
  taskEnqueueService: TaskEnqueueService;
}

export async function startAskAgent(
  deps: StartAskAgentDeps,
  request: StartAskAgentRequest,
): Promise<Result<StartAskAgentResult, StartAskAgentError>> {
  const { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService } = deps;
  const { userId, prompt } = request;

  // 1. Check rate limits
  const limitCheck = await rateLimitService.checkLimits(userId, prompt.length);
  if (!limitCheck.ok) {
    const { error } = limitCheck;
    logger.warn({ userId, error }, 'Rate limit exceeded for ask-agent');
    if (error.code === 'service_unavailable') {
      return err({ code: 'service_unavailable', message: error.message });
    }
    return err({ code: 'rate_limited', message: error.message });
  }

  // 2. Sanitize prompt
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
    /* v8 ignore start -- test-infra: FakeFirestore transaction.get() cannot execute compound dedup queries (where+where+limit) needed to trigger DUPLICATE_PROMPT from codeTaskRepo.create() @preserve */
    if (createResult.error.code === 'DUPLICATE_PROMPT') {
      return err({
        code: 'duplicate_prompt',
        message: `Similar task submitted in last 5 minutes: ${createResult.error.existingTaskId}`,
      });
    }
    return err({ code: 'internal_error', message: createResult.error.message });
    /* v8 ignore stop @preserve */
  }

  const task = createResult.value;

  // 5. Validate workers are configured
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
    return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings?.workers.filter((w) => w.enabled) ?? [];

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for ask-agent');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before submitting tasks',
    });
  }

  // 6. Enqueue task
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  // 7. Record rate limit start
  await rateLimitService.recordTaskStart(userId);

  logger.info({ taskId: task.id }, 'Ask-agent task submitted and enqueued successfully');

  return ok({
    status: 'submitted' as const,
    codeTaskId: task.id,
  });
}
