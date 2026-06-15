/**
 * Parser for GitHub `issue_comment` webhook events.
 * These are general comments on PRs (not inline diff comments).
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
import { extractSender, isValidGitHubPRAction } from './shared.js';

/**
 * Parse an issue_comment event payload.
 * These are general comments on PRs (not inline diff comments).
 * Returns null if the comment is on an issue (not a PR).
 */
export function parseIssueCommentEvent(
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  // Check if this is a comment on a PR (not an issue)
  const issue = p['issue'];
  if (!issue || typeof issue !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing issue' });
  }

  const issueObj = issue as Record<string, unknown>;

  // issue_comment events for PRs have a 'pull_request' field in the issue object
  // If it's missing or null, this is a comment on an issue, not a PR
  if (!issueObj['pull_request']) {
    return ok(null);
  }

  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  const action = p['action'];
  const repository = p['repository'];
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

  // Get PR number and ID from the issue object
  const prNumber = issueObj['number'];
  const prId = issueObj['id'];
  const prTitle = issueObj['title'] ?? null;
  const prState = issueObj['state'] ?? null;
  const prDraft = issueObj['draft'];

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid issue data' });
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
    eventType: 'issue_comment' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: null,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof commentBody === 'string' ? commentBody : null,
    state: typeof prState === 'string' ? prState : null,
    isDraft: typeof prDraft === 'boolean' ? prDraft : null,
    baseBranch: null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}
