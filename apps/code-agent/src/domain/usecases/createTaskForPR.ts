/**
 * Use case: Create a code task from a PR comment when no task exists.
 *
 * This handles the case where a PR comment arrives but there's no existing
 * code task for that PR. It creates a new task and enqueues it for dispatch.
 *
 * Key features:
 * - Resolves GitHub username to userId via UserLookupService
 * - Transaction guard prevents duplicate task creation from concurrent comments
 * - Auto-creates Linear issue from PR title
 * - Fetches per-user GitHub OAuth token to update PR title
 * - Builds task prompt with PR context and resume-style preamble
 */

import { err, ok, getErrorMessage, serializeError, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WorkerType } from '../models/codeTask.js';
import type FirebaseFirestore from '@google-cloud/firestore';
import { buildLockDocPath } from '../utils/prTaskLock.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';

import { sanitizePrompt } from '../utils/promptSanitization.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import type { AutomationLog } from '../ports/automationLog.js';
import { updatePRTitleWithLinearTag } from '../utils/updatePRTitleWithLinearTag.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';

const DEFAULT_LINEAR_FALLBACK_ERROR = 'Linear unavailable';

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
  baseBranch?: string;
  /** Worker type extracted from @worker directive (optional) */
  workerType?: WorkerType;
  /** Existing PR tracking comment to reuse for pull_request tasks. */
  trackingCommentId?: string;
}

export type CreateTaskForPRErrorCode =
  | 'user_not_found'
  | 'no_workers_configured'
  | 'task_creation_failed'
  | 'linear_issue_failed'
  | 'queue_full'
  | 'task_not_found'
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
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  orchestratorSecret: string;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  automationLog: AutomationLog;
  workerSettingsRepo: WorkerSettingsRepository;
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
 * Create a code task from a PR comment.
 *
 * This use case:
 * 1. Resolves GitHub username to userId
 * 2. Uses Firestore transaction to prevent race conditions
 * 3. Checks if task already exists (transaction guard)
 * 4. Creates new task if not
 * 5. Fetches per-user GitHub token and updates PR title (best-effort)
 * 6. Enqueues task for dispatch via TaskEnqueueService
 */
export async function createTaskForPR(
  deps: CreateTaskForPRDeps,
  request: CreateTaskForPRRequest
): Promise<Result<{ taskId: string }, CreateTaskForPRError>> {
  const { logger, codeTaskRepo, userLookupService, linearIssueService, taskEnqueueService, orchestratorSecret, firestore } = deps;
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

  const { userId } = userResult.value; // @allow-result-access -- narrowed by !userResult.ok above
  logger.debug({ userId, senderLogin }, 'Resolved GitHub username to user');

  // Resolve effective worker type: request > user default > 'auto'
  let effectiveWorkerType: WorkerType = request.workerType ?? 'auto';
  if (effectiveWorkerType === 'auto') {
    const settingsResult = await deps.workerSettingsRepo.getSettings(userId);
    if (settingsResult.ok && settingsResult.value?.defaultPullRequestWorkerType !== undefined) {
      effectiveWorkerType = settingsResult.value.defaultPullRequestWorkerType;
      logger.info({ userId, defaultPullRequestWorkerType: effectiveWorkerType }, 'Using user default pull request worker type');
    }
  }

  // Fetch baseBranch from GitHub API when not provided (e.g. issue_comment events
  // where no prior pull_request event was stored)
  let resolvedBaseBranch = request.baseBranch;
  if (resolvedBaseBranch === undefined) {
    const [owner, repo] = repository.split('/');
    if (owner !== undefined && repo !== undefined) {
      const githubToken = await fetchGitHubToken(deps.userServiceClient, userId, logger);
      if (githubToken !== null) {
        const branchResult = await deps.gitHubPRClient.getPullRequestBaseBranch(
          githubToken, owner, repo, prNumber
        );
        if (branchResult.ok) {
          resolvedBaseBranch = branchResult.value; // @allow-result-access -- narrowed by branchResult.ok
          logger.info({ baseBranch: resolvedBaseBranch, prNumber }, 'Fetched baseBranch from GitHub API');
        } else {
          logger.warn({ error: branchResult.error, prNumber }, 'Failed to fetch baseBranch from GitHub API'); // @allow-result-access -- narrowed by !branchResult.ok
        }
      }
    }
  }

  // Step 2: Use transaction with document-level lock to prevent race conditions
  const lockDocPath = buildLockDocPath(repository, prNumber);
  const lockRef = firestore.doc(lockDocPath);

  type TransactionResult = { taskId: string; isNew: false } | { taskId: string; isNew: true };
  let transactionResult: Result<TransactionResult, CreateTaskForPRError>;

  // Extract Linear issue ID from PR title BEFORE transaction
  const linearIssueMatch = request.prTitle?.match(/\bINT-(\d+)\b/i);
  const existingLinearIssueId = linearIssueMatch !== null && linearIssueMatch !== undefined
    ? `INT-${String(linearIssueMatch[1])}`
    : undefined;

  // Build instruction-style context for Linear issue creation
  const taskContext = [
    `Investigate and address a comment on PR #${String(prNumber)} in ${repository}.`,
    '',
    request.prTitle !== undefined ? `PR title: "${request.prTitle}"` : '',
    `Comment by @${senderLogin}:`,
    request.comment.slice(0, 500),
  ].filter((line) => line !== '').join('\n');

  // Create or validate Linear issue BEFORE the transaction
  // (HTTP call to Linear must not be inside a Firestore transaction — retries would replay it)
  let linearResult: Awaited<ReturnType<LinearIssueService['ensureIssueExists']>>;
  try {
    linearResult = await linearIssueService.ensureIssueExists({
      userId,
      ...(existingLinearIssueId !== undefined
        ? { linearIssueId: existingLinearIssueId }
        : {}),
      taskPrompt: taskContext,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error');
    logger.error({ error: serializeError(error), repository, prNumber }, 'Linear issue creation failed');
    return err({
      code: 'linear_issue_failed',
      message,
    });
  }

  if (linearResult.linearFallback) {
    logger.warn(
      { userId },
      'Linear issue creation failed, using fallback mode'
    );
    deps.automationLog.record(
      { repository, prNumber },
      { type: 'linear_issue_failed', error: linearResult.linearFallbackError ?? DEFAULT_LINEAR_FALLBACK_ERROR },
      userId,
    ).catch((logError: unknown) => {
      logger.warn({ error: logError, prNumber }, 'Failed to record Linear failure in automation log');
    });
  }

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

      // Step 4: Create the task
      const taskId = `task_${crypto.randomUUID()}`;
      const webhookSecret = generateWebhookSecret(orchestratorSecret, taskId);
      const taskPrompt = buildTaskPrompt(request);

      const createInput: CreateTaskInput = {
        id: taskId,
        userId,
        prompt: taskPrompt,
        sanitizedPrompt: sanitizePrompt(taskPrompt),
        systemPromptHash: 'pr-comment-auto',
        workerType: effectiveWorkerType,
        workerLocation: 'queued',
        repository,
        baseBranch: resolvedBaseBranch ?? 'main',
        traceId: eventId,
        actionId: `pr-comment/${repository}/${String(prNumber)}/${eventId}`,
        approvalEventId: eventId,
        prNumber,
        webhookSecret,
        agentType: 'pull_request',
        ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
        ...(request.trackingCommentId !== undefined && { trackingCommentId: request.trackingCommentId }),
      };

      // Pass the outer transaction to avoid nested transactions
      const createResult = await codeTaskRepo.create(createInput, { transaction });

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

      return ok({ taskId, isNew: true });
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error');
    logger.error({ error: serializeError(error), repository, prNumber }, 'Transaction failed');
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

  const { taskId } = txValue;

  // Step 6: Enqueue task for dispatch via TaskEnqueueService
  const enqueueResult = await taskEnqueueService.enqueue({ taskId, userId });

  if (!enqueueResult.ok) {
    const enqueueError = enqueueResult.error;
    logger.error({ taskId, error: enqueueError }, 'Failed to enqueue PR comment task');
    return err({
      code: enqueueError.code,
      message: enqueueError.message,
    });
  }

  // Best-effort: update PR title with Linear issue tag
  await updatePRTitleWithLinearTag(deps, {
    repository, prNumber, userId,
    ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
    ...(request.prTitle !== undefined && { prTitle: request.prTitle }),
    titleAlreadyTagged: existingLinearIssueId !== undefined,
  });

  deps.automationLog.record(
    { repository, prNumber },
    {
      type: 'task_dispatched',
      taskId,
      workerType: effectiveWorkerType,
      agentType: 'pull_request',
      ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
    },
    userId,
  ).catch((error: unknown) => {
    logger.warn({ error, taskId }, 'Failed to record automation log for enqueued task');
  });

  logger.info(
    { taskId, userId, repository, prNumber, queuePosition: enqueueResult.value.queuePosition }, // @allow-result-access -- narrowed by !enqueueResult.ok above
    'Created and enqueued new task from PR comment'
  );

  return ok({ taskId });
}
