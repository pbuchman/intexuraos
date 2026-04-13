/**
 * PR URL validation utility (INT-1361).
 *
 * Validates that a PR URL reported by the execution agent actually matches
 * the expected task context: PR exists, title contains the Linear issue ID,
 * and the PR was created after the task was dispatched.
 *
 * Flags issues but does NOT block task completion — validation failures are
 * stored as metadata on the CodeTask for downstream triage.
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPRClient, GitHubPullRequestDetails } from '../ports/gitHubPRClient.js';

export interface PrUrlValidationParams {
  prUrl: string;
  prNumber: number;
  linearIssueId: string;
  dispatchedAt?: Date;
  token: string;
  owner: string;
  repo: string;
  gitHubPRClient: GitHubPRClient;
  logger: Logger;
}

export interface PrUrlValidationResult {
  failed: boolean;
  errors: string[];
}

export async function validatePrUrl(params: PrUrlValidationParams): Promise<PrUrlValidationResult> {
  const { prUrl, prNumber, linearIssueId, dispatchedAt, token, owner, repo, gitHubPRClient, logger } = params;
  const errors: string[] = [];

  // 1. Verify PR exists
  const detailsResult = await gitHubPRClient.getPullRequestDetails(token, owner, repo, prNumber);
  if (!detailsResult.ok) {
    const code = detailsResult.error.code;
    if (code === 'NOT_FOUND') {
      errors.push(`PR #${String(prNumber)} does not exist in ${owner}/${repo}`);
    } else {
      // Non-fatal: can't validate, but don't flag as failed
      logger.warn({ prUrl, errorCode: code }, 'PR URL validation skipped: GitHub API error');
      return { failed: false, errors: [] };
    }
    return { failed: errors.length > 0, errors };
  }

  const pr: GitHubPullRequestDetails = detailsResult.value;

  // 2. Verify PR title contains Linear issue ID
  if (!pr.title.includes(linearIssueId)) {
    errors.push(`PR title "${pr.title}" does not contain expected Linear issue ID "${linearIssueId}"`);
  }

  // 3. Verify PR was created after task dispatch
  if (dispatchedAt !== undefined) {
    const prCreatedAt = new Date(pr.createdAt);
    if (prCreatedAt.getTime() < dispatchedAt.getTime()) {
      errors.push(
        `PR was created at ${pr.createdAt} before task was dispatched at ${dispatchedAt.toISOString()}`
      );
    }
  }

  if (errors.length > 0) {
    logger.warn({ prUrl, prNumber, linearIssueId, errors }, 'PR URL validation failed');
  }

  return { failed: errors.length > 0, errors };
}
