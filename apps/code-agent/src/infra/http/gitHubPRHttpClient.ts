/**
 * HTTP implementation of GitHubPRClient.
 *
 * Uses the GitHub REST API to update pull requests.
 * Token is passed per-call to support per-user OAuth tokens.
 */

import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { GitHubPRClient, GitHubPRClientError } from '../../domain/ports/gitHubPRClient.js';

export interface GitHubPRHttpClientConfig {
  timeoutMs: number;
}

export function createGitHubPRHttpClient(
  config: GitHubPRHttpClientConfig
): GitHubPRClient {
  return {
    async updatePRTitle(
      token: string,
      owner: string,
      repo: string,
      prNumber: number,
      newTitle: string
    ): Promise<Result<void, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ title: newTitle }),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (response.ok) {
          return ok(undefined);
        }

        if (response.status === 401 || response.status === 403) {
          return err({
            code: 'UNAUTHORIZED',
            message: `GitHub API returned ${String(response.status)}: unauthorized or forbidden`,
          });
        }

        if (response.status === 404) {
          return err({
            code: 'NOT_FOUND',
            message: `PR #${String(prNumber)} not found in ${owner}/${repo}`,
          });
        }

        if (response.status === 429) {
          return err({
            code: 'RATE_LIMITED',
            message: 'GitHub API rate limit exceeded',
          });
        }

        return err({
          code: 'API_ERROR',
          message: `GitHub API returned ${String(response.status)}`,
        });
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
