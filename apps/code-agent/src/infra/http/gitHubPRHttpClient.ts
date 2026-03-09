/**
 * HTTP implementation of GitHubPRClient.
 *
 * Uses the GitHub REST API to interact with pull requests.
 * Token is passed per-call to support per-user OAuth tokens
 * or platform-level bot tokens.
 */

import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type {
  GitHubPRClient,
  GitHubPRClientError,
  PullRequestFile,
  PullRequestCommit,
} from '../../domain/ports/gitHubPRClient.js';

export interface GitHubPRHttpClientConfig {
  timeoutMs: number;
}

const GITHUB_API = 'https://api.github.com';

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function mapErrorStatus(status: number, context: string): GitHubPRClientError {
  if (status === 401 || status === 403) {
    return { code: 'UNAUTHORIZED', message: `GitHub API returned ${String(status)}: unauthorized or forbidden` };
  }
  if (status === 404) {
    return { code: 'NOT_FOUND', message: context };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', message: 'GitHub API rate limit exceeded' };
  }
  return { code: 'API_ERROR', message: `GitHub API returned ${String(status)}` };
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
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
          {
            method: 'PATCH',
            headers: githubHeaders(token),
            body: JSON.stringify({ title: newTitle }),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (response.ok) {
          return ok(undefined);
        }

        return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getPullRequestFiles(
      token: string,
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<PullRequestFile[], GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/files?per_page=100`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (response.ok) {
          const data = (await response.json()) as {
            filename: string;
            status: string;
            additions: number;
            deletions: number;
          }[];
          return ok(
            data.map((f) => ({
              filename: f.filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
            }))
          );
        }

        return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getPullRequestCommits(
      token: string,
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<PullRequestCommit[], GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/commits?per_page=100`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

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

        return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async postPRComment(
      token: string,
      owner: string,
      repo: string,
      prNumber: number,
      body: string
    ): Promise<Result<{ commentId: number }, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/${String(prNumber)}/comments`,
          {
            method: 'POST',
            headers: githubHeaders(token),
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (response.ok) {
          const data = (await response.json()) as { id: number };
          return ok({ commentId: data.id });
        }

        return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
