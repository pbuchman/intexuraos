import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import { parseOwnerRepo } from './parseOwnerRepo.js';

export interface MergePlanPrDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
}

export interface MergePlanPrInput {
  planningPrUrl: string;
  repository: string;
  token: string;
}

export interface MergePlanPrError {
  code: 'plan_pr_merge_failed';
  message: string;
}

function parsePrNumber(url: string): number | undefined {
  const match = /\/pull\/(\d+)/.exec(url);
  if (match?.[1] === undefined) return undefined;
  return Number(match[1]);
}

/**
 * Merge a plan PR into development via the GitHub API.
 * Idempotent: already-merged PRs are treated as success.
 */
export async function mergePlanPr(
  deps: MergePlanPrDeps,
  input: MergePlanPrInput,
): Promise<Result<void, MergePlanPrError>> {
  const { logger, gitHubPRClient } = deps;
  const { planningPrUrl, repository, token } = input;

  const prNumber = parsePrNumber(planningPrUrl);
  if (prNumber === undefined) {
    return err({
      code: 'plan_pr_merge_failed',
      message: `Could not parse PR number from plan PR URL: ${planningPrUrl}`,
    });
  }

  const parsed = parseOwnerRepo(repository);
  if (parsed === null) {
    return err({
      code: 'plan_pr_merge_failed',
      message: `Invalid repository format: ${repository}`,
    });
  }

  const { owner, repo } = parsed;

  const statusResult = await gitHubPRClient.getPullRequestStatus(
    token, owner, repo, prNumber,
  );

  if (!statusResult.ok) {
    const msg = statusResult.error.code === 'NOT_FOUND'
      ? `Plan PR #${String(prNumber)} not found. It may have been deleted.`
      : `Failed to check plan PR #${String(prNumber)} status: ${statusResult.error.message}`;
    logger.warn({ prNumber, error: statusResult.error }, msg);
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  const status = statusResult.value;

  if (status.mergedAt !== null) {
    logger.info({ prNumber, mergedAt: status.mergedAt }, 'Plan PR already merged — proceeding');
    return ok(undefined);
  }

  if (status.state === 'closed') {
    const msg = `Plan PR #${String(prNumber)} was closed without merging. Reopen and merge the plan PR, or create a new planning task.`;
    logger.warn({ prNumber }, msg);
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  const commitTitle = `[plan] Merge plan PR #${String(prNumber)}`;
  const mergeResult = await gitHubPRClient.mergePullRequest(
    token, owner, repo, prNumber, 'merge', commitTitle,
  );

  if (!mergeResult.ok) {
    const msg = `Failed to merge plan PR #${String(prNumber)}: ${mergeResult.error.message}. The plan PR may have merge conflicts with the development branch. Resolve conflicts manually, then retry.`;
    logger.warn({ prNumber, error: mergeResult.error }, 'Plan PR merge failed');
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  logger.info(
    { prNumber, sha: mergeResult.value.sha, merged: mergeResult.value.merged },
    'Plan PR merged into development successfully',
  );

  return ok(undefined);
}
