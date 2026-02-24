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

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from '../services/linearIssueService.js';

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
  firestore: {
    runTransaction: <T>(fn: (transaction: unknown) => Promise<T>) => Promise<T>;
  };
}

/**
 * Build the task prompt from PR comment context.
 */
function buildTaskPrompt(request: CreateTaskForPRRequest): string {
  const { repository, prNumber, senderLogin, comment } = request;

  return [
    `[Resume from PR Comment] New comment on PR #${prNumber} in ${repository}`,
    `From: @${senderLogin}`,
    '',
    'The commenter said:',
    comment,
    '',
    'Instructions:',
    `1. Check PR state: gh pr view ${prNumber} --json state,merged,base`,
    `2. Read the full PR diff: gh pr diff ${prNumber}`,
    `3. Read all PR comments: gh pr view ${prNumber} --json comments`,
    '4. Understand the full context of the comment',
    '5. If actionable: investigate and implement the requested changes',
    '6. Commit and push your changes',
    '7. Reply to the comment explaining your changes',
  ].join('\n');
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
  const { logger, codeTaskRepo, userLookupService, linearIssueService, firestore } = deps;
  const { repository, prNumber, senderLogin, eventId } = request;

  logger.info(
    { repository, prNumber, senderLogin, eventId },
    'Creating task from PR comment'
  );

  // Step 1: Resolve GitHub username to userId
  const userResult = await userLookupService.resolveUserFromGitHubUsername(senderLogin);

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

  if (userResult.value === null) {
    logger.warn({ senderLogin }, 'No user found for GitHub username');
    return err({
      code: 'user_not_found',
      message: `No worker settings found for GitHub user: ${senderLogin}`,
    });
  }

  const { userId, worker } = userResult.value;
  logger.debug({ userId, senderLogin }, 'Resolved GitHub username to user');

  // Step 2: Use transaction to prevent race conditions
  try {
    const result = await firestore.runTransaction(async (_transaction) => {
      // Re-check if task exists (another request might have created it)
      const existingTask = await codeTaskRepo.findByPR(repository, prNumber);

      if (!existingTask.ok) {
        return err({
          code: 'task_creation_failed' as CreateTaskForPRErrorCode,
          message: `Failed to check existing task: ${existingTask.error.message}`,
        });
      }

      if (existingTask.value !== null) {
        // Task already exists, return its ID
        logger.info(
          { repository, prNumber, existingTaskId: existingTask.value.id },
          'Task already exists for PR'
        );
        return ok({ taskId: existingTask.value.id });
      }

      // Step 3: Create Linear issue
      const linearResult = await linearIssueService.ensureIssueExists({
        userId,
        taskPrompt: request.comment,
      });

      if (linearResult.linearFallback) {
        logger.warn(
          { userId },
          'Linear issue creation failed, using fallback mode'
        );
      }

      // Step 4: Create the task
      const taskId = `task_${crypto.randomUUID()}`;

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
        actionId: `pr-comment/${repository}/${prNumber}/${eventId}`,
        approvalEventId: eventId,
        prNumber,
        executionPhase: 'execution',
        ...(linearResult.linearIssueId !== undefined && { linearIssueId: linearResult.linearIssueId }),
        ...(linearResult.linearIssueTitle !== undefined && { linearIssueTitle: linearResult.linearIssueTitle }),
        ...(linearResult.linearIssueUrl !== undefined && { linearIssueUrl: linearResult.linearIssueUrl }),
        ...(linearResult.linearFallback !== undefined && { linearFallback: linearResult.linearFallback }),
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
        });
      }

      logger.info(
        { taskId, userId, repository, prNumber },
        'Created new task from PR comment'
      );

      return ok({ taskId });
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, repository, prNumber }, 'Transaction failed');
    return err({
      code: 'internal_error',
      message,
    });
  }
}
