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

import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type {
  AutomationLog,
  PRRef,
  AutomationEvent,
  AutomationLogRecordError,
} from '../../domain/ports/automationLog.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { PRAutomationCommentRepository } from '../../domain/ports/prAutomationCommentRepository.js';
import {
  dispatchFailureIdempotencyMarker,
  renderHeader,
  renderEvent,
} from '../../domain/services/automationCommentRenderer.js';
import { parseOwnerRepo } from '../../domain/utils/parseOwnerRepo.js';

export interface GitHubPRAutomationLogDeps {
  gitHubPRClient: GitHubPRClient;
  prAutomationCommentRepo: PRAutomationCommentRepository;
  resolveOAuthToken: (userId: string) => Promise<string | null>;
  userServiceClient: UserServiceClient;
  logger: Logger;
}

export function createGitHubPRAutomationLog(deps: GitHubPRAutomationLogDeps): AutomationLog {
  const { gitHubPRClient, prAutomationCommentRepo, resolveOAuthToken, userServiceClient, logger } = deps;
  const pending = new Map<string, Promise<AutomationLogRecordResult>>();
  const TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const timezoneCache = new Map<string, { value: string | undefined; expiresAt: number }>();

  type AutomationLogRecordResult = Result<void, AutomationLogRecordError>;

  function automationLogFailure(message: string): AutomationLogRecordResult {
    return err({ code: 'AUTOMATION_LOG_FAILED', message });
  }

  async function resolveTimezone(userId: string): Promise<string | undefined> {
    const cached = timezoneCache.get(userId);
    if (cached !== undefined && Date.now() < cached.expiresAt) return cached.value;
    const tz = await userServiceClient.getUserTimezone(userId);
    timezoneCache.set(userId, { value: tz, expiresAt: Date.now() + TIMEZONE_CACHE_TTL_MS });
    return tz;
  }

  async function doRecord(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<AutomationLogRecordResult> {
    try {
      const existing = await prAutomationCommentRepo.get(prRef.repository, prRef.prNumber);
      const effectiveUserId = existing?.tokenUserId ?? tokenUserId;

      if (effectiveUserId === undefined || effectiveUserId === '') {
        logger.warn(
          { repository: prRef.repository, prNumber: prRef.prNumber },
          'Automation log: no tokenUserId available, skipping PR comment'
        );
        return automationLogFailure('No token user ID available for PR automation comment');
      }

      const token = await resolveOAuthToken(effectiveUserId);
      if (token === null) {
        logger.warn(
          { repository: prRef.repository, prNumber: prRef.prNumber },
          'Automation log: OAuth token unavailable, skipping PR comment'
        );
        return automationLogFailure('OAuth token unavailable for PR automation comment');
      }

      const parsed = parseOwnerRepo(prRef.repository);
      if (parsed === null) {
        logger.warn(
          { repository: prRef.repository, prNumber: prRef.prNumber },
          'Automation log: invalid repository format, skipping PR comment'
        );
        return automationLogFailure('Invalid repository format for PR automation comment');
      }
      const { owner, repo } = parsed;
      const timezone = await resolveTimezone(effectiveUserId);
      const timestamp = new Date().toISOString();
      const eventLine = renderEvent(event, { repository: prRef.repository, timezone, timestamp });

      if (eventLine === null) {
        return ok(undefined);
      }

      if (existing === undefined) {
        return await createNewComment(token, owner, repo, prRef, eventLine, timestamp, effectiveUserId);
      }
      return await appendToExistingComment(token, owner, repo, existing.commentId, eventLine, event, prRef, existing.eventCount, timestamp, effectiveUserId);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, error },
        'Automation log: unexpected error recording event'
      );
      return automationLogFailure(message);
    }
  }

  async function recordInternal(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<AutomationLogRecordResult> {
    const key = `${prRef.repository}:${String(prRef.prNumber)}`;
    const prev = pending.get(key) ?? Promise.resolve(ok(undefined));
    const next = prev.then(() => doRecord(prRef, event, tokenUserId));
    const swallowed = next.catch((error: unknown) => automationLogFailure(getErrorMessage(error)));
    pending.set(key, swallowed);
    try {
      return await swallowed;
    } finally {
      // Only clean up if no subsequent call has replaced our chain entry.
      if (pending.get(key) === swallowed) {
        pending.delete(key);
      }
    }
  }

  return {
    async record(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<void> {
      await recordInternal(prRef, event, tokenUserId);
    },
    async recordWithResult(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<AutomationLogRecordResult> {
      return await recordInternal(prRef, event, tokenUserId);
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
  ): Promise<AutomationLogRecordResult> {
    const body = renderHeader() + '\n' + eventLine;
    const postResult = await gitHubPRClient.postPRComment(token, owner, repo, prRef.prNumber, body);

    if (!postResult.ok) {
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, error: postResult.error },
        'Automation log: failed to post new PR comment'
      );
      return automationLogFailure(postResult.error.message);
    }

    try {
      await prAutomationCommentRepo.create({
        repository: prRef.repository,
        prNumber: prRef.prNumber,
        commentId: postResult.value.commentId,
        tokenUserId: effectiveUserId,
        eventCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      logger.warn(
        {
          repository: prRef.repository,
          prNumber: prRef.prNumber,
          commentId: postResult.value.commentId,
          error: getErrorMessage(error),
        },
        'Automation log: posted new PR comment but failed to save comment record'
      );
    }
    return ok(undefined);
  }

  async function appendToExistingComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
    eventLine: string,
    event: AutomationEvent,
    prRef: PRRef,
    currentEventCount: number,
    now: string,
    effectiveUserId: string
  ): Promise<AutomationLogRecordResult> {
    const getResult = await gitHubPRClient.getIssueComment(token, owner, repo, commentId);

    if (!getResult.ok) {
      if (isRecoverableStaleCommentError(getResult.error)) {
        logger.info(
          { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: getResult.error },
          'Automation log: existing comment unavailable, posting replacement'
        );
        return await createNewComment(token, owner, repo, prRef, eventLine, now, effectiveUserId);
      }
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: getResult.error },
        'Automation log: failed to GET existing comment for append'
      );
      return automationLogFailure(getResult.error.message);
    }

    if (isDuplicateIdempotentEvent(getResult.value.body, event)) {
      logger.info(
        { repository: prRef.repository, prNumber: prRef.prNumber, commentId },
        'Automation log: skipping duplicate idempotent event'
      );
      return ok(undefined);
    }

    const updatedBody = getResult.value.body + '\n\n' + eventLine;
    const patchResult = await gitHubPRClient.updateIssueComment(token, owner, repo, commentId, updatedBody);

    if (!patchResult.ok) {
      if (isRecoverableStaleCommentError(patchResult.error)) {
        logger.info(
          { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: patchResult.error },
          'Automation log: existing comment cannot be patched, posting replacement'
        );
        return await createNewComment(token, owner, repo, prRef, eventLine, now, effectiveUserId);
      }
      logger.warn(
        { repository: prRef.repository, prNumber: prRef.prNumber, commentId, error: patchResult.error },
        'Automation log: failed to PATCH existing comment'
      );
      return automationLogFailure(patchResult.error.message);
    }

    await prAutomationCommentRepo.update(prRef.repository, prRef.prNumber, {
      eventCount: currentEventCount + 1,
      updatedAt: now,
    });
    return ok(undefined);
  }

  function isRecoverableStaleCommentError(error: { code: string }): boolean {
    return error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED';
  }

  function isDuplicateIdempotentEvent(existingBody: string, event: AutomationEvent): boolean {
    if (event.type !== 'task_dispatch_failed' || event.idempotencyKey === undefined || event.idempotencyKey === '') {
      return false;
    }
    return existingBody.includes(dispatchFailureIdempotencyMarker(event.idempotencyKey));
  }
}
