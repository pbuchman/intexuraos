/**
 * Use case: Create a remediation task for addressing review feedback.
 *
 * Standalone use case — creates a fresh container with purpose-built prompt.
 * Key differences from createReviewTask:
 * - No dedup behavior (multiple remediation tasks can coexist)
 * - Linear issue linking from existing execution task only
 * - Purpose-built remediation prompt with review findings
 * - agentType: 'remediation'
 * - systemPromptHash: 'remediation-auto'
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { WorkerType } from '../models/codeTask.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { AutomationLog } from '../ports/automationLog.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { sanitizePrompt } from '../utils/promptSanitization.js';

export interface CreateRemediationTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  workerType: WorkerType;
  eventId: string;
  triggerComment?: { body: string; author: string };
  reviewBody?: string;
  inlineComments?: { path: string; line: number; body: string }[];
  linearIssueId?: string;
  baseBranch?: string;
}

export interface CreateRemediationTaskError {
  code: 'user_not_found' | 'no_workers_configured' | 'task_creation_failed' | 'dispatch_failed' | 'queue_full' | 'internal_error';
  message: string;
  taskId?: string;
}

export interface CreateRemediationTaskResult {
  status: 'queued';
  taskId: string;
  workerType: WorkerType;
}

export interface CreateRemediationTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  userLookupService: UserLookupService;
  taskEnqueueService: TaskEnqueueService;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  automationLog: AutomationLog;
}

function buildRemediationPrompt(request: CreateRemediationTaskRequest): string {
  const { repository, prNumber, workerType, reviewBody, inlineComments, triggerComment } = request;
  const lines = [
    `[Remediation Task] Fix review findings for PR #${String(prNumber)} in ${repository}`,
    '',
    `Worker type: ${workerType}`,
    '',
    'This task was created automatically to address review feedback.',
    'You are working in a fresh container — do not assume any prior context.',
    '',
  ];

  if (triggerComment !== undefined) {
    lines.push(
      '### Trigger Comment',
      '',
      `**Author:** ${triggerComment.author}`,
      triggerComment.body,
      '',
    );
  }

  if (reviewBody !== undefined) {
    lines.push(
      '### Review Findings',
      '',
      reviewBody,
      '',
    );
  }

  if (inlineComments !== undefined && inlineComments.length > 0) {
    lines.push('### Inline Comments', '');
    for (const comment of inlineComments) {
      lines.push(`- **${comment.path}:${String(comment.line)}**: ${comment.body}`);
    }
    lines.push('');
  }

  lines.push(
    '### Instructions',
    '',
    '1. Fetch the PR and review the findings above',
    `2. For each finding: implement the fix OR document why it is out of scope`,
    '3. Run CI: `pnpm run ci:tracked` and verify all checks pass',
    `4. Push changes to the PR branch`,
    '5. Output a summary of what was fixed and what was skipped',
    '',
    '### Constraints',
    '',
    '- Do NOT modify code unrelated to the review findings',
    '- Do NOT expand scope beyond addressing the findings',
    '- Do NOT create new PRs — push to the existing PR branch',
  );

  return lines.join('\n');
}

export async function createRemediationTask(
  deps: CreateRemediationTaskDeps,
  request: CreateRemediationTaskRequest,
): Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>> {
  const { logger, codeTaskRepo, userLookupService, taskEnqueueService, workerSettingsRepo, orchestratorSecret } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;
  const requestedWorkerType = request.workerType;

  logger.info(
    { repository, prNumber, senderLogin, workerType: requestedWorkerType, eventId },
    'Creating remediation task',
  );

  // Resolve user
  const userResult = await userLookupService.resolveByGitHubUsername(senderLogin);
  if (!userResult.ok) {
    const errorCode = userResult.error.code;
    logger.warn({ senderLogin, error: userResult.error }, 'Failed to resolve user for remediation task');
    return err({
      code: errorCode === 'NO_ENABLED_WORKER' ? 'no_workers_configured' : 'user_not_found',
      message: userResult.error.message,
    });
  }

  const { userId } = userResult.value;

  // Resolution chain: user setting > 'auto'
  let effectiveWorkerType: WorkerType = requestedWorkerType;
  if (requestedWorkerType === 'auto') {
    const settingsResult = await workerSettingsRepo.getSettings(userId);
    if (settingsResult.ok && settingsResult.value?.defaultRemediationWorkerType !== undefined) {
      effectiveWorkerType = settingsResult.value.defaultRemediationWorkerType;
      logger.info({ userId, defaultRemediationWorkerType: effectiveWorkerType }, 'Using user default remediation worker type');
    }
  }

  // Best-effort Linear issue linking from existing execution task
  let linearIssueId: string | undefined = request.linearIssueId;
  let prBranch: string | undefined;
  if (linearIssueId === undefined) {
    const existingResult = await codeTaskRepo.findLatestExecutionTaskByPR(repository, prNumber);
    if (existingResult.ok) {
      linearIssueId = existingResult.value?.linearIssueId;
      prBranch = existingResult.value?.prBranch;
      if (linearIssueId !== undefined) {
        logger.info({ linearIssueId, prNumber }, 'Copied linearIssueId from existing execution task for remediation');
      }
      if (prBranch !== undefined) {
        logger.info({ prBranch, prNumber }, 'Copied prBranch from existing execution task for remediation');
      }
    } else {
      logger.warn({ error: existingResult.error, prNumber }, 'Failed to look up existing execution task for remediation Linear linking');
    }
  } else {
    const existingResult = await codeTaskRepo.findLatestExecutionTaskByPR(repository, prNumber);
    if (existingResult.ok) {
      prBranch = existingResult.value?.prBranch;
    } else {
      logger.warn({ error: existingResult.error, prNumber }, 'Failed to look up existing execution task for remediation PR continuation');
    }
  }

  // Build prompt with effective worker type
  const prompt = buildRemediationPrompt({ ...request, workerType: effectiveWorkerType });
  const webhookSecret = generateWebhookSecret(orchestratorSecret, eventId);
  const baseBranch = request.baseBranch ?? 'main';

  const taskInput: CreateTaskInput = {
    userId,
    prompt,
    sanitizedPrompt: sanitizePrompt(prompt),
    systemPromptHash: 'remediation-auto',
    workerType: effectiveWorkerType,
    workerLocation: 'queued',
    repository,
    baseBranch,
    traceId: eventId,
    webhookSecret,
    prNumber,
    agentType: 'remediation',
    ...(linearIssueId !== undefined && { linearIssueId }),
    ...(prBranch !== undefined && { prBranch }),
  };

  const createResult = await codeTaskRepo.create(taskInput);
  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create remediation task');
    return err({ code: 'task_creation_failed', message: createResult.error.message });
  }

  const task = createResult.value;

  // Enqueue for dispatch
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    const enqueueError = enqueueResult.error;
    logger.error({ taskId: task.id, error: enqueueError }, 'Failed to enqueue remediation task');

    if (enqueueError.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueError.message, taskId: task.id });
    }
    return err({ code: 'internal_error', message: enqueueError.message, taskId: task.id });
  }

  logger.info(
    { taskId: task.id, repository, prNumber, workerType: effectiveWorkerType, queuePosition: enqueueResult.value.queuePosition },
    'Remediation task created and enqueued',
  );

  deps.automationLog.record(
    { repository, prNumber },
    {
      type: 'task_dispatched',
      taskId: task.id,
      workerType: effectiveWorkerType,
      agentType: 'remediation',
      ...(linearIssueId !== undefined && { linearIssueId }),
    },
    userId,
  ).catch((error: unknown) => {
    logger.warn({ error, taskId: task.id }, 'Failed to record automation log for remediation task dispatch');
  });

  return ok({ status: 'queued' as const, taskId: task.id, workerType: effectiveWorkerType });
}
