/**
 * Use case: Create a review task for automated PR review.
 *
 * Standalone use case — NOT a wrapper around createTaskForPR.
 * Key differences:
 * - No pr-comment label (would route to wrong prompt)
 * - PR-scoped review slot (coalesce queued work; queue a successor behind in-flight work)
 * - Best-effort Linear issue linking for UI grouping
 * - Sets agentType: 'review' on dispatch
 * - systemPromptHash: 'review-auto'
 */

import { err, ok, getErrorMessage, type Result, type Logger } from '@intexuraos/common-core';
import { resolvePlanDocumentPathFromLinearContext } from '@intexuraos/code-task-domain';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { WorkerType } from '../models/codeTask.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';

import { createHmac } from 'node:crypto';
import { Timestamp, type Firestore } from '@google-cloud/firestore';
import { loadConfig } from '../../config.js';
import type { AutomationLog } from '../ports/automationLog.js';
import {
  buildReviewTaskId,
  buildReviewTaskSlotPath,
  reserveReviewTask,
  type ReviewPromptPriority,
} from './reserveReviewTask.js';
import { updatePRTitleWithLinearTag } from '../utils/updatePRTitleWithLinearTag.js';
import { extractIntIssueId, extractLinearIdentifierFromText } from '../utils/linearIdentifierParser.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';

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
  code: 'user_not_found' | 'no_workers_configured' | 'task_creation_failed' | 'dispatch_failed' | 'queue_full' | 'internal_error' | 'pr_branch_unavailable';
  message: string;
  taskId?: string;
}

export interface CreateReviewTaskResult { status: 'created' | 'queued'; taskId: string; workerType: WorkerType }

export interface CreateReviewTaskDeps {
  logger: Logger;
  firestore: Firestore;
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
  gitHubPRSummaryRepo?: GitHubPRSummaryRepository;
}

interface ResolvedLinearIssue {
  identifier?: string;
  createdDescription?: string;
}

const REVIEW_LINEAR_PREPARATION_TIMEOUT_MS = 10 * 60 * 1000;

async function resolveExistingLinearIssueId(
  deps: Pick<CreateReviewTaskDeps, 'logger' | 'codeTaskRepo'>,
  request: CreateReviewTaskRequest,
): Promise<ResolvedLinearIssue> {
  const { logger, codeTaskRepo } = deps;
  const { repository, prNumber, prTitle } = request;

  // Tier 1: Find existing task for this PR
  const existingResult = await codeTaskRepo.findByPR(repository, prNumber);
  if (existingResult.ok) {
    const existingTask = existingResult.value; // @allow-result-access -- narrowed by existingResult.ok
    if (existingTask?.linearIssueId !== undefined) {
      logger.info({ linearIssueId: existingTask.linearIssueId, prNumber }, 'Copied linearIssueId from existing PR task');
      return { identifier: existingTask.linearIssueId };
    }
  } else {
    logger.warn({ error: existingResult.error, prNumber }, 'Failed to look up existing PR task for Linear linking');
  }

  // Tier 2a: Extract INT-XXX from PR title
  const titleIssueId = extractIntIssueId(prTitle);
  if (titleIssueId !== null) {
    logger.info({ linearIssueId: titleIssueId, prNumber }, 'Extracted linearIssueId from PR title');
    return { identifier: titleIssueId };
  }

  // Tier 2b: Extract INT-XXX from PR body
  const { prBody } = request;
  const bodyIssueId = extractIntIssueId(prBody);
  if (bodyIssueId !== null) {
    logger.info({ linearIssueId: bodyIssueId, prNumber }, 'Extracted linearIssueId from PR body');
    return { identifier: bodyIssueId };
  }

  // Tier 2c: Extract from Linear URL in PR body
  if (prBody !== undefined) {
    const linearUrlId = extractLinearIdentifierFromText(prBody);
    if (linearUrlId !== null) {
      logger.info({ linearIssueId: linearUrlId, prNumber }, 'Extracted linearIssueId from Linear URL in PR body');
      return { identifier: linearUrlId };
    }
  }

  return {};
}

async function createLinearIssueForReview(
  deps: Pick<CreateReviewTaskDeps, 'logger'> & { linearAgentClient: LinearAgentClient },
  request: CreateReviewTaskRequest,
  userId: string,
): Promise<Result<ResolvedLinearIssue, string>> {
  const { logger, linearAgentClient } = deps;
  const { repository, prNumber, prTitle } = request;
  const titleContext = buildTitleContext(request);
  const titleResult = await linearAgentClient.generateTitle({ userId, description: titleContext });

  let title: string;
  if (titleResult.ok) {
    title = titleResult.value.title; // @allow-result-access -- narrowed by titleResult.ok
    logger.info({ title, issueType: titleResult.value.issueType, prNumber }, 'Generated review issue title via LLM');
  } else {
    title = prTitle !== undefined
      ? `[Review] PR #${String(prNumber)}: ${prTitle}`
      : `[Review] PR #${String(prNumber)} in ${repository}`;
    logger.warn({ error: titleResult.error, prNumber }, 'LLM title generation failed, using fallback title');
  }

  const description = buildLinearIssueDescription(request);
  const createResult = await linearAgentClient.createIssue({
    userId,
    title,
    description,
    idempotencyKey: `review:${buildReviewTaskSlotPath(repository, prNumber, userId)}`,
  });
  if (createResult.ok) {
    const created = createResult.value; // @allow-result-access -- narrowed by createResult.ok
    logger.info({ linearIssueId: created.issueIdentifier, prNumber }, 'Created new Linear issue for review task');
    return ok({ identifier: created.issueIdentifier, createdDescription: description });
  }

  logger.warn({ error: createResult.error, prNumber }, 'Failed to create Linear issue for review task');
  return err(createResult.error.message);
}

const PR_BODY_MAX_LENGTH = 500;
const ISSUE_DESCRIPTION_MAX_LENGTH = 4000;

function truncatePrBody(prBody: string): string {
  return prBody.length > PR_BODY_MAX_LENGTH
    ? `${prBody.slice(0, PR_BODY_MAX_LENGTH)}...`
    : prBody;
}

function buildTitleContext(request: CreateReviewTaskRequest): string {
  const { repository, prNumber, prTitle, prBody, reviewTypes } = request;
  const lines: string[] = [];

  const suffix = prTitle !== undefined ? `: ${prTitle}` : '';
  lines.push(`Review PR #${String(prNumber)} in ${repository}${suffix}`);

  if (prBody !== undefined) {
    lines.push('', truncatePrBody(prBody));
  }

  lines.push('', `Review focus: ${reviewTypes.join(', ')}`);
  return lines.join('\n');
}

function buildLinearIssueDescription(request: CreateReviewTaskRequest): string {
  const { repository, prNumber, prTitle, prBody, reviewTypes, reviewComment } = request;
  const lines: string[] = [];

  if (prTitle !== undefined) {
    lines.push(`## PR Review: ${prTitle}`, '');
  }

  if (prBody !== undefined) {
    lines.push(truncatePrBody(prBody), '');
  }

  lines.push('---', '');
  lines.push(`**Pull Request:** #${String(prNumber)} in ${repository}`);
  lines.push(`**Review focus:** ${reviewTypes.join(', ')}`);

  if (reviewComment !== undefined) {
    lines.push('', '**Review requested:**', reviewComment);
  }

  lines.push('', '*Review created automatically by code-agent*');
  return lines.join('\n');
}

function buildReviewPrompt(request: CreateReviewTaskRequest & {
  workerType: WorkerType;
  issueDescription?: string;
  planDocumentPath?: string;
  reReviewCommitSha?: string;
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
      '**CRITICAL: Verify every requirement below against the PR implementation.**',
      'Missing or partially implemented requirements are 🔴 findings.',
      '',
      request.issueDescription.length > ISSUE_DESCRIPTION_MAX_LENGTH
        ? `${request.issueDescription.slice(0, ISSUE_DESCRIPTION_MAX_LENGTH)}...\n\n(Truncated — full description available in the Linear issue)`
        : request.issueDescription,
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

  if (request.reReviewCommitSha !== undefined) {
    lines.push('', '## Re-review Context', '');

    if (reviewComment !== undefined) {
      lines.push(
        'This is a re-review for this PR. Focus on the user\'s specific request in the review comment below.',
        `The prior review commit SHA (${request.reReviewCommitSha}) and commit range (${request.reReviewCommitSha}..HEAD) are helpful context only.`,
        '',
        '### Re-review Guidance',
        'Review the full PR while prioritizing the user\'s specific request.',
      );
    } else {
      lines.push(
        'This is a re-review for this PR. Review the full PR scope.',
        `The PR was previously reviewed up to commit ${request.reReviewCommitSha}.`,
        `Prior review context: ${request.reReviewCommitSha}..HEAD.`,
      );
    }

    lines.push(
      '',
      'IMPORTANT: Do NOT re-flag findings from the previous review unless they',
      'are still present in the code you are reviewing. If a finding was flagged',
      'before and the relevant code has not changed in the diff, assume it is',
      'being tracked separately and do not treat it as a new finding. Use the',
      'prior review as context, but keep the current review aligned to the',
      'request and scope described above.',
    );
  }

  return lines.join('\n');
}

export async function createReviewTask(
  deps: CreateReviewTaskDeps,
  request: CreateReviewTaskRequest
): Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>> {
  const { logger, codeTaskRepo, userLookupService, linearAgentClient, orchestratorSecret, workerSettingsRepo } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, reviewTypes: request.reviewTypes, eventId },
    'Creating review task'
  );

  // Resolve requested worker type before building the successor candidate.
  // Existing queued reviews are selected authoritatively inside reserveReviewTask's
  // Firestore transaction so this path cannot race an in-flight dispatch.
  const requestedWorkerType = request.workerType ?? 'auto';

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

  const parsed = parseOwnerRepo(repository);
  const prBranchPromise = (async (): Promise<{
    headBranch?: string;
    baseBranch?: string;
    headSha?: string;
  }> => {
    if (parsed === null) return {};
    const token = await fetchGitHubToken(deps.userServiceClient, userId, logger);
    if (token === null) return {};
    const detailsResult = await deps.gitHubPRClient.getPullRequestDetails(
      token,
      parsed.owner,
      parsed.repo,
      prNumber,
    );
    if (!detailsResult.ok) return {};
    return {
      headBranch: detailsResult.value.headBranch,
      baseBranch: detailsResult.value.baseBranch,
      headSha: detailsResult.value.headSha,
    };
  })().catch((error: unknown): {
    headBranch?: string;
    baseBranch?: string;
    headSha?: string;
  } => {
    logger.warn({ error, prNumber }, 'PR branch resolution failed (best-effort)');
    return {};
  });

  // Run re-review detection and read-only Linear issue linking in parallel.
  const reReviewPromise = (async (): Promise<string | undefined> => {
    if (deps.gitHubPRSummaryRepo === undefined) return undefined;
    try {
      const summaryResult = await deps.gitHubPRSummaryRepo.findByPullRequest(repository, prNumber);
      if (summaryResult.ok && summaryResult.value !== null && summaryResult.value.lastReviewedCommitSha !== null) {
        logger.info({ repository, prNumber, lastReviewedCommitSha: summaryResult.value.lastReviewedCommitSha }, 'Detected re-review — prior review commit found');
        return summaryResult.value.lastReviewedCommitSha;
      }
    } catch (error: unknown) {
      logger.warn({ error, repository, prNumber }, 'Failed to fetch PR summary for re-review detection (best-effort)');
    }
    return undefined;
  })();

  const linearPromise = (async (): Promise<{ linearIssueId?: string }> => {
    if (linearAgentClient === undefined) return {};
    try {
      const resolved = await resolveExistingLinearIssueId(
        { logger, codeTaskRepo },
        request,
      );
      return {
        ...(resolved.identifier !== undefined && { linearIssueId: resolved.identifier }),
      };
    } catch (error: unknown) {
      logger.warn({ error, prNumber }, 'Unexpected error resolving existing Linear issue for review task');
      deps.automationLog.record(
        { repository, prNumber },
        { type: 'linear_issue_failed', error: getErrorMessage(error, 'Unknown error') },
        userId,
      ).catch((logError: unknown) => {
        logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
      });
    }
    return {};
  })();

  const [reReviewCommitSha, { linearIssueId }, resolvedPrBranches] = await Promise.all([
    reReviewPromise,
    linearPromise,
    prBranchPromise,
  ]);

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
      }
    } catch (error: unknown) {
      logger.warn({ error, linearIssueId }, 'Failed to fetch issue description for review context');
    }

    if (issueDescription !== undefined) {
      // v1: description-only — comment-based plan refs deferred
      planDocumentPath = resolvePlanDocumentPathFromLinearContext({
        description: issueDescription,
        comments: [],
      });
    }
  }

  // Create task
  const prompt = buildReviewPrompt({
    ...request,
    workerType: effectiveWorkerType,
    ...(issueDescription !== undefined && { issueDescription }),
    ...(planDocumentPath !== undefined && { planDocumentPath }),
    ...(reReviewCommitSha !== undefined && { reReviewCommitSha }),
  });
  const webhookSecret = createHmac('sha256', orchestratorSecret).update(eventId).digest('hex');

  const baseBranch = resolvedPrBranches.baseBranch ?? request.baseBranch ?? 'main';

  if (resolvedPrBranches.headBranch === undefined) {
    logger.error({ repository, prNumber }, 'Cannot create review task: PR head branch resolution failed');
    return err({ code: 'pr_branch_unavailable', message: `Failed to resolve head branch for PR #${String(prNumber)}` });
  }

  const promptPriority: ReviewPromptPriority = request.reviewComment !== undefined
    ? 'review_comment'
    : issueDescription !== undefined
      ? 'linear_context'
      : 'ordinary';
  const linearIssueCreationPending = linearAgentClient !== undefined && linearIssueId === undefined;
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
    prBranch: resolvedPrBranches.headBranch,
    reviewTypes: request.reviewTypes,
    ...(resolvedPrBranches.headSha !== undefined && {
      reviewCommitSha: resolvedPrBranches.headSha,
    }),
    ...(linearIssueCreationPending && {
      dispatchSchedule: {
        notBeforeAt: Timestamp.fromMillis(Date.now() + REVIEW_LINEAR_PREPARATION_TIMEOUT_MS),
        source: 'retry_cooloff',
        derivedBy: 'fallback',
        derivedFromTaskId: buildReviewTaskId(eventId),
      },
    }),
  };

  const reservationResult = await reserveReviewTask(
    { firestore: deps.firestore, codeTaskRepo },
    {
      repository,
      prNumber,
      eventId,
      taskInput,
      promptPriority,
      maxQueueSize: loadConfig().queue.maxSize,
    },
  );
  if (!reservationResult.ok) {
    logger.error({ error: reservationResult.error }, 'Failed to reserve review task');
    if (reservationResult.error.code === 'QUEUE_FULL') {
      return err({ code: 'queue_full', message: reservationResult.error.message });
    }
    return err({ code: 'task_creation_failed', message: reservationResult.error.message });
  }

  let { task } = reservationResult.value; // @allow-result-access -- narrowed by !reservationResult.ok
  const { created } = reservationResult.value;

  if (
    task.status === 'failed'
    || task.status === 'interrupted'
    || task.status === 'cancelled'
    || task.status === 'archived'
  ) {
    return err({
      code: 'task_creation_failed',
      message: `Existing review task is ${task.status}`,
      taskId: task.id,
    });
  }

  if (
    linearIssueCreationPending
    && task.status === 'queued'
    && (created || task.id === buildReviewTaskId(eventId))
  ) {
    let finalizedLinearIssueId: string | undefined;
    let finalizedIssueDescription: string | undefined;
    try {
      const createLinearResult = await createLinearIssueForReview(
        { logger, linearAgentClient },
        request,
        userId,
      );
      if (createLinearResult.ok) {
        finalizedLinearIssueId = createLinearResult.value.identifier;
        finalizedIssueDescription = createLinearResult.value.createdDescription;
      } else {
        deps.automationLog.record(
          { repository, prNumber },
          { type: 'linear_issue_failed', error: createLinearResult.error },
          userId,
        ).catch((logError: unknown) => {
          logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
        });
      }
    } catch (error: unknown) {
      logger.warn({ error, prNumber }, 'Unexpected error creating Linear issue for review task');
      deps.automationLog.record(
        { repository, prNumber },
        { type: 'linear_issue_failed', error: getErrorMessage(error, 'Unknown error') },
        userId,
      ).catch((logError: unknown) => {
        logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
      });
    }

    const finalizedPlanDocumentPath = finalizedIssueDescription === undefined
      ? undefined
      : resolvePlanDocumentPathFromLinearContext({
        description: finalizedIssueDescription,
        comments: [],
      });
    const finalizedPrompt = buildReviewPrompt({
      ...request,
      workerType: effectiveWorkerType,
      ...(finalizedIssueDescription !== undefined && {
        issueDescription: finalizedIssueDescription,
      }),
      ...(finalizedPlanDocumentPath !== undefined && {
        planDocumentPath: finalizedPlanDocumentPath,
      }),
      ...(reReviewCommitSha !== undefined && { reReviewCommitSha }),
    });
    const finalizedTaskInput: CreateTaskInput = {
      ...taskInput,
      prompt: finalizedPrompt,
      sanitizedPrompt: finalizedPrompt,
      ...(finalizedLinearIssueId !== undefined && {
        linearIssueId: finalizedLinearIssueId,
      }),
      dispatchSchedule: {
        notBeforeAt: Timestamp.now(),
        source: 'retry_cooloff',
        derivedBy: 'fallback',
        derivedFromTaskId: task.id,
      },
    };
    const finalizedReservation = await reserveReviewTask(
      { firestore: deps.firestore, codeTaskRepo },
      {
        repository,
        prNumber,
        eventId,
        taskInput: finalizedTaskInput,
        promptPriority: request.reviewComment !== undefined
          ? 'review_comment'
          : finalizedIssueDescription !== undefined
            ? 'linear_context'
            : 'ordinary',
        maxQueueSize: loadConfig().queue.maxSize,
      },
    );
    if (!finalizedReservation.ok) {
      logger.error(
        { error: finalizedReservation.error, taskId: task.id },
        'Failed to finalize reserved review task',
      );
      return err({
        code: 'task_creation_failed',
        message: finalizedReservation.error.message,
        taskId: task.id,
      });
    }
    task = finalizedReservation.value.task;
  }

  if (!created) {
    logger.info(
      { taskId: task.id, repository, prNumber, eventId },
      'Review request coalesced into an existing task slot',
    );
    return ok({
      status: 'queued',
      taskId: task.id,
      workerType: task.workerType,
    });
  }

  logger.info(
    { taskId: task.id, repository, prNumber, reviewTypes: request.reviewTypes, owner: parsed?.owner },
    'Review task created and admitted to the queue atomically'
  );

  // Best-effort: update PR title with Linear issue tag
  const titleAlreadyTagged = extractIntIssueId(request.prTitle) !== null;
  await updatePRTitleWithLinearTag(deps, {
    repository, prNumber, userId,
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    ...(request.prTitle !== undefined && { prTitle: request.prTitle }),
    titleAlreadyTagged,
  });

  deps.automationLog.record(
    { repository, prNumber },
    {
      type: 'task_dispatched',
      taskId: task.id,
      workerType: task.workerType,
      agentType: 'review',
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    },
    userId,
  ).catch((error: unknown) => {
    logger.warn({ error, taskId: task.id }, 'Failed to record automation log for review task dispatch');
  });

  return ok({ status: 'queued' as const, taskId: task.id, workerType: task.workerType });
}
