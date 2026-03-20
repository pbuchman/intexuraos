/**
 * HTTP implementation of GitHubPRClient.
 *
 * Uses the GitHub REST API to interact with pull requests.
 * All methods use per-call tokens (user OAuth tokens resolved by the caller).
 */

import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type {
  GitHubPRClient,
  GitHubPRClientError,
  GitHubPullRequestDetails,
  GitHubPullRequestListItem,
  PullRequestFile,
  PullRequestCommit,
  PullRequestStatus,
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

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1] ?? null;
}

function ensureString(value: unknown, field: string): Result<string, GitHubPRClientError> {
  if (typeof value !== 'string') {
    return err({ code: 'API_ERROR', message: `GitHub API response missing ${field}` });
  }

  return ok(value);
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
        const allFiles: PullRequestFile[] = [];
        let url: string | null = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/files?per_page=100`;
        const MAX_PAGES = 10;

        for (let page = 0; page < MAX_PAGES && url !== null; page++) {
          const response = await fetch(url, {
            method: 'GET',
            headers: githubHeaders(token),
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

    async getPullRequestBaseBranch(
      token: string,
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<string, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (!response.ok) {
          return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
        }

        const data = (await response.json()) as { base?: { ref?: string } };
        const baseRef = data.base?.ref;
        if (typeof baseRef !== 'string') {
          return err({ code: 'API_ERROR', message: 'PR response missing base.ref' });
        }
        return ok(baseRef);
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getPullRequestStatus(
      token: string,
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<PullRequestStatus, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (!response.ok) {
          return err(
            mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`)
          );
        }

        const data = (await response.json()) as {
          state?: string;
          merged_at?: string | null;
          head?: { ref?: string };
        };

        const state = data.state;
        const headRef = data.head?.ref;
        if ((state !== 'open' && state !== 'closed') || typeof headRef !== 'string') {
          return err({
            code: 'API_ERROR',
            message: 'PR response missing state or head.ref',
          });
        }

        return ok({
          state,
          mergedAt: data.merged_at !== null && data.merged_at !== undefined
            ? new Date(data.merged_at)
            : null,
          headRef,
        });
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

    async listOpenPullRequestsByBaseBranch(
      token: string,
      owner: string,
      repo: string,
      baseBranch: string
    ): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>> {
      try {
        const items: GitHubPullRequestListItem[] = [];
        let url: string | null =
          `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100&sort=created&direction=asc`;
        const MAX_PAGES = 10;

        for (let page = 0; page < MAX_PAGES && url !== null; page++) {
          const response = await fetch(url, {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          });

          if (!response.ok) {
            return err(mapErrorStatus(response.status, `Failed to list open PRs for base branch ${baseBranch}`));
          }

          const data = (await response.json()) as {
            number?: number;
            title?: string;
            user?: { login?: string };
            base?: { ref?: string };
            head?: { ref?: string };
            created_at?: string;
          }[];
          for (const pr of data) {
            if (typeof pr.number !== 'number') {
              return err({ code: 'API_ERROR', message: 'GitHub API response missing number' });
            }

            const titleResult = ensureString(pr.title, 'title');
            if (!titleResult.ok) return titleResult;

            const authorResult = ensureString(pr.user?.login, 'user.login');
            if (!authorResult.ok) return authorResult;

            const baseResult = ensureString(pr.base?.ref, 'base.ref');
            if (!baseResult.ok) return baseResult;

            const headResult = ensureString(pr.head?.ref, 'head.ref');
            if (!headResult.ok) return headResult;

            const createdAtResult = ensureString(pr.created_at, 'created_at');
            if (!createdAtResult.ok) return createdAtResult;

            items.push({
              number: pr.number,
              title: titleResult.value,
              authorLogin: authorResult.value,
              baseBranch: baseResult.value,
              headBranch: headResult.value,
              createdAt: createdAtResult.value,
            });
          }

          url = parseNextPageUrl(response.headers.get('link'));
        }

        return ok(items);
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getPullRequestDetails(
      token: string,
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<GitHubPullRequestDetails, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (!response.ok) {
          return err(mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`));
        }

        const data = (await response.json()) as {
          number?: number;
          title?: string;
          body?: string | null;
          state?: string;
          mergeable?: boolean | null;
          mergeable_state?: string | null;
          user?: { login?: string };
          base?: { ref?: string };
          head?: { ref?: string; sha?: string };
        };

        if (typeof data.number !== 'number') {
          return err({ code: 'API_ERROR', message: 'GitHub API response missing number' });
        }

        const titleResult = ensureString(data.title, 'title');
        if (!titleResult.ok) return titleResult;

        const stateResult = ensureString(data.state, 'state');
        if (!stateResult.ok) return stateResult;
        if (stateResult.value !== 'open' && stateResult.value !== 'closed') {
          return err({ code: 'API_ERROR', message: `GitHub API response has unexpected state: ${stateResult.value}` });
        }
        const state = stateResult.value;

        const authorResult = ensureString(data.user?.login, 'user.login');
        if (!authorResult.ok) return authorResult;

        const baseResult = ensureString(data.base?.ref, 'base.ref');
        if (!baseResult.ok) return baseResult;

        const headResult = ensureString(data.head?.ref, 'head.ref');
        if (!headResult.ok) return headResult;

        const headShaResult = ensureString(data.head?.sha, 'head.sha');
        if (!headShaResult.ok) return headShaResult;

        return ok({
          number: data.number,
          title: titleResult.value,
          body: data.body ?? null,
          state,
          authorLogin: authorResult.value,
          baseBranch: baseResult.value,
          headBranch: headResult.value,
          mergeable: data.mergeable ?? null,
          mergeableState: data.mergeable_state ?? null,
          headSha: headShaResult.value,
        });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getIssueComment(
      token: string,
      owner: string,
      repo: string,
      commentId: number,
    ): Promise<Result<{ body: string }, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${String(commentId)}`,
          {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (!response.ok) {
          return err(mapErrorStatus(response.status, `Comment #${String(commentId)} not found in ${owner}/${repo}`));
        }

        const data = (await response.json()) as { body?: string };
        return ok({ body: data.body ?? '' });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async updateIssueComment(
      token: string,
      owner: string,
      repo: string,
      commentId: number,
      body: string
    ): Promise<Result<{ commentId: number }, GitHubPRClientError>> {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${String(commentId)}`,
          {
            method: 'PATCH',
            headers: githubHeaders(token),
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (!response.ok) {
          return err(mapErrorStatus(response.status, `Comment #${String(commentId)} not found in ${owner}/${repo}`));
        }

        const data = (await response.json()) as { id?: number };
        if (typeof data.id !== 'number') {
          return err({ code: 'API_ERROR', message: 'GitHub API response missing comment id' });
        }

        return ok({ commentId: data.id });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async mergePullRequest(
      token: string,
      owner: string,
      repo: string,
      pullNumber: number,
      mergeMethod: 'merge',
      commitTitle?: string
    ): Promise<Result<{ sha: string; merged: boolean }, GitHubPRClientError>> {
      try {
        const body: Record<string, string> = { merge_method: mergeMethod };
        if (commitTitle !== undefined) {
          body['commit_title'] = commitTitle;
        }

        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(pullNumber)}/merge`,
          {
            method: 'PUT',
            headers: githubHeaders(token),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.timeoutMs),
          }
        );

        if (response.ok) {
          const data = (await response.json()) as { sha: string; merged: boolean };
          return ok({ sha: data.sha, merged: data.merged });
        }

        // 405 = already merged (idempotent)
        if (response.status === 405) {
          return ok({ sha: '', merged: true });
        }

        // 409 = merge conflict at merge time
        if (response.status === 409) {
          return err({ code: 'API_ERROR', message: `PR #${String(pullNumber)} has a merge conflict` });
        }

        return err(mapErrorStatus(response.status, `Failed to merge PR #${String(pullNumber)} in ${owner}/${repo}`));
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getCombinedCheckStatus(
      token: string,
      owner: string,
      repo: string,
      ref: string
    ): Promise<Result<{ state: 'success' | 'failure' | 'pending' }, GitHubPRClientError>> {
      try {
        const encodedRef = encodeURIComponent(ref);
        const headers = githubHeaders(token);
        const signal = AbortSignal.timeout(config.timeoutMs);

        // Query both legacy Commit Status API and modern Check Runs API in parallel
        const [statusResponse, checkRunsResponse] = await Promise.all([
          fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${encodedRef}/status`, {
            method: 'GET', headers, signal,
          }),
          fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${encodedRef}/check-runs`, {
            method: 'GET', headers, signal,
          }),
        ]);

        if (!statusResponse.ok) {
          return err(mapErrorStatus(statusResponse.status, `Failed to get commit status for ${ref} in ${owner}/${repo}`));
        }

        if (!checkRunsResponse.ok) {
          return err(mapErrorStatus(checkRunsResponse.status, `Failed to get check runs for ${ref} in ${owner}/${repo}`));
        }

        const statusData = (await statusResponse.json()) as { state: string; total_count: number };
        const checkRunsData = (await checkRunsResponse.json()) as {
          total_count: number;
          check_runs: { conclusion: string | null; status: string }[];
        };

        // Derive state from legacy commit statuses
        const hasStatuses = statusData.total_count > 0;
        const statusState: 'success' | 'failure' | 'pending' = statusData.state === 'success' ? 'success'
          : statusData.state === 'failure' || statusData.state === 'error' ? 'failure'
          : 'pending';

        // Derive state from check runs (GitHub Actions)
        const hasCheckRuns = checkRunsData.total_count > 0;
        let checkRunsState: 'success' | 'failure' | 'pending' = 'success';
        if (hasCheckRuns) {
          const anyFailed = checkRunsData.check_runs.some(
            (cr) => cr.conclusion === 'failure' || cr.conclusion === 'timed_out' || cr.conclusion === 'cancelled'
          );
          const anyPending = checkRunsData.check_runs.some(
            (cr) => cr.status !== 'completed'
          );
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
        if ((hasStatuses && statusState === 'failure') || (hasCheckRuns && checkRunsState === 'failure')) {
          return ok({ state: 'failure' });
        }

        // If any source reports pending, overall is pending
        if ((hasStatuses && statusState === 'pending') || (hasCheckRuns && checkRunsState === 'pending')) {
          return ok({ state: 'pending' });
        }

        // All reported sources are success
        return ok({ state: 'success' });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async listAllOpenPullRequests(
      token: string,
      owner: string,
      repo: string
    ): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>> {
      try {
        const items: GitHubPullRequestListItem[] = [];
        let url: string | null =
          `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`;
        const MAX_PAGES = 10;

        for (let page = 0; page < MAX_PAGES && url !== null; page++) {
          const response = await fetch(url, {
            method: 'GET',
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(config.timeoutMs),
          });

          if (!response.ok) {
            return err(mapErrorStatus(response.status, `Failed to list PRs for ${owner}/${repo}`));
          }

          const data = (await response.json()) as {
            number?: number;
            title?: string;
            user?: { login?: string };
            base?: { ref?: string };
            head?: { ref?: string };
            created_at?: string;
          }[];
          for (const pr of data) {
            if (typeof pr.number !== 'number') {
              return err({ code: 'API_ERROR', message: 'GitHub API response missing number' });
            }

            const titleResult = ensureString(pr.title, 'title');
            if (!titleResult.ok) return titleResult;

            const authorResult = ensureString(pr.user?.login, 'user.login');
            if (!authorResult.ok) return authorResult;

            const baseResult = ensureString(pr.base?.ref, 'base.ref');
            if (!baseResult.ok) return baseResult;

            const headResult = ensureString(pr.head?.ref, 'head.ref');
            if (!headResult.ok) return headResult;

            const createdAtResult = ensureString(pr.created_at, 'created_at');
            if (!createdAtResult.ok) return createdAtResult;

            items.push({
              number: pr.number,
              title: titleResult.value,
              authorLogin: authorResult.value,
              baseBranch: baseResult.value,
              headBranch: headResult.value,
              createdAt: createdAtResult.value,
            });
          }

          url = parseNextPageUrl(response.headers.get('link'));
        }

        return ok(items);
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
