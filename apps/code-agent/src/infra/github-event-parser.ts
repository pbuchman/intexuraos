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

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data' });
  }

  const createdAt = p['created_at'] ?? new Date().toISOString();

  // Validate action is a known GitHubPRAction or null
  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'pull_request' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof prBody === 'string' ? prBody : null,
    state: typeof prState === 'string' ? prState : null,
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
    // CI event actions
    'completed',
    'requested',
    'in_progress',
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

  if (typeof prNumber !== 'number' || typeof prId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid pull_request data' });
  }

  const createdAt = p['created_at'] ?? new Date().toISOString();

  // Validate action is a known GitHubPRAction or null
  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'pull_request_review' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof prBody === 'string' ? prBody : null,
    state: typeof prState === 'string' ? prState : null,
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
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'pull_request_review_comment' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof commentBody === 'string' ? commentBody : null,
    state: typeof prState === 'string' ? prState : null,
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
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prNumber,
    pullRequestId: prId,
    eventType: 'issue_comment' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof prTitle === 'string' ? prTitle : null,
    body: typeof commentBody === 'string' ? commentBody : null,
    state: typeof prState === 'string' ? prState : null,
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
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: 0, // Push events are not PR-specific
    pullRequestId: 0,
    eventType: 'push' as GitHubEventType,
    action: null,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: `Push to ${typeof ref === 'string' ? ref.replace('refs/heads/', '') : 'unknown'}`,
    body: null,
    state: null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Extract PR linkage from a pull_requests array (used by CI events).
 * Returns { number, id } of the first linked PR, or { 0, 0 } if none.
 */
function extractPRLinkage(payload: Record<string, unknown>): { number: number; id: number } {
  const pullRequests = payload['pull_requests'];
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    return { number: 0, id: 0 };
  }

  const first = pullRequests[0] as Record<string, unknown> | undefined;
  if (first === undefined || typeof first !== 'object') {
    return { number: 0, id: 0 };
  }

  const prNumber = first['number'];
  const prId = first['id'];

  return {
    number: typeof prNumber === 'number' ? prNumber : 0,
    id: typeof prId === 'number' ? prId : 0,
  };
}

/**
 * Parse a workflow_run event payload.
 */
export function parseWorkflowRunEvent(
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
  const workflowRun = p['workflow_run'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  if (!workflowRun || typeof workflowRun !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing workflow_run' });
  }

  const run = workflowRun as Record<string, unknown>;
  const conclusion = run['conclusion'];
  const status = run['status'];
  const runName = run['name'];
  const prLink = extractPRLinkage(run);

  const createdAt = p['created_at'] ?? new Date().toISOString();

  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prLink.number,
    pullRequestId: prLink.id,
    eventType: 'workflow_run' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof runName === 'string' ? runName : null,
    body: null,
    state: typeof status === 'string'
      ? `${status}${typeof conclusion === 'string' ? `/${conclusion}` : ''}`
      : null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Parse a check_run event payload.
 */
export function parseCheckRunEvent(
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
  const checkRun = p['check_run'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  if (!checkRun || typeof checkRun !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing check_run' });
  }

  const cr = checkRun as Record<string, unknown>;
  const conclusion = cr['conclusion'];
  const status = cr['status'];
  const checkName = cr['name'];
  const prLink = extractPRLinkage(cr);

  const createdAt = p['created_at'] ?? new Date().toISOString();

  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prLink.number,
    pullRequestId: prLink.id,
    eventType: 'check_run' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: typeof checkName === 'string' ? checkName : null,
    body: null,
    state: typeof status === 'string'
      ? `${status}${typeof conclusion === 'string' ? `/${conclusion}` : ''}`
      : null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}

/**
 * Parse a check_suite event payload.
 */
export function parseCheckSuiteEvent(
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
  const checkSuite = p['check_suite'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  if (!checkSuite || typeof checkSuite !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing check_suite' });
  }

  const cs = checkSuite as Record<string, unknown>;
  const conclusion = cs['conclusion'];
  const status = cs['status'];
  const prLink = extractPRLinkage(cs);

  const createdAt = p['created_at'] ?? new Date().toISOString();

  const validatedAction =
    typeof action === 'string' && isValidGitHubPRAction(action) ? action : null;

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: prLink.number,
    pullRequestId: prLink.id,
    eventType: 'check_suite' as GitHubEventType,
    action: validatedAction,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    title: null,
    body: null,
    state: typeof status === 'string'
      ? `${status}${typeof conclusion === 'string' ? `/${conclusion}` : ''}`
      : null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
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
    case 'workflow_run':
      return parseWorkflowRunEvent(payload);
    case 'check_run':
      return parseCheckRunEvent(payload);
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
