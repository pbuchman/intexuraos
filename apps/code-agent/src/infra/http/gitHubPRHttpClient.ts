/**
 * HTTP client for GitHub PR operations.
 * Uses native fetch to update PR metadata via the GitHub REST API.
 */

import { ok, err } from '@intexuraos/common-core';
import type { Result, Logger } from '@intexuraos/common-core';
import type { GitHubPRClient, GitHubPRClientError } from '../../domain/ports/gitHubPRClient.js';

export interface GitHubPRHttpClientConfig {
  token: string;
  timeoutMs: number;
}

export function createGitHubPRHttpClient(
  config: GitHubPRHttpClientConfig,
  logger: Logger
): GitHubPRClient {
  const { token, timeoutMs } = config;

  return {
    async updatePRTitle(
      owner: string,
      repo: string,
      prNumber: number,
      newTitle: string
    ): Promise<Result<void, GitHubPRClientError>> {
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${String(prNumber)}`;

      logger.info({ owner, repo, prNumber }, 'Updating PR title via GitHub API');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ title: newTitle }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'GitHub updatePRTitle failed');

          if (response.status === 401 || response.status === 403) {
            return err({ code: 'UNAUTHORIZED', message: errorText });
          }
          if (response.status === 404) {
            return err({ code: 'NOT_FOUND', message: errorText });
          }
          if (response.status >= 500) {
            return err({ code: 'UNAVAILABLE', message: errorText });
          }
          return err({ code: 'UNKNOWN', message: errorText });
        }

        logger.info({ owner, repo, prNumber }, 'PR title updated');
        return ok(undefined);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'GitHub API request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'GitHub API request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
