/**
 * HTTP implementation of GitHubPRClient.
 *
 * Uses the GitHub REST API to interact with pull requests.
 * Bot methods use the platform token baked into the client at factory time.
 * Only updatePRTitle takes a per-call token for user OAuth tokens.
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
  githubBotToken?: string;
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

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1] ?? null;
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
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<PullRequestFile[], GitHubPRClientError>> {
      if (config.githubBotToken === undefined) {
        return err({ code: 'UNAUTHORIZED', message: 'GitHub bot token not configured' });
      }
      const botToken = config.githubBotToken;

      try {
        const allFiles: PullRequestFile[] = [];
        let url: string | null = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/files?per_page=100`;
        const MAX_PAGES = 10;

        for (let page = 0; page < MAX_PAGES && url !== null; page++) {
          const response = await fetch(url, {
            method: 'GET',
            headers: githubHeaders(botToken),
            signal: AbortSignal.timeout(config.timeoutMs),
          });

          if (!response.ok) {
            return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
          }

          const data = (await response.json()) as {
            filename: string;
            status: string;
            additions: number;
            deletions: number;
          }[];
          allFiles.push(
            ...data.map((f) => ({
              filename: f.filename,
              status: f.status as PullRequestFile['status'],
              additions: f.additions,
              deletions: f.deletions,
            }))
          );
          url = parseNextPageUrl(response.headers.get('link'));
        }

        return ok(allFiles);
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getPullRequestCommits(
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<PullRequestCommit[], GitHubPRClientError>> {
      if (config.githubBotToken === undefined) {
        return err({ code: 'UNAUTHORIZED', message: 'GitHub bot token not configured' });
      }
      const botToken = config.githubBotToken;

      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/commits?per_page=100`,
          {
            method: 'GET',
            headers: githubHeaders(botToken),
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
      owner: string,
      repo: string,
      prNumber: number,
      body: string
    ): Promise<Result<{ commentId: number }, GitHubPRClientError>> {
      if (config.githubBotToken === undefined) {
        return err({ code: 'UNAUTHORIZED', message: 'GitHub bot token not configured' });
      }
      const botToken = config.githubBotToken;

      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/${String(prNumber)}/comments`,
          {
            method: 'POST',
            headers: githubHeaders(botToken),
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
