/**
 * Use case: Create a review task for automated PR review.
 *
 * Standalone use case — NOT a wrapper around createTaskForPR.
 * Key differences:
 * - No pr-comment label (would route to wrong prompt)
 * - PR-scoped review dedup (reuse active review task for the same PR)
 * - Best-effort Linear issue linking for UI grouping
 * - Sets agentType: 'review' on dispatch
 * - systemPromptHash: 'review-auto'
 */

import { err, ok, getErrorMessage, resolvePlanDocumentPathFromLinearContext, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { WorkerType } from '../models/codeTask.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';

import { createHmac } from 'node:crypto';
import type { AutomationLog } from '../ports/automationLog.js';
import { updatePRTitleWithLinearTag } from '../utils/updatePRTitleWithLinearTag.js';
import { extractIntIssueId, extractLinearIdentifierFromText } from '../utils/linearIdentifierParser.js';

export interface CreateReviewTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  reviewTypes: string[];
  workerType?: WorkerType;
  eventId: string;
  prTitle?: string;
  prBody?: string;
  reviewComment?: string;
  baseBranch?: string;
}

export interface CreateReviewTaskError {
  code: 'user_not_found' | 'no_workers_configured' | 'task_creation_failed' | 'dispatch_failed' | 'queue_full' | 'internal_error';
  message: string;
  taskId?: string;
}

export interface CreateReviewTaskResult { status: 'created' | 'queued'; taskId: string; workerType: WorkerType }

export interface CreateReviewTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  userLookupService: UserLookupService;
  taskDispatcher: TaskDispatcherService;
  taskEnqueueService: TaskEnqueueService;
  linearAgentClient?: LinearAgentClient;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  automationLog: AutomationLog;
}

async function resolveLinearIssueId(
  deps: Pick<CreateReviewTaskDeps, 'logger' | 'codeTaskRepo'> & { linearAgentClient: LinearAgentClient },
  request: CreateReviewTaskRequest,
  userId: string,
): Promise<Result<string | undefined, string>> {
  const { logger, codeTaskRepo, linearAgentClient } = deps;
  const { repository, prNumber, prTitle } = request;

  // Tier 1: Find existing task for this PR
  const existingResult = await codeTaskRepo.findByPR(repository, prNumber);
  if (existingResult.ok) {
    const existingTask = existingResult.value; // @allow-result-access -- narrowed by existingResult.ok
    if (existingTask?.linearIssueId !== undefined) {
      logger.info({ linearIssueId: existingTask.linearIssueId, prNumber }, 'Copied linearIssueId from existing PR task');
      return ok(existingTask.linearIssueId);
    }
  } else {
    logger.warn({ error: existingResult.error, prNumber }, 'Failed to look up existing PR task for Linear linking');
  }

  // Tier 2a: Extract INT-XXX from PR title
  const titleIssueId = extractIntIssueId(prTitle);
  if (titleIssueId !== null) {
    logger.info({ linearIssueId: titleIssueId, prNumber }, 'Extracted linearIssueId from PR title');
    return ok(titleIssueId);
  }

  // Tier 2b: Extract INT-XXX from PR body
  const { prBody } = request;
  const bodyIssueId = extractIntIssueId(prBody);
  if (bodyIssueId !== null) {
    logger.info({ linearIssueId: bodyIssueId, prNumber }, 'Extracted linearIssueId from PR body');
    return ok(bodyIssueId);
  }

  // Tier 2c: Extract from Linear URL in PR body
  if (prBody !== undefined) {
    const linearUrlId = extractLinearIdentifierFromText(prBody);
    if (linearUrlId !== null) {
      logger.info({ linearIssueId: linearUrlId, prNumber }, 'Extracted linearIssueId from Linear URL in PR body');
      return ok(linearUrlId);
    }
  }

  // Tier 3: Create new Linear issue
  const title = prTitle !== undefined
    ? `[Review] PR #${String(prNumber)}: ${prTitle}`
    : `[Review] PR #${String(prNumber)} in ${repository}`;
  const description = buildLinearIssueDescription(request);
  const createResult = await linearAgentClient.createIssue({ userId, title, description });
  if (createResult.ok) {
    const created = createResult.value; // @allow-result-access -- narrowed by createResult.ok
    logger.info({ linearIssueId: created.issueIdentifier, prNumber }, 'Created new Linear issue for review task');
    return ok(created.issueIdentifier);
  }

  logger.warn({ error: createResult.error, prNumber }, 'Failed to create Linear issue for review task');
  return err(createResult.error.message);
}

const PR_BODY_MAX_LENGTH = 500;

function buildLinearIssueDescription(request: CreateReviewTaskRequest): string {
  const { repository, prNumber, prBody, reviewTypes, reviewComment } = request;
  const lines: string[] = [
    'Automated PR review created by GitHub Agent triage system.',
    '',
    `**Pull Request:** #${String(prNumber)} in ${repository}`,
  ];

  if (prBody !== undefined) {
    const truncated = prBody.length > PR_BODY_MAX_LENGTH
      ? `${prBody.slice(0, PR_BODY_MAX_LENGTH)}...`
      : prBody;
    lines.push('', '**PR Description:**', truncated);
  }

  lines.push('', `**Review types:** ${reviewTypes.join(', ')}`);
  if (reviewComment !== undefined) {
    lines.push('', '**Triggered by comment:**', reviewComment);
  }

  return lines.join('\n');
}

function buildReviewPrompt(request: CreateReviewTaskRequest & {
  workerType: WorkerType;
  issueDescription?: string;
  planDocumentPath?: string;
}): string {
  const { repository, prNumber, reviewTypes, workerType, reviewComment } = request;
  const lines = [
    `[Review Task] Automated PR review for PR #${String(prNumber)} in ${repository}`,
    '',
    `Review types requested: ${reviewTypes.join(', ')}`,
    `Worker type requested: ${workerType}`,
    '',
    'This task was created automatically by the GitHub Agent triage system.',
    `Perform a read-only review of PR #${String(prNumber)} and post review comments.`,
    '',
  ];

  if (reviewComment !== undefined) {
    lines.push('Triggered by review request comment:', reviewComment, '');
  }

  lines.push(
    '### Review Scope',
    '',
    ...reviewTypes.map((t) => `- **${t}**: perform ${t} review`),
    '',
    '### Instructions',
    '',
    `1. Fetch the PR: gh pr view ${String(prNumber)} --json title,body,baseRefName,headRefName,files`,
    `2. Fetch the diff: gh pr diff ${String(prNumber)}`,
    `3. Read changed files and analyze for the requested review types`,
    `4. Post review comments via gh api /repos/${repository}/pulls/${String(prNumber)}/reviews`,
    '5. Output REVIEW_AGENT_FINAL block when done',
  );

  if (request.issueDescription !== undefined) {
    lines.push(
      '',
      '### Issue Requirements',
      '',
      'The following is the Linear issue description. This defines what the implementation must achieve.',
      '',
      request.issueDescription,
    );

    if (request.planDocumentPath !== undefined) {
      lines.push(
        '',
        '### Plan Document',
        '',
        `Plan file path: ${request.planDocumentPath}`,
      );
    }
  }

  return lines.join('\n');
}

export async function createReviewTask(
  deps: CreateReviewTaskDeps,
  request: CreateReviewTaskRequest
): Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>> {
  const { logger, codeTaskRepo, userLookupService, taskDispatcher, taskEnqueueService, linearAgentClient, orchestratorSecret, workerSettingsRepo } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, reviewTypes: request.reviewTypes, eventId },
    'Creating review task'
  );

  const activeReviewResult = await codeTaskRepo.findActiveReviewForPR(repository, prNumber);
  if (!activeReviewResult.ok) {
    logger.error(
      { repository, prNumber, error: activeReviewResult.error },
      'Failed to check for active review task'
    );
    return err({ code: 'task_creation_failed', message: activeReviewResult.error.message });
  }

  // Resolve requested worker type for early logging
  const requestedWorkerType = request.workerType ?? 'auto';

  if (activeReviewResult.value !== null) {
    const existingTask = activeReviewResult.value;
    logger.info(
      { repository, prNumber, taskId: existingTask.id, requestedWorkerType },
      'Active review task exists for PR, replacing with fresh review'
    );

    deps.automationLog.record(
      { repository, prNumber },
      {
        type: 'review_replaced',
        replacedTaskId: existingTask.id,
        replacedWorkerType: existingTask.workerType,
      },
      existingTask.userId,
    ).catch((error: unknown) => {
      logger.warn({ error, taskId: existingTask.id }, 'Failed to record automation log for review replacement');
    });

    // Cancel the old task locally (authoritative)
    const cancelResult = await codeTaskRepo.update(existingTask.id, {
      status: 'cancelled',
      completedAt: new Date(),
      error: {
        code: 'review_replaced',
        message: 'Review task was cancelled because a fresh review was requested',
      },
    });

    if (!cancelResult.ok) {
      logger.error(
        { taskId: existingTask.id, error: cancelResult.error },
        'Failed to cancel existing review task - aborting replacement'
      );
      return err({ code: 'task_creation_failed', message: 'Failed to cancel existing review task' });
    }

    // Best-effort: notify worker to cancel
    try {
      const settingsResult = await workerSettingsRepo.getSettings(existingTask.userId);
      if (settingsResult.ok && settingsResult.value !== null) {
        const settings = settingsResult.value;
        const workerConfig = settings.workers.find((w) => w.name === existingTask.workerLocation);
        if (workerConfig?.enabled === true) {
          await taskDispatcher.cancelOnWorker(existingTask.id, existingTask.workerLocation, {
            url: workerConfig.url,
            cfAccessClientId: workerConfig.cfAccessClientId,
            cfAccessClientSecret: workerConfig.cfAccessClientSecret,
          });
        }
      }
    } catch (error) {
      logger.warn({ taskId: existingTask.id, error }, 'Worker cancellation failed (best-effort)');
    }

    // Continue with creating a new review task (fall through to normal creation flow)
  }

  // Resolve user
  const userResult = await userLookupService.resolveByGitHubUsername(senderLogin);
  if (!userResult.ok) {
    const errorCode = userResult.error.code;
    logger.warn({ senderLogin, error: userResult.error }, 'Failed to resolve user for review task');
    return err({
      code: errorCode === 'NO_ENABLED_WORKER' ? 'no_workers_configured' : 'user_not_found',
      message: userResult.error.message,
    });
  }

  const { userId } = userResult.value; // @allow-result-access -- narrowed by !userResult.ok

  // Resolution chain: explicit request > user setting > 'auto'
  let effectiveWorkerType: WorkerType = requestedWorkerType;
  if (request.workerType === undefined) {
    const settingsResult = await workerSettingsRepo.getSettings(userId);
    if (settingsResult.ok && settingsResult.value?.defaultReviewWorkerType !== undefined) {
      effectiveWorkerType = settingsResult.value.defaultReviewWorkerType;
      logger.info({ userId, defaultReviewWorkerType: effectiveWorkerType }, 'Using user default review worker type');
    }
  }

  // Best-effort Linear issue linking for UI grouping
  let linearIssueId: string | undefined;
  if (linearAgentClient !== undefined) {
    try {
      const linearResult = await resolveLinearIssueId({ logger, codeTaskRepo, linearAgentClient }, request, userId);
      if (linearResult.ok) {
        linearIssueId = linearResult.value; // @allow-result-access -- narrowed by linearResult.ok
      } else {
        deps.automationLog.record(
          { repository, prNumber },
          { type: 'linear_issue_failed', error: linearResult.error },
          userId,
        ).catch((logError: unknown) => {
          logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
        });
      }
    } catch (error: unknown) {
      logger.warn({ error, prNumber }, 'Unexpected error resolving Linear issue for review task');
      deps.automationLog.record(
        { repository, prNumber },
        { type: 'linear_issue_failed', error: getErrorMessage(error, 'Unknown error') },
        userId,
      ).catch((logError: unknown) => {
        logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
      });
    }
  }

  // Best-effort: fetch issue description for review requirements context
  let issueDescription: string | undefined;
  let planDocumentPath: string | undefined;
  if (linearIssueId !== undefined && linearAgentClient !== undefined) {
    try {
      const descResult = await linearAgentClient.getIssueDescription({
        userId,
        identifier: linearIssueId,
      });
      if (descResult.ok) {
        issueDescription = descResult.value;
        if (issueDescription !== undefined) {
          planDocumentPath = resolvePlanDocumentPathFromLinearContext({
            description: issueDescription,
            comments: [],
          });
        }
      }
    } catch (error: unknown) {
      logger.warn({ error, linearIssueId }, 'Failed to fetch issue description for review context');
    }
  }

  // Create task
  const prompt = buildReviewPrompt({
    ...request,
    workerType: effectiveWorkerType,
    ...(issueDescription !== undefined && { issueDescription }),
    ...(planDocumentPath !== undefined && { planDocumentPath }),
  });
  const webhookSecret = createHmac('sha256', orchestratorSecret).update(eventId).digest('hex');

  const [owner] = repository.split('/');
  const baseBranch = request.baseBranch ?? 'main';

  const taskInput: CreateTaskInput = {
    userId,
    prompt,
    sanitizedPrompt: prompt,
    systemPromptHash: 'review-auto',
    workerType: effectiveWorkerType,
    workerLocation: 'queued',
    repository,
    baseBranch,
    traceId: eventId,
    webhookSecret,
    prNumber,
    agentType: 'review',
    ...(linearIssueId !== undefined && { linearIssueId }),
  };

  const createResult = await codeTaskRepo.create(taskInput);
  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create review task');
    return err({ code: 'task_creation_failed', message: createResult.error.message });
  }

  const task = createResult.value; // @allow-result-access -- narrowed by !createResult.ok

  // Enqueue for dispatch
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    const enqueueError = enqueueResult.error;
    logger.error({ taskId: task.id, error: enqueueError }, 'Failed to enqueue review task');

    // TaskEnqueueService already marks the task as failed for queue_full
    if (enqueueError.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueError.message, taskId: task.id });
    }
    return err({ code: 'internal_error', message: enqueueError.message, taskId: task.id });
  }

  logger.info(
    { taskId: task.id, repository, prNumber, reviewTypes: request.reviewTypes, owner, queuePosition: enqueueResult.value.queuePosition },
    'Review task created and enqueued'
  );

  // Best-effort: update PR title with Linear issue tag
  const titleAlreadyTagged = extractIntIssueId(request.prTitle) !== null;
  await updatePRTitleWithLinearTag(deps, {
    repository, prNumber, userId,
    ...(linearIssueId !== undefined && { linearIssueId }),
    ...(request.prTitle !== undefined && { prTitle: request.prTitle }),
    titleAlreadyTagged,
  });

  deps.automationLog.record(
    { repository, prNumber },
    {
      type: 'task_dispatched',
      taskId: task.id,
      workerType: effectiveWorkerType,
      agentType: 'review',
      ...(linearIssueId !== undefined && { linearIssueId }),
    },
    userId,
  ).catch((error: unknown) => {
    logger.warn({ error, taskId: task.id }, 'Failed to record automation log for review task dispatch');
  });

  return ok({ status: 'queued' as const, taskId: task.id, workerType: effectiveWorkerType });
}

