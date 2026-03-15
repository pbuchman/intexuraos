/**
 * Infrastructure implementation of AutomationLog that renders
 * lifecycle events as an append-only GitHub PR comment.
 *
 * Flow:
 * 1. Look up Firestore doc for {repository}:{prNumber}
 * 2. Render event to Markdown
 * 3. If no doc: POST new comment (header + event), save to Firestore
 * 4. If doc exists: GET current body, append event, PATCH comment
 * 5. Update Firestore eventCount
 *
 * Best-effort throughout — failures are logged but never block the caller.
 */

import type { Logger } from '@intexuraos/common-core';
import type { AutomationLog, PRRef, AutomationEvent } from '../../domain/ports/automationLog.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { PRAutomationCommentRepository } from '../../domain/ports/prAutomationCommentRepository.js';
import { renderHeader, renderEvent } from '../../domain/services/automationCommentRenderer.js';
import { parseOwnerRepo } from '../../domain/utils/parseOwnerRepo.js';

export interface GitHubPRAutomationLogDeps {
  gitHubPRClient: GitHubPRClient;
  prAutomationCommentRepo: PRAutomationCommentRepository;
  resolveOAuthToken: (userId: string) => Promise<string | null>;
  logger: Logger;
}

export function createGitHubPRAutomationLog(deps: GitHubPRAutomationLogDeps): AutomationLog {
  const { gitHubPRClient, prAutomationCommentRepo, resolveOAuthToken, logger } = deps;

  return {
    async record(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<void> {
      try {
        // For existing comments, use stored tokenUserId; for new comments, require caller-provided tokenUserId
        const existing = await prAutomationCommentRepo.get(prRef.repository, prRef.prNumber);
        const effectiveUserId = existing?.tokenUserId ?? tokenUserId;

        if (effectiveUserId === undefined || effectiveUserId === '') {
          logger.warn(
            { repository: prRef.repository, prNumber: prRef.prNumber },
            'Automation log: no tokenUserId available, skipping PR comment'
          );
          return;
        }

        const token = await resolveOAuthToken(effectiveUserId);
        if (token === null) {
          logger.warn(
            { repository: prRef.repository, prNumber: prRef.prNumber },
            'Automation log: OAuth token unavailable, skipping PR comment'
          );
          return;
        }

        const parsed = parseOwnerRepo(prRef.repository);
        if (parsed === null) {
          logger.warn(
            { repository: prRef.repository, prNumber: prRef.prNumber },
            'Automation log: invalid repository format, skipping PR comment'
          );
          return;
        }
        const { owner, repo } = parsed;
        const eventLine = renderEvent(event, { repository: prRef.repository });
        const now = new Date().toISOString();

        if (existing === undefined) {
          await createNewComment(token, owner, repo, prRef, eventLine, now, effectiveUserId);
        } else {
          await appendToExistingComment(token, owner, repo, existing.commentId, eventLine, prRef, existing.eventCount, now);
        }
      } catch (error: unknown) {
        logger.warn(
          { repository: prRef.repository, prNumber: prRef.prNumber, error },
          'Automation log: unexpected error recording event'
        );
      }
    },
  };

  async function createNewComment(
    token: string,
    owner: string,
    repo: string,
    prRef: PRRef,
    eventLine: string,
    now: string,
    effectiveUserId: string
  ): Promise<void> {
    const body = renderHeader() + '\n' + eventLine;
    const postResult = await gitHubPRClient.postPRComment(token, owner, repo, prRef.prNumber, body);

    if (!postResult.ok) {
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, error: postResult.error },
        'Automation log: failed to post new PR comment'
      );
      return;
    }

    await prAutomationCommentRepo.create({
      repository: prRef.repository,
      prNumber: prRef.prNumber,
      commentId: postResult.value.commentId,
      tokenUserId: effectiveUserId,
      eventCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function appendToExistingComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
    eventLine: string,
    prRef: PRRef,
    currentEventCount: number,
    now: string
  ): Promise<void> {
    const getResult = await gitHubPRClient.getIssueComment(token, owner, repo, commentId);

    if (!getResult.ok) {
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: getResult.error },
        'Automation log: failed to GET existing comment for append'
      );
      return;
    }

    const updatedBody = getResult.value.body + '\n\n' + eventLine;
    const patchResult = await gitHubPRClient.updateIssueComment(token, owner, repo, commentId, updatedBody);

    if (!patchResult.ok) {
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: patchResult.error },
        'Automation log: failed to PATCH existing comment'
      );
      return;
    }

    await prAutomationCommentRepo.update(prRef.repository, prRef.prNumber, {
      eventCount: currentEventCount + 1,
      updatedAt: now,
    });
  }
}
