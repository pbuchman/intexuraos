/**
 * PR endpoint implementations for the GitHub PR HTTP client.
 *
 * Each function returns the corresponding `GitHubPRClient` method result.
 * All HTTP plumbing lives in `fetchGitHub`; these functions only build
 * URLs, parse JSON, and map response shapes.
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  GitHubPRClientError,
  GitHubPullRequestDetails,
  GitHubPullRequestListItem,
  PullRequestFile,
  PullRequestStatus,
} from '../../../../domain/ports/gitHubPRClient.js';
import {
  GITHUB_API,
  ensureString,
  fetchGitHub,
  mapErrorStatus,
  parseNextPageUrl,
  type GitHubPRHttpClientConfig,
} from '../github-fetch-util.js';

const MAX_PAGES = 10;

function notFoundCtx(owner: string, repo: string, prNumber: number): string {
  return `PR #${String(prNumber)} not found in ${owner}/${repo}`;
}

export async function updatePRTitle(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  newTitle: string
): Promise<Result<void, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
    { method: 'PATCH', token, body: { title: newTitle } },
    config
  );
  if (!result.ok) return result;

  const response = result.value;
  if (response.ok) return ok(undefined);
  return err(mapErrorStatus(response.status, notFoundCtx(owner, repo, prNumber)));
}

export async function getPullRequestFiles(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Result<PullRequestFile[], GitHubPRClientError>> {
  const allFiles: PullRequestFile[] = [];
  let url: string | null = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}/files?per_page=100`;

  for (let page = 0; page < MAX_PAGES && url !== null; page++) {
    const result = await fetchGitHub(url, { method: 'GET', token }, config);
    if (!result.ok) return result;
    const response = result.value;

    if (!response.ok) {
      return err(mapErrorStatus(response.status, notFoundCtx(owner, repo, prNumber)));
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
}

export async function getPullRequestBaseBranch(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Result<string, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
    { method: 'GET', token },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (!response.ok) {
    return err(mapErrorStatus(response.status, notFoundCtx(owner, repo, prNumber)));
  }

  const data = (await response.json()) as { base?: { ref?: string } };
  const baseRef = data.base?.ref;
  if (typeof baseRef !== 'string') {
    return err({ code: 'API_ERROR', message: 'PR response missing base.ref' });
  }
  return ok(baseRef);
}

export async function getPullRequestStatus(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Result<PullRequestStatus, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
    { method: 'GET', token },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (!response.ok) {
    return err(mapErrorStatus(response.status, notFoundCtx(owner, repo, prNumber)));
  }

  const data = (await response.json()) as {
    state?: string;
    merged_at?: string | null;
    head?: { ref?: string };
  };

  const state = data.state;
  const headRef = data.head?.ref;
  if ((state !== 'open' && state !== 'closed') || typeof headRef !== 'string') {
    return err({ code: 'API_ERROR', message: 'PR response missing state or head.ref' });
  }

  return ok({
    state,
    mergedAt:
      data.merged_at !== null && data.merged_at !== undefined
        ? new Date(data.merged_at)
        : null,
    headRef,
  });
}

export async function getPullRequestDetails(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Result<GitHubPullRequestDetails, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(prNumber)}`,
    { method: 'GET', token },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (!response.ok) {
    return err(mapErrorStatus(response.status, notFoundCtx(owner, repo, prNumber)));
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
    created_at?: string;
  };

  if (typeof data.number !== 'number') {
    return err({ code: 'API_ERROR', message: 'GitHub API response missing number' });
  }

  const titleResult = ensureString(data.title, 'title');
  if (!titleResult.ok) return titleResult;

  const stateResult = ensureString(data.state, 'state');
  if (!stateResult.ok) return stateResult;
  if (stateResult.value !== 'open' && stateResult.value !== 'closed') {
    return err({
      code: 'API_ERROR',
      message: `GitHub API response has unexpected state: ${stateResult.value}`,
    });
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

  const createdAtResult = ensureString(data.created_at, 'created_at');
  if (!createdAtResult.ok) return createdAtResult;

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
    createdAt: createdAtResult.value,
  });
}

/**
 * Shared pagination-based listing for PR list endpoints. `notFoundContext`
 * is used as the error message on 404 (matches the original per-endpoint
 * wording).
 */
async function listPullRequestsPaginated(
  config: GitHubPRHttpClientConfig,
  token: string,
  firstUrl: string,
  notFoundContext: string
): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>> {
  const items: GitHubPullRequestListItem[] = [];
  let url: string | null = firstUrl;

  for (let page = 0; page < MAX_PAGES && url !== null; page++) {
    const result = await fetchGitHub(url, { method: 'GET', token }, config);
    if (!result.ok) return result;
    const response = result.value;

    if (!response.ok) {
      return err(mapErrorStatus(response.status, notFoundContext));
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
}

export async function listOpenPullRequestsByBaseBranch(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  baseBranch: string
): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100&sort=created&direction=asc`;
  return await listPullRequestsPaginated(
    config,
    token,
    url,
    `Failed to list open PRs for base branch ${baseBranch}`
  );
}

export async function listAllOpenPullRequests(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string
): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`;
  return await listPullRequestsPaginated(config, token, url, `Failed to list PRs for ${owner}/${repo}`);
}

export async function mergePullRequest(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  mergeMethod: 'merge',
  commitTitle?: string
): Promise<Result<{ sha: string; merged: boolean }, GitHubPRClientError>> {
  const body: Record<string, string> = { merge_method: mergeMethod };
  if (commitTitle !== undefined) {
    body['commit_title'] = commitTitle;
  }

  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(pullNumber)}/merge`,
    { method: 'PUT', token, body },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (response.ok) {
    const data = (await response.json()) as { sha: string; merged: boolean };
    return ok({ sha: data.sha, merged: data.merged });
  }

  // 405 = merge blocked (required checks failing, required reviews, branch protection, or already merged)
  // Parse the response body to distinguish "already merged" from genuinely blocked.
  if (response.status === 405) {
    const text = await response.text();
    const isAlreadyMerged = text.toLowerCase().includes('already merged');
    if (isAlreadyMerged) {
      return ok({ sha: '', merged: true });
    }
    return err({ code: 'API_ERROR', message: `PR #${String(pullNumber)} merge blocked: ${text}` });
  }

  // 409 = merge conflict at merge time
  if (response.status === 409) {
    return err({ code: 'API_ERROR', message: `PR #${String(pullNumber)} has a merge conflict` });
  }

  return err(
    mapErrorStatus(response.status, `Failed to merge PR #${String(pullNumber)} in ${owner}/${repo}`)
  );
}
