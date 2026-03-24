/**
 * GitHub webhook event parser.
 *
 * Normalizes GitHub webhook payloads into our GitHubPREvent domain model.
 * Handles pull_request, pull_request_review, pull_request_review_comment, and push events.
 */

/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/dot-notation */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CreateGitHubPREventInput,
  GitHubEventType,
  GitHubPRAction,
} from '../domain/models/gitHubPREvent.js';

// Supported GitHub event types
const ALLOWED_REPOS = /^[\w-]+\/intexuraos$/;
const INT_EXURAOS_ORG_REPOS = /^intexuraos\/[\w-]+$/;

/**
 * Check if a repository should be processed.
 * Only processes intexuraos/* repositories.
 */
export function shouldProcessRepository(repositoryFullName: string): boolean {
  return (
    INT_EXURAOS_ORG_REPOS.test(repositoryFullName) ||
    ALLOWED_REPOS.test(repositoryFullName)
  );
}

/**
 * Extract sender information from a GitHub webhook payload.
 */
function extractSender(payload: unknown): Result<
  { login: string; id: number; type: string },
  { code: 'INVALID_PAYLOAD'; message: string }
> {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('sender' in payload) ||
    !payload.sender ||
    typeof payload.sender !== 'object'
  ) {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing or invalid sender' });
  }

  const sender = payload.sender as Record<string, unknown>;

  const login = sender['login'];
  const id = sender['id'];
  const type = sender['type'] ?? 'User';

  if (typeof login !== 'string') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid sender login' });
  }

  if (typeof id !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid sender id' });
  }

  return ok({ login, id, type: String(type) });
}

/**
 * Extract base branch from a pull_request object's base.ref field.
 */
function extractBaseBranch(pr: Record<string, unknown>): string | null {
  const prBase = pr['base'];
  const baseBranchRef = prBase !== null && typeof prBase === 'object'
    ? (prBase as Record<string, unknown>)['ref']
    : undefined;
  return typeof baseBranchRef === 'string' ? baseBranchRef : null;
}

/**
 * Parse a pull_request event payload.
 */
export function parsePullRequestEvent(
  payload: unknown
): Result<CreateGitHubPREventInput, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  // Extract required fields
  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  const action = p['action'];
  const repository = p['repository'];
  const pullRequest = p['pull_request'];

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
  const prBody = pr['body'] ?? null;
  const prState = pr['state'] ?? null;
  const prMergedAt = pr['merged_at'];

  const baseBranch = extractBaseBranch(pr);

  const prUser = pr['user'];
  const rawPrAuthorLogin = prUser !== null && typeof prUser === 'object'
    ? (prUser as Record<string, unknown>)['login']
    : undefined;

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data' });
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
    eventType: 'pull_request' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: typeof rawPrAuthorLogin === 'string' ? rawPrAuthorLogin : null,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof prBody === 'string' ? prBody : null,
    state: typeof prState === 'string' ? prState : null,
    baseBranch,
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : prMergedAt instanceof Date
          ? prMergedAt
          : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Type guard to check if a string is a valid GitHubPRAction.
 */
function isValidGitHubPRAction(value: string): value is GitHubPRAction {
  const validActions: GitHubPRAction[] = [
    // pull_request actions
    'opened',
    'closed',
    'edited',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'assigned',
    'unassigned',
    'labeled',
    'unlabeled',
    'locked',
    'unlocked',
    'review_requested',
    'review_request_removed',
    'milestoned',
    'demilestoned',
    'enqueued',
    'dequeued',
    'auto_merge_enabled',
    'auto_merge_disabled',
    // pull_request_review actions
    'submitted',
    'dismissed',
    // pull_request_review_comment actions
    'created',
    'deleted',
  ];
  return validActions.includes(value as GitHubPRAction);
}

/**
 * Parse a pull_request_review event payload.
 */
export function parsePullRequestReviewEvent(
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
  const review = p['review'];

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

  // Get review body if available, otherwise fall back to PR body
  let prBody: unknown = null;
  if (review && typeof review === 'object') {
    const reviewObj = review as Record<string, unknown>;
    prBody = reviewObj['body'] ?? pr['body'];
  } else {
    prBody = pr['body'];
  }
  prBody = prBody ?? null;

  const prState = pr['state'] ?? null;
  const prMergedAt = pr['merged_at'];

  const baseBranch = extractBaseBranch(pr);

  const reviewPrUser = pr['user'];
  const rawReviewPrAuthorLogin = reviewPrUser !== null && typeof reviewPrUser === 'object'
    ? (reviewPrUser as Record<string, unknown>)['login']
    : undefined;

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data' });
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
    eventType: 'pull_request_review' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: typeof rawReviewPrAuthorLogin === 'string' ? rawReviewPrAuthorLogin : null,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof prBody === 'string' ? prBody : null,
    state: typeof prState === 'string' ? prState : null,
    baseBranch,
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

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
    baseBranch,
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

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
    baseBranch: null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Parse a push event payload.
 * Push events are optional for context, so we return null if not PR-related.
 */
export function parsePushEvent(
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  const repository = p['repository'];
  const ref = p['ref'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  // Push events don't have a PR number, use 0 as placeholder
  // These are stored for context but won't appear in PR-specific queries
  const createdAt = p['created_at'] ?? new Date().toISOString();

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    deliveryId: null,
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: 0, // Push events are not PR-specific
    pullRequestId: 0,
    eventType: 'push' as GitHubEventType,
    action: null,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: null,
    title: `Push to ${typeof ref === 'string' ? ref.replace('refs/heads/', '') : 'unknown'}`,
    body: null,
    state: null,
    baseBranch: null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Parse a check_suite event payload.
 * Only processes events with conclusion: 'failure'.
 * Returns null for non-failure conclusions (success, neutral, etc.)
 */
export function parseCheckSuiteEvent(
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  // Check for action
  const action = p['action'];
  if (typeof action !== 'string' || action !== 'completed') {
    return ok(null);
  }

  // Check for check_suite
  const checkSuite = p['check_suite'];
  if (!checkSuite || typeof checkSuite !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing or invalid check_suite' });
  }

  const cs = checkSuite as Record<string, unknown>;

  // Only process failures
  const conclusion = cs['conclusion'];
  if (typeof conclusion !== 'string' || conclusion !== 'failure') {
    return ok(null);
  }

  // Extract sender information
  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  // Extract repository
  const repository = p['repository'];
  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  // Extract check suite details
  const checkSuiteId = cs['id'];
  const headBranch = typeof cs['head_branch'] === 'string' ? cs['head_branch'] : null;
  const headSha = typeof cs['head_sha'] === 'string' ? cs['head_sha'] : null;

  // Extract pull requests array - check_suite includes associated PRs
  const pullRequests = cs['pull_requests'];
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    // No PRs associated with this check suite - can't correlate to a task
    return ok(null);
  }

  // Use the first PR for the event (check_suite events fire per-check-run, not per-PR)
  const firstPr = pullRequests[0] as Record<string, unknown>;
  const prNumber = firstPr['number'];
  const prId = firstPr['id'];
  const prBody = firstPr['body'] ?? null;
  const prState = firstPr['state'] ?? null;
  const prMergedAt = firstPr['merged_at'];

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data in check_suite' });
  }

  // Build a descriptive title from check suite info
  const title = `CI Check Failed: ${typeof headBranch === 'string' ? headBranch : 'unknown branch'}`;

  const createdAt = p['created_at'] ?? new Date().toISOString();

  // Note: check_runs are NOT included in check_suite webhook payloads.
  // To get individual check names, we would need to either:
  // 1. Use check_run events instead (each fires with name, conclusion, html_url)
  // 2. Fetch via REST API: GET /repos/{owner}/{repo}/check-suites/{id}/check-runs
  // For now, checkName will be 'Unknown Check' in the dispatch service.

  // Store check_suite metadata in payload for later extraction
  const enrichedPayload: Record<string, unknown> = {
    checkSuiteId: typeof checkSuiteId === 'number' ? checkSuiteId : null,
    headBranch,
    headSha,
    conclusion,
    originalPayload: payload,
  };

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    deliveryId: null,
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'check_suite' as GitHubEventType,
    action: 'completed' as const,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: null,
    title,
    body: typeof prBody === 'string' ? prBody : null,
    state: typeof prState === 'string' ? prState : null,
    baseBranch: headBranch,
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : prMergedAt instanceof Date
          ? prMergedAt
          : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload: enrichedPayload,
  });
}

/**
 * Parse a GitHub webhook event based on the event type.
 */
export function parseGitHubWebhookEvent(
  eventType: string,
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  switch (eventType) {
    case 'pull_request':
      return parsePullRequestEvent(payload);
    case 'pull_request_review':
      return parsePullRequestReviewEvent(payload);
    case 'pull_request_review_comment':
      return parsePullRequestReviewCommentEvent(payload);
    case 'issue_comment':
      return parseIssueCommentEvent(payload);
    case 'push':
      return parsePushEvent(payload);
    case 'check_suite':
      return parseCheckSuiteEvent(payload);
    case 'ping':
      // Ping events don't need to be stored
      return ok(null);
    default:
      // Unknown event type, ignore
      return ok(null);
  }
}
