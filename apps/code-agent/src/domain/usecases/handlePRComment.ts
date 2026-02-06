/**
 * Handle PR comment webhook - create or resume a Claude task.
 *
 * Flow:
 * 1. Check if comment is actionable (mentions Claude or from PR author)
 * 2. Try to acquire lock for this PR (one task per PR at a time)
 * 3. Find original task that created this PR (if any)
 * 4. Create new task with context from original task
 * 5. Dispatch to worker
 *
 * Design reference: INT-465
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CodeTask } from '../models/codeTask.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { PRTaskLockRepository } from '../repositories/prTaskLockRepository.js';
import { isActionableComment } from '../utils/isActionableComment.js';

export interface HandlePRCommentDeps {
  codeTaskRepo: CodeTaskRepository;
  prTaskLockRepo: PRTaskLockRepository;
  logger: Logger;
}

export type HandlePRCommentError =
  | { code: 'NOT_ACTIONABLE'; message: string }
  | { code: 'PR_LOCKED'; message: string; activeTaskId: string }
  | { code: 'REPO_ERROR'; message: string }
  | { code: 'LOCK_ERROR'; message: string };

export interface HandlePRCommentResult {
  taskId: string;
  mode: 'resumed' | 'new';
  prompt: string;
  originalTaskId?: string;
}

/**
 * Build the prompt for a PR comment follow-up task.
 */
function buildPRCommentPrompt(
  event: GitHubPREvent,
  originalTask: CodeTask | null
): string {
  const context = originalTask
    ? `You previously worked on this PR for Linear issue ${originalTask.linearIssueId ?? 'unknown'}.
Original task: ${originalTask.prompt.slice(0, 500)}${originalTask.prompt.length > 500 ? '...' : ''}
Branch: ${originalTask.result?.branch ?? originalTask.prBranch ?? 'unknown'}`
    : `This is a new task to address feedback on PR #${String(event.pullRequestNumber)}`;

  /* v8 ignore start -- ts-type: null body returns NOT_ACTIONABLE before reaching here @preserve */
  const bodyText = event.body ?? '(no body)';
  /* v8 ignore stop @preserve */

  return `
## Context
${context}

## PR Comment to Address
**From:** ${event.senderLogin}
**On PR:** #${String(event.pullRequestNumber)} in ${event.repository}
**Comment:**
${bodyText}

## Instructions
1. Review the comment and understand what's being requested
2. Make the necessary changes to address the feedback
3. Commit and push to the existing branch
4. Reply to the comment summarizing what you changed

Note: The worktree and branch for this PR should already exist. Resume work on the existing branch.
`.trim();
}

export async function handlePRComment(
  event: GitHubPREvent,
  userId: string,
  deps: HandlePRCommentDeps
): Promise<Result<HandlePRCommentResult, HandlePRCommentError>> {
  const { codeTaskRepo, prTaskLockRepo, logger } = deps;
  const { repository, pullRequestNumber, body, senderLogin, senderType } = event;

  logger.info(
    { repository, pullRequestNumber, senderLogin },
    'Processing PR comment for potential task creation'
  );

  // 1. Check if comment is actionable
  // Note: We don't have PR author info from the event, so we only check for Claude mentions
  // A more complete implementation would fetch PR author from GitHub API
  const actionable = isActionableComment({
    /* v8 ignore start -- ts-type: null body handled by isActionableComment returning false @preserve */
    body: body ?? '',
    /* v8 ignore stop @preserve */
    senderLogin,
    senderType,
  });

  if (!actionable) {
    logger.info(
      { repository, pullRequestNumber, senderLogin },
      'Comment is not actionable, skipping task creation'
    );
    return err({
      code: 'NOT_ACTIONABLE',
      message: 'Comment does not mention Claude and is not from PR author with request pattern',
    });
  }

  const lockKey = `${repository}:${String(pullRequestNumber)}`;

  // 2. Try to acquire lock
  const lockResult = await prTaskLockRepo.acquireLock(lockKey, 'pending', userId);

  if (!lockResult.ok) {
    const lockError = lockResult.error;
    if (lockError.code === 'LOCK_HELD') {
      logger.info(
        { repository, pullRequestNumber, activeTaskId: lockError.lockedByTaskId },
        'PR already has active task, cannot create new one'
      );
      return err({
        code: 'PR_LOCKED',
        message: `Task already in progress for this PR`,
        activeTaskId: lockError.lockedByTaskId,
      });
    }
    return err({ code: 'LOCK_ERROR', message: lockError.message });
  }

  try {
    // 3. Find original task that created this PR
    const originalTaskResult = await codeTaskRepo.findByPR(repository, pullRequestNumber);

    if (!originalTaskResult.ok) {
      const repoError = originalTaskResult.error;
      // Release lock on error
      await prTaskLockRepo.releaseLock(lockKey);
      return err({ code: 'REPO_ERROR', message: repoError.message });
    }

    const originalTask = originalTaskResult.value;

    // 4. Build prompt with context
    const prompt = buildPRCommentPrompt(event, originalTask);

    // 5. Return the result - actual task creation happens in the route
    // We don't create the task here because we need access to the full task creation flow
    // which includes worker dispatch, trace IDs, etc.

    // Build result conditionally to satisfy exactOptionalPropertyTypes
    const result: HandlePRCommentResult = originalTask
      ? {
          taskId: lockKey, // Temporary, will be replaced by actual task ID
          mode: 'resumed',
          prompt,
          originalTaskId: originalTask.id,
        }
      : {
          taskId: lockKey,
          mode: 'new',
          prompt,
        };

    logger.info(
      {
        repository,
        pullRequestNumber,
        mode: result.mode,
        hasOriginalTask: !!originalTask,
        originalTaskId: originalTask?.id,
      },
      'PR comment task prepared'
    );

    return ok(result);
  } catch (error) {
    // Release lock on error
    await prTaskLockRepo.releaseLock(lockKey);
    throw error;
  }
}
