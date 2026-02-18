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
 * Build a richer context section from the original task.
 */
function buildOriginalTaskContext(originalTask: CodeTask): string {
  const lines: string[] = [];

  // Linear issue info
  if (originalTask.linearIssueId !== undefined) {
    const issueType = originalTask.linearIssueType !== undefined
      ? ` (${originalTask.linearIssueType})`
      : '';
    const title = originalTask.linearIssueTitle !== undefined
      ? `: ${originalTask.linearIssueTitle}`
      : '';
    lines.push(`**Linear Issue:** ${originalTask.linearIssueId}${issueType}${title}`);
  }

  // Branch info
  const branch = originalTask.result?.branch ?? originalTask.prBranch;
  if (branch !== undefined) {
    lines.push(`**Branch:** ${branch}`);
  }

  // Repository context
  lines.push(`**Repository:** ${originalTask.repository}`);
  lines.push(`**Base Branch:** ${originalTask.baseBranch}`);

  // Original prompt (truncated)
  const promptPreview = originalTask.prompt.length > 800
    ? `${originalTask.prompt.slice(0, 800)}...`
    : originalTask.prompt;
  lines.push(`\n**Original Task:**\n${promptPreview}`);

  // Previous result summary if available
  if (originalTask.result?.summary !== undefined) {
    const summaryPreview = originalTask.result.summary.length > 300
      ? `${originalTask.result.summary.slice(0, 300)}...`
      : originalTask.result.summary;
    lines.push(`\n**Previous Work Summary:**\n${summaryPreview}`);
  }

  return lines.join('\n');
}

/**
 * Build the prompt for a PR comment follow-up task.
 */
function buildPRCommentPrompt(
  event: GitHubPREvent,
  originalTask: CodeTask | null
): string {
  // PR title for context
  /* v8 ignore start -- ts-type: null title is rare but possible @preserve */
  const prTitle = event.title ?? `PR #${String(event.pullRequestNumber)}`;
  /* v8 ignore stop @preserve */

  const context = originalTask
    ? buildOriginalTaskContext(originalTask)
    : `This is a new task to address feedback on PR #${String(event.pullRequestNumber)} in ${event.repository}.\nNo previous task context available.`;

  /* v8 ignore start -- ts-type: null body returns NOT_ACTIONABLE before reaching here @preserve */
  const bodyText = event.body ?? '(no body)';
  /* v8 ignore stop @preserve */

  return `
## PR Comment Follow-Up Task

### Pull Request
**PR:** #${String(event.pullRequestNumber)} - ${prTitle}
**Repository:** ${event.repository}
**State:** ${event.state ?? 'open'}

### Original Task Context
${context}

### Comment to Address
**From:** ${event.senderLogin}
**Comment:**
\`\`\`
${bodyText}
\`\`\`

### Instructions
1. Read the comment carefully and understand what changes are being requested
2. Review the relevant code in the PR to understand the current state
3. Make the necessary changes to address the feedback
4. Run tests to ensure your changes don't break anything
5. Commit and push to the existing branch
6. Reply to the comment summarizing what you changed and why

**Important:** The worktree and branch for this PR should already exist. Resume work on the existing branch. Do NOT create a new branch or PR.
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
