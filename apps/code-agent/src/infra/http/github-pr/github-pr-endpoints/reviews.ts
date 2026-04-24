/**
 * Review-related endpoint implementations (issue comments are used for
 * PR reviews in this codebase).
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import type { GitHubPRClientError } from '../../../../domain/ports/gitHubPRClient.js';
import {
  GITHUB_API,
  fetchGitHub,
  mapErrorStatus,
  type GitHubPRHttpClientConfig,
} from '../github-fetch-util.js';

export async function postPRComment(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<Result<{ commentId: number }, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${String(prNumber)}/comments`,
    { method: 'POST', token, body: { body } },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (response.ok) {
    const data = (await response.json()) as { id: number };
    return ok({ commentId: data.id });
  }

  return err(
    mapErrorStatus(response.status, `PR #${String(prNumber)} not found in ${owner}/${repo}`)
  );
}

export async function getIssueComment(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  commentId: number
): Promise<Result<{ body: string }, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${String(commentId)}`,
    { method: 'GET', token },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (!response.ok) {
    return err(
      mapErrorStatus(response.status, `Comment #${String(commentId)} not found in ${owner}/${repo}`)
    );
  }

  const data = (await response.json()) as { body?: string };
  return ok({ body: data.body ?? '' });
}

export async function updateIssueComment(
  config: GitHubPRHttpClientConfig,
  token: string,
  owner: string,
  repo: string,
  commentId: number,
  body: string
): Promise<Result<{ commentId: number }, GitHubPRClientError>> {
  const result = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${String(commentId)}`,
    { method: 'PATCH', token, body: { body } },
    config
  );
  if (!result.ok) return result;
  const response = result.value;

  if (!response.ok) {
    return err(
      mapErrorStatus(response.status, `Comment #${String(commentId)} not found in ${owner}/${repo}`)
    );
  }

  const data = (await response.json()) as { id?: number };
  if (typeof data.id !== 'number') {
    return err({ code: 'API_ERROR', message: 'GitHub API response missing comment id' });
  }

  return ok({ commentId: data.id });
}
