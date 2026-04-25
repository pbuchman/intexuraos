/**
 * Use case: Triage a failed task for auto-retry.
 *
 * Orchestrates: classify -> budget check -> (optional user-selected LLM) -> auto-retry or permanent fail.
 *
 * INT-1375: Self-healing failure triage.
 */

import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask, TaskError } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import { classifyFailure } from '../utils/classifyFailure.js';
import { autoRetryTask } from './autoRetryTask.js';
import { buildFailureTriagePrompt, parseTriageResponse } from '../prompts/failureTriagePrompt.js';
import { loadConfig } from '../../config.js';

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
  userServiceClient: Pick<UserServiceClient, 'getLlmClient'>;
  orchestratorSecret: string;
}

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

  // Step 4a: Auto-retry chain attempt cap (INT-1560 Fix D part 2).
  // Checked BEFORE invoking autoRetryTask so persistently failing tasks cannot
  // spawn indefinite retry chains. Default cap is 3 (config.autoRetry.maxAttempts).
  const config = loadConfig();
  const attemptsSoFar = task.autoRetryAttempt ?? 0;
  if (attemptsSoFar >= config.autoRetry.maxAttempts) {
    await whatsappNotifier.notifyTaskAutoRetryExhausted(task.userId, task, {
      attempts: attemptsSoFar,
      errorMessage: taskError.message,
    });
    return {
      action: 'permanent_failure' as const,
      reason: `Auto-retry cap reached after ${String(attemptsSoFar)} attempts (max=${String(config.autoRetry.maxAttempts)})`,
    };
  }

  // Step 4b: Attempt auto-retry
  const retryResult = await autoRetryTask(
    { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier, orchestratorSecret: deps.orchestratorSecret },
    {
      failedTask: task,
      failedWorkerLocation: task.workerLocation,
      reason: `${taskError.code}: ${taskError.message}`.slice(0, 200),
    }
  );

  if (!retryResult.ok) {
    if (retryResult.error.code === 'budget_exhausted') {
      // Send exhausted notification
      await whatsappNotifier.notifyTaskAutoRetryExhausted(task.userId, task, {
        attempts: 3,
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

  const prompt = buildFailureTriagePrompt({
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
