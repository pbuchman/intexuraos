/**
 * Parser for GitHub `pull_request_review_comment` webhook events.
 * These are inline comments on PR diffs.
 */

/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/dot-notation */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CreateGitHubPREventInput,
  GitHubEventType,
} from '../../../domain/models/gitHubPREvent.js';
import { extractBaseBranch, extractSender, isValidGitHubPRAction } from './shared.js';

/**
 * Parse a pull_request_review_comment event payload.
 * These are inline comments on PR diffs.
 */
export function parsePullRequestReviewCommentEvent(
  payload: unknown
): Result<CreateGitHubPREventInput, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  const action = p['action'];
  const repository = p['repository'];
  const pullRequest = p['pull_request'];
  const comment = p['comment'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  if (!pullRequest || typeof pullRequest !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing pull_request' });
  }

  const pr = pullRequest as Record<string, unknown>;
  const prNumber = pr['number'];
  const prId = pr['id'];
  const prTitle = pr['title'] ?? null;
  const prState = pr['state'] ?? null;
  const prMergedAt = pr['merged_at'];
  const prDraft = pr['draft'];

  const baseBranch = extractBaseBranch(pr);

  const commentPrUser = pr['user'];
  const rawCommentPrAuthorLogin = commentPrUser !== null && typeof commentPrUser === 'object'
    ? (commentPrUser as Record<string, unknown>)['login']
    : undefined;

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data' });
  }

  // Extract comment body if available
  let commentBody: unknown = null;
  if (comment && typeof comment === 'object') {
    const commentObj = comment as Record<string, unknown>;
    commentBody = commentObj['body'] ?? null;
  }

  const createdAt = p['created_at'] ?? new Date().toISOString();

  // Validate action is a known GitHubPRAction or null
  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    deliveryId: null,
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'pull_request_review_comment' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: typeof rawCommentPrAuthorLogin === 'string' ? rawCommentPrAuthorLogin : null,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof commentBody === 'string' ? commentBody : null,
    state: typeof prState === 'string' ? prState : null,
    isDraft: typeof prDraft === 'boolean' ? prDraft : null,
    baseBranch,
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}
