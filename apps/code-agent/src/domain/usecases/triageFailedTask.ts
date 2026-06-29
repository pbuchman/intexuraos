/**
 * Use case: Triage a failed task for auto-retry.
 *
 * Orchestrates: classify -> budget check -> (optional user-selected LLM) -> auto-retry or permanent fail.
 *
 * INT-1375: Self-healing failure triage.
 * INT-1463: Cooloff-aware retry scheduling for Claude usage-limit failures.
 */

import type { Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask, TaskError } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import { classifyFailure } from '../utils/classifyFailure.js';
import { autoRetryTask, type AutoRetryTaskRequest } from './autoRetryTask.js';
import { failureTriagePrompt, parseTriageResponse } from '../prompts/failureTriagePrompt.js';
import {
  cooloffRetryPrompt,
  parseCooloffResponse,
} from '../prompts/cooloffRetryPrompt.js';
import { parseCooloffResetTime } from '../utils/cooloffResetParser.js';

export type TriageAction = 'retried' | 'retried_after_cooloff' | 'permanent_failure';

export interface TriageResult {
  action: TriageAction;
  reason: string;
  retryTaskId?: string;
}

export interface TriageFailedTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  logLineRepo: LogLineRepository;
  userServiceClient: Pick<UserServiceClient, 'getLlmClient' | 'getUserTimezone'>;
  orchestratorSecret: string;
}

/** Fallback cooloff wait when the LLM parser cannot extract a reset time. */
export const COOLOFF_FALLBACK_MS = 60 * 60 * 1000;

type CooloffSchedule = NonNullable<AutoRetryTaskRequest['cooloffSchedule']>;

export async function triageFailedTask(
  deps: TriageFailedTaskDeps,
  request: { task: CodeTask; completedAt: Date; taskError: TaskError }
): Promise<TriageResult> {
  const { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier } = deps;
  const { task, taskError } = request;

  // Step 1: Classify the failure
  const verdict = classifyFailure(taskError);
  logger.info({ taskId: task.id, errorCode: taskError.code, verdict }, 'Failure classified');

  // Step 2: Handle permanent failures immediately
  if (verdict === 'fail') {
    return { action: 'permanent_failure' as const, reason: `Classified as permanent: ${taskError.code}` };
  }

  // Step 3: For ask_llm, call the user's configured LLM to decide
  if (verdict === 'ask_llm') {
    const llmDecision = await askUserLlmForTriage(deps, task, taskError);
    if (!llmDecision.shouldRetry) {
      return { action: 'permanent_failure' as const, reason: `LLM triage: ${llmDecision.reason}` };
    }
    // Fall through to retry
  }

  let cooloffSchedule: CooloffSchedule | undefined;
  if (verdict === 'retry_after_cooloff') {
    cooloffSchedule = await resolveCooloffSchedule(deps, task, taskError, new Date());
  }

  const retryRequest: AutoRetryTaskRequest = {
    failedTask: task,
    failedWorkerLocation: task.workerLocation,
    reason: `${taskError.code}: ${taskError.message}`.slice(0, 200),
    ...(cooloffSchedule !== undefined && { cooloffSchedule }),
  };

  const retryResult = await autoRetryTask(
    { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier, orchestratorSecret: deps.orchestratorSecret },
    retryRequest
  );

  if (!retryResult.ok) {
    if (retryResult.error.code === 'budget_exhausted') {
      await whatsappNotifier.notifyTaskAutoRetryExhausted(task.userId, task, {
        attempts: retryResult.error.attempts,
        errorMessage: taskError.message,
      });
      return {
        action: 'permanent_failure' as const,
        reason: `Auto-retry budget exhausted: ${retryResult.error.message}`,
      };
    }
    // Internal error — fall through to permanent failure
    return { action: 'permanent_failure' as const, reason: `Auto-retry failed: ${retryResult.error.message}` };
  }

  const action: TriageAction = verdict === 'retry_after_cooloff' ? 'retried_after_cooloff' : 'retried';
  return {
    action,
    reason: `${taskError.code}: ${taskError.message}`.slice(0, 200),
    retryTaskId: retryResult.value.codeTaskId,
  };
}

async function askUserLlmForTriage(
  deps: TriageFailedTaskDeps,
  task: CodeTask,
  taskError: TaskError
): Promise<{ shouldRetry: boolean; reason: string }> {
  const { logger, logLineRepo, userServiceClient } = deps;

  const llmClientResult = await userServiceClient.getLlmClient(task.userId);
  if (!llmClientResult.ok) {
    logger.warn(
      { taskId: task.id, userId: task.userId, error: llmClientResult.error },
      'Failed to resolve user LLM client for failure triage, defaulting to no-retry'
    );
    return { shouldRetry: false, reason: `User LLM unavailable: ${llmClientResult.error.message}` };
  }

  // Fetch recent log lines
  const logResult = await logLineRepo.listRecent(task.id, 20);
  const logLines = logResult.ok ? logResult.value.map((line) => line.text) : [];

  if (!logResult.ok) {
    logger.warn({ taskId: task.id, error: logResult.error }, 'Failed to fetch log lines for triage');
  }

  const prompt = failureTriagePrompt.build({
    errorCode: taskError.code,
    errorMessage: taskError.message,
    recentLogLines: logLines,
  });

  const generateResult = await llmClientResult.value.generate(prompt, { promptType: 'failed-task-triage' });
  if (!generateResult.ok) {
    logger.warn({ taskId: task.id, error: generateResult.error }, 'LLM triage call failed, defaulting to no-retry');
    return { shouldRetry: false, reason: `LLM call failed: ${generateResult.error.message}` };
  }

  const triageResponse = parseTriageResponse(generateResult.value.content);
  logger.info(
    { taskId: task.id, shouldRetry: triageResponse.shouldRetry, reason: triageResponse.reason },
    'LLM triage decision'
  );

  return triageResponse;
}

/**
 * Resolve a cooloff dispatch schedule for a `retry_after_cooloff` failure.
 *
 * Strategy:
 *   1. Fetch recent log lines (tolerate fetch errors).
 *   2. Fetch user timezone (tolerate fetch errors).
 *   3. Resolve the user's LLM client; on failure, use the fallback delay.
 *   4. Call the LLM with the cooloff prompt.
 *   5. Parse the response; on invalid/past/out-of-range, use the fallback delay.
 *
 * The fallback path writes ONE absolute `notBeforeAt = now + 60 min` and
 * marks `derivedBy = 'fallback'`. It is not a recurring retry.
 */
async function resolveCooloffSchedule(
  deps: TriageFailedTaskDeps,
  task: CodeTask,
  taskError: TaskError,
  now: Date
): Promise<CooloffSchedule> {
  const { logger, logLineRepo, userServiceClient } = deps;

  // Fetch recent log lines (best-effort).
  const logResult = await logLineRepo.listRecent(task.id, 20);
  const recentLogLines = logResult.ok ? logResult.value.map((line) => line.text) : [];
  if (!logResult.ok) {
    logger.warn(
      { taskId: task.id, error: logResult.error, [SKIP_SENTRY_KEY]: true },
      'Failed to fetch log lines for cooloff parsing'
    );
  }

  // Fetch user timezone (best-effort).
  let userTimezone: string | undefined;
  try {
    userTimezone = await userServiceClient.getUserTimezone(task.userId);
  } catch (error) {
    logger.warn(
      { taskId: task.id, userId: task.userId, error, [SKIP_SENTRY_KEY]: true },
      'Failed to fetch user timezone for cooloff parsing'
    );
    userTimezone = undefined;
  }

  // Build the fallback schedule after timezone resolution so the retry task's
  // dispatchSchedule reflects the real user timezone when known (INT-1468).
  const fallback: CooloffSchedule = {
    notBeforeAt: new Date(now.getTime() + COOLOFF_FALLBACK_MS),
    derivedBy: 'fallback' as const,
    sourceText: taskError.message.slice(0, 200),
    ...(userTimezone !== undefined && { timezone: userTimezone }),
  };

  const deterministic = parseCooloffResetTime({ text: taskError.message, now });
  if (deterministic !== null) {
    logger.info(
      {
        taskId: task.id,
        notBeforeAt: deterministic.notBeforeAt.toISOString(),
        timezone: deterministic.timezone,
        sourceText: deterministic.sourceText,
      },
      'Cooloff reset time extracted deterministically'
    );
    return {
      notBeforeAt: deterministic.notBeforeAt,
      derivedBy: 'parser' as const,
      timezone: deterministic.timezone,
      sourceText: deterministic.sourceText,
    };
  }

  // Resolve LLM client.
  const llmClientResult = await userServiceClient.getLlmClient(task.userId);
  if (!llmClientResult.ok) {
    logger.warn(
      { taskId: task.id, userId: task.userId, error: llmClientResult.error, [SKIP_SENTRY_KEY]: true },
      'User LLM unavailable for cooloff parsing; using fallback delay'
    );
    return fallback;
  }

  const prompt = cooloffRetryPrompt.build({
    errorCode: taskError.code,
    errorMessage: taskError.message,
    recentLogLines,
    now,
    ...(userTimezone !== undefined && { userTimezone }),
  });

  const generateResult = await llmClientResult.value.generate(prompt, {
    promptType: 'cooloff-retry',
  });
  if (!generateResult.ok) {
    logger.warn(
      { taskId: task.id, error: generateResult.error, [SKIP_SENTRY_KEY]: true },
      'LLM cooloff call failed; using fallback delay'
    );
    return fallback;
  }

  const parsed = parseCooloffResponse(generateResult.value.content, now);
  if (parsed === null) {
    logger.warn(
      { taskId: task.id, [SKIP_SENTRY_KEY]: true },
      'Cooloff parser rejected LLM response; using fallback delay'
    );
    return fallback;
  }

  logger.info(
    {
      taskId: task.id,
      notBeforeAt: parsed.notBeforeAt.toISOString(),
      timezone: parsed.timezone,
      reason: parsed.reason,
    },
    'Cooloff reset time extracted from LLM'
  );

  return {
    notBeforeAt: parsed.notBeforeAt,
    derivedBy: 'llm' as const,
    ...(parsed.timezone !== undefined && { timezone: parsed.timezone }),
    ...(parsed.sourceText !== undefined && { sourceText: parsed.sourceText }),
  };
}
