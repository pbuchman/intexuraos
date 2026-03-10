/**
 * Use case: Create a review task for automated PR review.
 *
 * Standalone use case — NOT a wrapper around createTaskForPR.
 * Key differences:
 * - No pr-comment label (would route to wrong prompt)
 * - No PR task lock (review tasks don't conflict with comment tasks)
 * - Best-effort Linear issue linking for UI grouping
 * - Sets agentType: 'review' on dispatch
 * - systemPromptHash: 'review-auto'
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import { createHmac } from 'node:crypto';

export interface CreateReviewTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  reviewTypes: string[];
  eventId: string;
  prTitle?: string;
  prBody?: string;
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
  linearAgentClient?: LinearAgentClient;
  orchestratorSecret: string;
  serviceUrl: string;
}

async function resolveLinearIssueId(
  deps: Pick<CreateReviewTaskDeps, 'logger' | 'codeTaskRepo'> & { linearAgentClient: LinearAgentClient },
  request: CreateReviewTaskRequest,
  userId: string,
): Promise<string | undefined> {
  const { logger, codeTaskRepo, linearAgentClient } = deps;
  const { repository, prNumber, prTitle } = request;

  // Tier 1: Find existing task for this PR
  const existingResult = await codeTaskRepo.findByPR(repository, prNumber);
  if (existingResult.ok) {
    const existingTask = existingResult.value; // @allow-result-access -- narrowed by existingResult.ok
    if (existingTask?.linearIssueId !== undefined) {
      logger.info({ linearIssueId: existingTask.linearIssueId, prNumber }, 'Copied linearIssueId from existing PR task');
      return existingTask.linearIssueId;
    }
  } else {
    logger.warn({ error: existingResult.error, prNumber }, 'Failed to look up existing PR task for Linear linking');
  }

  // Tier 2: Extract INT-XXX from PR title
  const linearIssueMatch = prTitle?.match(/\bINT-(\d+)\b/i);
  if (linearIssueMatch !== null && linearIssueMatch !== undefined) {
    const issueId = `INT-${String(linearIssueMatch[1])}`;
    logger.info({ linearIssueId: issueId, prNumber }, 'Extracted linearIssueId from PR title');
    return issueId;
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
    return created.issueIdentifier;
  }

  logger.warn({ error: createResult.error, prNumber }, 'Failed to create Linear issue for review task');
  return undefined;
}

const PR_BODY_MAX_LENGTH = 500;

function buildLinearIssueDescription(request: CreateReviewTaskRequest): string {
  const { repository, prNumber, prBody, reviewTypes } = request;
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

  return lines.join('\n');
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
  const { logger, codeTaskRepo, userLookupService, taskDispatcher, linearAgentClient, orchestratorSecret, serviceUrl } = deps;
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

  // Best-effort Linear issue linking for UI grouping
  let linearIssueId: string | undefined;
  if (linearAgentClient !== undefined) {
    try {
      linearIssueId = await resolveLinearIssueId({ logger, codeTaskRepo, linearAgentClient }, request, userId);
    } catch (error: unknown) {
      logger.warn({ error, prNumber }, 'Unexpected error resolving Linear issue for review task');
    }
  }

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
    ...(linearIssueId !== undefined && { linearIssueId }),
  };

  const createResult = await codeTaskRepo.create(taskInput);
  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create review task');
    return err({ code: 'task_creation_failed', message: createResult.error.message });
  }

  const task = createResult.value; // @allow-result-access -- narrowed by !createResult.ok

  // Dispatch
  const webhookUrl = `${serviceUrl}/internal/webhooks/task-complete`;

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
    return err({ code: 'dispatch_failed', message: dispatchResult.error.message });
  }

  logger.info(
    { taskId: task.id, repository, prNumber, reviewTypes: request.reviewTypes, owner },
    'Review task created and dispatched'
  );

  return ok({ taskId: task.id });
}
