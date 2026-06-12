/**
 * Commit-listing endpoint for pull requests.
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  GitHubPRClientError,
  PullRequestCommit,
} from '../../../../domain/ports/gitHubPRClient.js';
import {
  GITHUB_API,
  fetchGitHub,
  mapErrorStatus,
  type GitHubPRHttpClientConfig,
} from '../github-fetch-util.js';

export async function getPullRequestCommits(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Result<PullRequestCommit[], GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/commits?per_page=100`,
    { method: 'GET', token },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (response.ok) {
    const data = (await response.json()) as {
      sha: string;
      commit: { message: string };
      author: { login: string } | null;
    }[];
    return ok(
      data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.author?.login ?? 'unknown',
      }))
    );
  }

  return err(
    mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`)
  );
}
