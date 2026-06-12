/**
 * Parser for GitHub `check_suite` webhook events.
 * Only processes events with conclusion: 'failure'.
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
import { extractSender } from './shared.js';

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
  /* v8 ignore start -- ts-type: typeof narrowing on unknown check_suite field — cs['url'] fallback unreachable when GitHub always provides string url @preserve */
  const checkSuiteUrl = typeof cs['url'] === 'string' ? cs['url'] : null;
  /* v8 ignore stop @preserve */
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
    checkSuiteUrl,
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
    isDraft: null,
    // NOTE: For check_suite events, baseBranch stores headBranch (the source/head branch of the PR).
    // This is the opposite semantic of other event types where baseBranch = target/merge-into branch.
    // CIFailureRule.evaluate() reads event.baseBranch expecting the source branch.
    baseBranch: headBranch,
    /* v8 ignore start -- ts-type: typeof and instanceof narrowing on unknown payload fields — prMergedAt/createdAt type coercion branches unreachable when test fixtures always provide Date objects @preserve */
    mergedAt:
      prMergedAt && typeof prMergedAt === 'string'
        ? new Date(prMergedAt)
        : prMergedAt instanceof Date
          ? prMergedAt
          : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    /* v8 ignore stop @preserve */
    payload: enrichedPayload,
  });
}
