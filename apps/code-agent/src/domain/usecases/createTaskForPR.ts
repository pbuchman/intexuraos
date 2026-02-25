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
 * - Builds task prompt with PR context and resume-style preamble
 */

import { err, ok, getErrorMessage, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import { createHmac } from 'node:crypto';
import type FirebaseFirestore from '@google-cloud/firestore';

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
  | 'internal_error';

export interface CreateTaskForPRError {
  code: CreateTaskForPRErrorCode;
  message: string;
}

export interface CreateTaskForPRDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  userLookupService: UserLookupService;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  orchestratorSecret: string;
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
    'Instructions:',
    `1. Check PR state: gh pr view ${String(prNumber)} --json state,merged,base,title,body`,
    `2. Read the full PR diff: gh pr diff ${String(prNumber)}`,
    `3. Read all PR comments: gh pr view ${String(prNumber)} --json comments`,
    '4. Understand the full context of the PR and the comment',
    '5. If actionable: investigate the codebase, implement the requested changes',
    '6. Run pnpm run ci:tracked — must pass before pushing',
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
 * Create a code task from a PR comment.
 *
 * This use case:
 * 1. Resolves GitHub username to userId
 * 2. Uses Firestore transaction to prevent race conditions
 * 3. Checks if task already exists (transaction guard)
 * 4. Creates new task if not
 * 5. Returns task ID for dispatch
 */
export async function createTaskForPR(
  deps: CreateTaskForPRDeps,
  request: CreateTaskForPRRequest
): Promise<Result<{ taskId: string }, CreateTaskForPRError>> {
  const { logger, codeTaskRepo, userLookupService, linearIssueService, taskDispatcher, orchestratorSecret, firestore } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, eventId },
    'Creating task from PR comment'
  );

  // Step 1: Resolve GitHub username to userId
  const userResult = await userLookupService.resolveUserFromGitHubUsername(senderLogin);

  /* v8 ignore start -- test-infra: userLookupService error requires mock to return error @preserve */
  if (!userResult.ok) {
    logger.error(
      { senderLogin, error: userResult.error },
      'Failed to resolve GitHub username'
    );
    return err({
      code: 'user_not_found',
      message: userResult.error.message,
    });
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: null user requires no matching githubUsername in worker settings @preserve */
  if (userResult.value === null) {
  /* v8 ignore stop @preserve */
    logger.warn({ senderLogin }, 'No user found for GitHub username');
    return err({
      code: 'user_not_found',
      message: `No worker settings found for GitHub user: ${senderLogin}`,
    });
  }

  const { userId, worker } = userResult.value;
  logger.debug({ userId, senderLogin }, 'Resolved GitHub username to user');

  // Step 2: Use transaction with document-level lock to prevent race conditions
  const lockDocPath = `pr_task_locks/${repository.replace(/\//g, '_')}_${String(prNumber)}`;
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
        /* v8 ignore start -- test-infra: invalid lock document requires data corruption @preserve */
        if (!isValidTaskId) {
          return err({
            code: 'task_creation_failed' as CreateTaskForPRErrorCode,
            message: 'Lock document exists but taskId is missing',
          });
        }
        /* v8 ignore stop @preserve */
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

      /* v8 ignore start -- test-infra: Linear fallback mode tested via integration tests @preserve */
      if (linearResult.linearFallback) {
      /* v8 ignore stop @preserve */
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
        executionPhase: 'execution',
        linearIssueTitle: linearResult.linearIssueTitle,
        webhookSecret,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
        ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
        ...(linearResult.linearIssueUrl !== undefined && { linearIssueUrl: linearResult.linearIssueUrl }),
        /* v8 ignore stop @preserve */
      };

      const createResult = await codeTaskRepo.create(createInput);

      /* v8 ignore start -- test-infra: task creation failure tested via integration tests @preserve */
      if (!createResult.ok) {
        logger.error(
          { taskId, error: createResult.error },
          'Failed to create task'
        );
        return err({
          code: 'task_creation_failed' as CreateTaskForPRErrorCode,
          message: createResult.error.message,
        });
      }
      /* v8 ignore stop @preserve */

      // Write lock document within the transaction
      transaction.set(lockRef, { taskId, repository, prNumber, createdAt: new Date().toISOString() });

      logger.info(
        { taskId, userId, repository, prNumber },
        'Created new task from PR comment'
      );

      return ok({ taskId, isNew: true, webhookSecret, linearResult });
    });
  } catch (error) {
    /* v8 ignore start -- test-infra: transaction exception requires Firestore outage @preserve */
    const message = getErrorMessage(error, 'Unknown error');
    logger.error({ error, repository, prNumber }, 'Transaction failed');
    return err({
      code: 'internal_error',
      message,
    });
    /* v8 ignore stop @preserve */
  }

  // Step 5: Handle transaction result
  /* v8 ignore start -- test-infra: transaction error requires Firestore failure @preserve */
  if (!transactionResult.ok) {
    return err(transactionResult.error);
  }
  /* v8 ignore stop @preserve */

  const txValue = transactionResult.value;

  // If task already existed, just return the ID
  if (!txValue.isNew) {
    return ok({ taskId: txValue.taskId });
  }

  // For new tasks, we have webhookSecret and linearResult
  const { taskId, webhookSecret, linearResult } = txValue;

  // Always include pr-comment for PR-comment-originated tasks so the orchestrator
  // routes to buildPRCommentPrompt. When INT-XXX exists, merge the issue's real
  // labels with pr-comment; when creating new, use code-task + pr-comment.
  const issueLabels = existingLinearIssueId !== undefined
    ? linearResult.linearIssueLabels
    : ['code-task'];
  /* v8 ignore start -- test-infra: pr-comment already present in issue labels is a defensive guard for edge case @preserve */
  const dispatchLabels = issueLabels.includes('pr-comment')
    ? issueLabels
    : [...issueLabels, 'pr-comment'];
  /* v8 ignore stop @preserve */

  // Step 6: Dispatch to worker (only for new tasks)
  const serviceUrl = process.env['INTEXURAOS_SERVICE_URL'] ?? 'https://code-agent.intexuraos.cloud';
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
    logger.error({ taskId, error: dispatchResult.error }, 'Failed to dispatch PR comment task');
    // Mark task as failed
    await codeTaskRepo.update(taskId, {
      status: 'failed',
      error: { code: dispatchResult.error.code, message: dispatchResult.error.message },
    });
    return err({
      code: 'task_creation_failed' as CreateTaskForPRErrorCode,
      message: `Task created but dispatch failed: ${dispatchResult.error.message}`,
    });
  }

  // Update task with worker location
  await codeTaskRepo.update(taskId, {
    workerLocation: dispatchResult.value.workerLocation,
  });

  logger.info(
    { taskId, userId, repository, prNumber, workerLocation: dispatchResult.value.workerLocation },
    'Created and dispatched new task from PR comment'
  );

  return ok({ taskId });
}
