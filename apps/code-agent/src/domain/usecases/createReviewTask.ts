/**
 * Use case: Create a review task for automated PR review.
 *
 * Standalone use case — NOT a wrapper around createTaskForPR.
 * Key differences:
 * - No pr-comment label (would route to wrong prompt)
 * - No PR task lock (review tasks don't conflict with comment tasks)
 * - No LinearIssueService (review tasks are ephemeral)
 * - Sets agentType: 'review' on dispatch
 * - systemPromptHash: 'review-auto'
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import { createHmac } from 'node:crypto';

export interface CreateReviewTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  reviewTypes: string[];
  eventId: string;
  prTitle?: string;
  baseBranch?: string;
}

export interface CreateReviewTaskError {
  code: 'user_not_found' | 'no_workers_configured' | 'task_creation_failed' | 'dispatch_failed' | 'internal_error';
  message: string;
}

export interface CreateReviewTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  userLookupService: UserLookupService;
  taskDispatcher: TaskDispatcherService;
  orchestratorSecret: string;
  serviceUrl: string;
}

function buildReviewPrompt(request: CreateReviewTaskRequest): string {
  const { repository, prNumber, reviewTypes } = request;
  return [
    `[Review Task] Automated PR review for PR #${String(prNumber)} in ${repository}`,
    '',
    `Review types requested: ${reviewTypes.join(', ')}`,
    '',
    'This task was created automatically by the GitHub Agent triage system.',
    `Perform a read-only review of PR #${String(prNumber)} and post review comments.`,
    '',
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
  ].join('\n');
}

export async function createReviewTask(
  deps: CreateReviewTaskDeps,
  request: CreateReviewTaskRequest
): Promise<Result<{ taskId: string }, CreateReviewTaskError>> {
  const { logger, codeTaskRepo, userLookupService, taskDispatcher, orchestratorSecret, serviceUrl } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, reviewTypes: request.reviewTypes, eventId },
    'Creating review task'
  );

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

  const { userId, worker } = userResult.value; // @allow-result-access -- narrowed by !userResult.ok

  // Create task
  const prompt = buildReviewPrompt(request);
  const webhookSecret = createHmac('sha256', orchestratorSecret).update(eventId).digest('hex');

  const [owner] = repository.split('/');
  const baseBranch = request.baseBranch ?? 'main';

  const taskInput: CreateTaskInput = {
    userId,
    prompt,
    sanitizedPrompt: prompt,
    systemPromptHash: 'review-auto',
    workerType: 'auto',
    workerLocation: worker.name,
    repository,
    baseBranch,
    traceId: eventId,
    webhookSecret,
    prNumber,
    agentType: 'review',
  };

  const createResult = await codeTaskRepo.create(taskInput);
  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create review task');
    return err({ code: 'task_creation_failed', message: createResult.error.message });
  }

  const task = createResult.value; // @allow-result-access -- narrowed by !createResult.ok

  // Dispatch
  const webhookUrl = `${serviceUrl}/internal/tasks/${task.id}/callback`;

  const dispatchResult = await taskDispatcher.dispatch({
    taskId: task.id,
    linearIssueLabels: ['code-task'],
    hasChildren: false,
    prompt,
    systemPromptHash: 'review-auto',
    repository,
    baseBranch,
    workerType: 'auto',
    webhookUrl,
    webhookSecret,
    traceId: eventId,
    agentType: 'review',
    workerCredentials: {
      workers: [{
        name: worker.name,
        url: worker.url,
        cfAccessClientId: worker.cfAccessClientId,
        cfAccessClientSecret: worker.cfAccessClientSecret,
        dispatchSigningSecret: worker.dispatchSigningSecret,
      }],
    },
  });

  if (!dispatchResult.ok) {
    logger.error({ taskId: task.id, error: dispatchResult.error }, 'Failed to dispatch review task');
    await codeTaskRepo.update(task.id, {
      status: 'failed',
      error: { code: 'dispatch_failed', message: dispatchResult.error.message },
    });
    return err({ code: 'dispatch_failed', message: dispatchResult.error.message });
  }

  await codeTaskRepo.update(task.id, { status: 'dispatched' });

  logger.info(
    { taskId: task.id, repository, prNumber, reviewTypes: request.reviewTypes, owner },
    'Review task created and dispatched'
  );

  return ok({ taskId: task.id });
}
