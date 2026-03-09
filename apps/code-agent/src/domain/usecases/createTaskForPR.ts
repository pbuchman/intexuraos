/**
 * Use case: Create a code task from a PR comment when no task exists.
 *
 * This handles the case where a PR comment arrives but there's no existing
 * code task for that PR. It creates a new task and dispatches it.
 *
 * Key features:
 * - Resolves GitHub username to userId via UserLookupService
 * - Transaction guard prevents duplicate task creation from concurrent comments
 * - Auto-creates Linear issue from PR title
 * - Fetches per-user GitHub OAuth token to update PR title
 * - Builds task prompt with PR context and resume-style preamble
 */

import { err, ok, getErrorMessage, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../models/codeTask.js';
import { createHmac } from 'node:crypto';
import type FirebaseFirestore from '@google-cloud/firestore';
import { loadConfig } from '../../config.js';
import { buildLockDocPath, deletePRTaskLock } from '../utils/prTaskLock.js';

export interface CreateTaskForPRRequest {
  /** Repository full name, e.g., "intexuraos/intexuraos" */
  repository: string;
  /** PR number */
  prNumber: number;
  /** PR title (optional, for Linear issue) */
  prTitle?: string;
  /** GitHub username of the commenter */
  senderLogin: string;
  /** The comment body */
  comment: string;
  /** GitHub webhook event ID for deduplication */
  eventId: string;
}

export type CreateTaskForPRErrorCode =
  | 'user_not_found'
  | 'no_workers_configured'
  | 'task_creation_failed'
  | 'linear_issue_failed'
  | 'queue_full'
  | 'internal_error';

export interface CreateTaskForPRError {
  code: CreateTaskForPRErrorCode;
  message: string;
  existingTaskId?: string;
}

export interface CreateTaskForPRDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  userLookupService: UserLookupService;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  orchestratorSecret: string;
  serviceUrl: string;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  firestore: {
    runTransaction: <T>(fn: (transaction: FirebaseFirestore.Transaction) => Promise<T>) => Promise<T>;
    doc: (path: string) => FirebaseFirestore.DocumentReference;
  };
}

/**
 * Build the task prompt from PR comment context.
 */
function buildTaskPrompt(request: CreateTaskForPRRequest): string {
  const { repository, prNumber, senderLogin, comment, prTitle } = request;

  const lines = [
    `[PR Comment Task] Comment on PR #${String(prNumber)} in ${repository}`,
    `From: @${senderLogin}`,
  ];
  if (prTitle !== undefined) {
    lines.push(`PR title: ${prTitle}`);
  }
  lines.push(
    '',
    'This task was created automatically because a comment was posted on a PR',
    'that had no existing code task. Investigate the PR context and address the comment.',
    '',
    'The commenter said:',
    comment,
    '',
    '### Important: Ignore bot-directed comments',
    '',
    'When reading PR comments, SKIP any comment whose body starts with `@claude`, `@codex`, or `@ignore`.',
    'These are commands directed at other bots (e.g. GitHub Actions) and are NOT intended for you.',
    '',
    '### Instructions',
    '',
    `1. Check PR state: gh pr view ${String(prNumber)} --json state,mergedAt,baseRefName,title,body`,
    `2. Read the full PR diff: gh pr diff ${String(prNumber)}`,
    '3. Gather ALL PR feedback (all three sources are MANDATORY):',
    `   - PR reviews: gh api /repos/${repository}/pulls/${String(prNumber)}/reviews`,
    `   - PR comments (inline): gh api /repos/${repository}/pulls/${String(prNumber)}/comments`,
    `   - Issue comments: gh api /repos/${repository}/issues/${String(prNumber)}/comments`,
    '4. Understand the full context of the PR and the comment',
    '5. If actionable: investigate the codebase, implement the requested changes',
    '6. Run pnpm run ci:tracked -- must pass before pushing',
    '7. Commit and push your changes to the existing PR branch',
    `8. Reply to the comment: gh api /repos/${repository}/issues/${String(prNumber)}/comments -f body="..."`,
  );
  return lines.join('\n');
}

/**
 * Generate HMAC-SHA256 webhook secret for task.
 */
function generateWebhookSecret(sharedSecret: string, taskId: string): string {
  return createHmac('sha256', sharedSecret).update(taskId).digest('hex');
}

/**
 * Fetch per-user GitHub OAuth token for PR title update.
 * Returns null if token is not available (best-effort).
 */
async function fetchGitHubToken(
  userServiceClient: UserServiceClient,
  userId: string,
  logger: Logger
): Promise<string | null> {
  const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');

  if (!tokenResult.ok) {
    logger.debug(
      { userId, errorCode: tokenResult.error.code },
      'GitHub OAuth token not available for user (best-effort)'
    );
    return null;
  }

  return tokenResult.value.accessToken; // @allow-result-access -- narrowed by !tokenResult.ok above
}

/**
 * Create a code task from a PR comment.
 *
 * This use case:
 * 1. Resolves GitHub username to userId
 * 2. Uses Firestore transaction to prevent race conditions
 * 3. Checks if task already exists (transaction guard)
 * 4. Creates new task if not
 * 5. Fetches per-user GitHub token and updates PR title (best-effort)
 * 6. Dispatches task to worker
 */
export async function createTaskForPR(
  deps: CreateTaskForPRDeps,
  request: CreateTaskForPRRequest
): Promise<Result<{ taskId: string }, CreateTaskForPRError>> {
  const { logger, codeTaskRepo, userLookupService, linearIssueService, taskDispatcher, orchestratorSecret, serviceUrl, firestore } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, eventId },
    'Creating task from PR comment'
  );

  // Step 1: Resolve GitHub username to userId
  const userResult = await userLookupService.resolveByGitHubUsername(senderLogin);

  if (!userResult.ok) {
    const errorCode = userResult.error.code;
    if (errorCode === 'NO_ENABLED_WORKER') {
      logger.warn({ senderLogin, error: userResult.error }, 'No enabled worker for user');
      return err({
        code: 'no_workers_configured',
        message: userResult.error.message,
      });
    }
    logger.warn({ senderLogin, error: userResult.error }, 'Failed to resolve GitHub username');
    return err({
      code: errorCode === 'INTERNAL_ERROR' ? 'internal_error' : 'user_not_found',
      message: userResult.error.message,
    });
  }

  const { userId, worker } = userResult.value; // @allow-result-access -- narrowed by !userResult.ok above
  logger.debug({ userId, senderLogin }, 'Resolved GitHub username to user');

  // Step 2: Use transaction with document-level lock to prevent race conditions
  const lockDocPath = buildLockDocPath(repository, prNumber);
  const lockRef = firestore.doc(lockDocPath);

  type TransactionResult = { taskId: string; isNew: false } | { taskId: string; isNew: true; webhookSecret: string; linearResult: Awaited<ReturnType<LinearIssueService['ensureIssueExists']>> };
  let transactionResult: Result<TransactionResult, CreateTaskForPRError>;

  // Extract Linear issue ID from PR title BEFORE transaction
  const linearIssueMatch = request.prTitle?.match(/\bINT-(\d+)\b/i);
  const existingLinearIssueId = linearIssueMatch !== null && linearIssueMatch !== undefined
    ? `INT-${String(linearIssueMatch[1])}`
    : undefined;

  try {
    transactionResult = await firestore.runTransaction(async (transaction) => {
      // Read the lock document — this provides transactional isolation
      const lockDoc = await transaction.get(lockRef);

      if (lockDoc.exists) {
        // Lock exists — task was already created
        const lockData = lockDoc.data();
        const existingTaskId = lockData?.['taskId'] as string | undefined;
        const isValidTaskId = existingTaskId !== undefined && existingTaskId.length > 0;
        if (!isValidTaskId) {
          return err({
            code: 'task_creation_failed' as CreateTaskForPRErrorCode,
            message: 'Lock document exists but taskId is missing',
          });
        }
        logger.info({ repository, prNumber, existingTaskId }, 'Task already exists for PR (lock document found)');
        return ok({ taskId: existingTaskId, isNew: false });
      }

      // Build instruction-style context for Linear issue creation
      const taskContext = [
        `Investigate and address a comment on PR #${String(prNumber)} in ${repository}.`,
        '',
        request.prTitle !== undefined ? `PR title: "${request.prTitle}"` : '',
        `Comment by @${senderLogin}:`,
        request.comment.slice(0, 500),
      ].filter((line) => line !== '').join('\n');

      // Create or validate Linear issue
      const linearResult = await linearIssueService.ensureIssueExists({
        userId,
        ...(existingLinearIssueId !== undefined
          ? { linearIssueId: existingLinearIssueId }
          : {}),
        taskPrompt: taskContext,
      });

      if (linearResult.linearFallback) {
        logger.warn(
          { userId },
          'Linear issue creation failed, using fallback mode'
        );
      }

      // Step 4: Create the task
      const taskId = `task_${crypto.randomUUID()}`;
      const webhookSecret = generateWebhookSecret(orchestratorSecret, taskId);

      const createInput: CreateTaskInput = {
        id: taskId,
        userId,
        prompt: buildTaskPrompt(request),
        sanitizedPrompt: request.comment.slice(0, 1000),
        systemPromptHash: 'pr-comment-auto',
        workerType: 'auto',
        workerLocation: worker.name,
        repository,
        baseBranch: 'main',
        traceId: eventId,
        actionId: `pr-comment/${repository}/${String(prNumber)}/${eventId}`,
        approvalEventId: eventId,
        prNumber,
        webhookSecret,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
        ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
        /* v8 ignore stop @preserve */
      };

      const createResult = await codeTaskRepo.create(createInput);

      if (!createResult.ok) {
        logger.error(
          { taskId, error: createResult.error },
          'Failed to create task'
        );
        return err({
          code: 'task_creation_failed' as CreateTaskForPRErrorCode,
          message: createResult.error.message,
          ...('existingTaskId' in createResult.error && { existingTaskId: createResult.error.existingTaskId }),
        });
      }

      // Write lock document within the transaction
      transaction.set(lockRef, { taskId, repository, prNumber, createdAt: new Date().toISOString() });

      logger.info(
        { taskId, userId, repository, prNumber },
        'Created new task from PR comment'
      );

      return ok({ taskId, isNew: true, webhookSecret, linearResult });
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error');
    logger.error({ error, repository, prNumber }, 'Transaction failed');
    return err({
      code: 'internal_error',
      message,
    });
  }

  // Step 5: Handle transaction result
  if (!transactionResult.ok) {
    return err(transactionResult.error);
  }

  const txValue = transactionResult.value; // @allow-result-access -- narrowed by !transactionResult.ok above

  // If task already existed, just return the ID
  if (!txValue.isNew) {
    return ok({ taskId: txValue.taskId });
  }

  // For new tasks, we have webhookSecret and linearResult
  const { taskId, webhookSecret, linearResult } = txValue;

  // Best-effort: prepend [INT-XXX] to PR title for Linear auto-linking
  // Uses per-user GitHub OAuth token instead of static API token
  if (
    existingLinearIssueId === undefined &&
    linearResult.linearIssueId !== undefined &&
    request.prTitle !== undefined
  ) {
    const [owner, repo] = repository.split('/');
    if (owner !== undefined && repo !== undefined) {
      const githubToken = await fetchGitHubToken(deps.userServiceClient, userId, logger);
      if (githubToken !== null) {
        const newTitle = `[${linearResult.linearIssueId}] ${request.prTitle}`;
        const titleResult = await deps.gitHubPRClient.updatePRTitle(githubToken, owner, repo, prNumber, newTitle);
        if (!titleResult.ok) {
          logger.warn(
            { error: titleResult.error, prNumber, linearIssueId: linearResult.linearIssueId },
            'Failed to update PR title with Linear issue ID (best-effort)'
          );
        }
      }
    }
  }

  // Always include pr-comment for PR-comment-originated tasks so the orchestrator
  // routes to buildPRCommentPrompt. When INT-XXX exists, merge the issue's real
  // labels with pr-comment; when creating new, use code-task + pr-comment.
  const issueLabels = existingLinearIssueId !== undefined
    ? linearResult.linearIssueLabels
    : ['code-task'];
  const dispatchLabels = issueLabels.includes('pr-comment')
    ? issueLabels
    : [...issueLabels, 'pr-comment'];

  // Step 6: Dispatch to worker (only for new tasks)
  const webhookUrl = `${serviceUrl}/internal/webhooks/task-complete`;

  const workerCredentials: DispatchWorkerCredentials = {
    workers: [{
      name: worker.name,
      url: worker.url,
      cfAccessClientId: worker.cfAccessClientId,
      cfAccessClientSecret: worker.cfAccessClientSecret,
      dispatchSigningSecret: worker.dispatchSigningSecret,
    }],
  };

  const dispatchResult = await taskDispatcher.dispatch({
    taskId,
    prompt: buildTaskPrompt(request),
    systemPromptHash: 'pr-comment-auto',
    repository,
    baseBranch: 'main',
    workerType: 'auto',
    webhookUrl,
    webhookSecret,
    traceId: eventId,
    workerCredentials,
    linearIssueLabels: dispatchLabels,
    hasChildren: linearResult.hasChildren,
    ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
  });

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;

    if (dispatchError.code === 'at_capacity') {
      const config = loadConfig();
      const queueCountResult = await codeTaskRepo.countQueued();
      if (!queueCountResult.ok) {
        logger.error({ error: queueCountResult.error }, 'Failed to count queued tasks, treating as queue full');
      }
      const queueCount = queueCountResult.ok ? queueCountResult.value : config.queue.maxSize;

      if (queueCount >= config.queue.maxSize) {
        await codeTaskRepo.update(taskId, {
          status: 'failed',
          error: {
            code: 'queue_full',
            message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
          },
        });
        await deletePRTaskLock(firestore, repository, prNumber, logger);
        return err({
          code: 'queue_full',
          message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
        });
      }

      const queueUpdateResult = await codeTaskRepo.update(taskId, {
        status: 'queued',
        queuedAt: new Date(),
      });

      if (!queueUpdateResult.ok) {
        logger.error({ taskId, error: queueUpdateResult.error }, 'Failed to persist queued status');
        return err({
          code: 'internal_error',
          message: 'Failed to queue task',
        });
      }

      const queuePosition = queueCount + 1;
      const estimatedWaitMinutes = Math.min(queuePosition * 5, config.queue.ttlMinutes);
      const queuedTask = {
        id: taskId,
        ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
        prompt: buildTaskPrompt(request),
        traceId: eventId,
      } as CodeTask;
      await deps.whatsappNotifier.notifyTaskQueued(userId, queuedTask, queuePosition, estimatedWaitMinutes);

      logger.info({ taskId, queuePosition }, 'PR comment task queued due to worker capacity');
      return ok({ taskId });
    }

    logger.error({ taskId, error: dispatchError }, 'Failed to dispatch PR comment task');
    await codeTaskRepo.update(taskId, {
      status: 'failed',
      error: { code: dispatchError.code, message: dispatchError.message },
    });
    await deletePRTaskLock(firestore, repository, prNumber, logger);
    return err({
      code: 'task_creation_failed' as CreateTaskForPRErrorCode,
      message: `Task created but dispatch failed: ${dispatchError.message}`,
    });
  }

  // Update task with worker location
  await codeTaskRepo.update(taskId, {
    workerLocation: dispatchResult.value.workerLocation, // @allow-result-access -- narrowed by !dispatchResult.ok above
  });

  logger.info(
    { taskId, userId, repository, prNumber, workerLocation: dispatchResult.value.workerLocation }, // @allow-result-access -- narrowed by !dispatchResult.ok above
    'Created and dispatched new task from PR comment'
  );

  return ok({ taskId });
}
