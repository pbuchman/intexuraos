/**
 * Commit/check-run status endpoint implementation.
 *
 * Queries both the legacy Commit Status API and the modern Check Runs API
 * in parallel using a shared AbortSignal, then combines their states.
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import type { GitHubPRClientError } from '../../../../domain/ports/gitHubPRClient.js';
import {
  GITHUB_API,
  fetchGitHub,
  mapErrorStatus,
  type GitHubPRHttpClientConfig,
} from '../github-fetch-util.js';

export async function getCombinedCheckStatus(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<Result<{ state: 'success' | 'failure' | 'pending' }, GitHubPRClientError>> {
  const encodedRef = encodeURIComponent(ref);
  // Share a single timeout signal across both parallel fetches so the pair
  // cancels together — matches the original client's semantics.
  const signal = AbortSignal.timeout(config.timeoutMs);

  const [statusResult, checkRunsResult] = await Promise.all([
    fetchGitHub(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodedRef}/status`,
      { method: 'GET', token, signal },
      config
    ),
    fetchGitHub(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodedRef}/check-runs`,
      { method: 'GET', token, signal },
      config
    ),
  ]);

  if (!statusResult.ok) return statusResult;
  if (!checkRunsResult.ok) return checkRunsResult;

  const statusResponse = statusResult.value;
  const checkRunsResponse = checkRunsResult.value;

  if (!statusResponse.ok) {
    return err(
      mapErrorStatus(
        statusResponse.status,
        `Failed to get commit status for ${ref} in ${owner}/${repo}`
      )
    );
  }

  if (!checkRunsResponse.ok) {
    return err(
      mapErrorStatus(
        checkRunsResponse.status,
        `Failed to get check runs for ${ref} in ${owner}/${repo}`
      )
    );
  }

  const statusData = (await statusResponse.json()) as { state: string; total_count: number };
  const checkRunsData = (await checkRunsResponse.json()) as {
    total_count: number;
    check_runs: { conclusion: string | null; status: string }[];
  };

  // Derive state from legacy commit statuses
  const hasStatuses = statusData.total_count > 0;
  const statusState: 'success' | 'failure' | 'pending' =
    statusData.state === 'success'
      ? 'success'
      : statusData.state === 'failure' || statusData.state === 'error'
        ? 'failure'
        : 'pending';

  // Derive state from check runs (GitHub Actions)
  const hasCheckRuns = checkRunsData.total_count > 0;
  let checkRunsState: 'success' | 'failure' | 'pending' = 'success';
  if (hasCheckRuns) {
    const anyFailed = checkRunsData.check_runs.some(
      (cr) =>
        cr.conclusion === 'failure' ||
        cr.conclusion === 'timed_out' ||
        cr.conclusion === 'cancelled'
    );
    const anyPending = checkRunsData.check_runs.some((cr) => cr.status !== 'completed');
    if (anyFailed) {
      checkRunsState = 'failure';
    } else if (anyPending) {
      checkRunsState = 'pending';
    }
  }

  // Combine: if neither API has results, return pending
  if (!hasStatuses && !hasCheckRuns) {
    return ok({ state: 'pending' });
  }

  // If any source reports failure, overall is failure
  if (
    (hasStatuses && statusState === 'failure') ||
    (hasCheckRuns && checkRunsState === 'failure')
  ) {
    return ok({ state: 'failure' });
  }

  // If any source reports pending, overall is pending
  if (
    (hasStatuses && statusState === 'pending') ||
    (hasCheckRuns && checkRunsState === 'pending')
  ) {
    return ok({ state: 'pending' });
  }

  // All reported sources are success
  return ok({ state: 'success' });
}
