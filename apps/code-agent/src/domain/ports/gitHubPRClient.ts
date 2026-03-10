/**
 * Port for interacting with GitHub Pull Requests.
 *
 * All methods use per-call tokens (user OAuth tokens resolved by the caller).
 */

import type { Result } from '@intexuraos/common-core';

export interface GitHubPRClientError {
  code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

/** A file changed in a pull request. */
export interface PullRequestFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
}

/** A commit in a pull request. */
export interface PullRequestCommit {
  sha: string;
  message: string;
  author: string;
}

export interface GitHubPRClient {
  /**
   * Update the title of a pull request.
   * Uses a per-call token (user OAuth token).
   */
  updatePRTitle(
    token: string,
    owner: string,
    repo: string,
    prNumber: number,
    newTitle: string
  ): Promise<Result<void, GitHubPRClientError>>;

  /**
   * Get the list of files changed in a pull request.
   * Uses a per-call token (user OAuth token).
   */
  getPullRequestFiles(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestFile[], GitHubPRClientError>>;

  /**
   * Get the list of commits in a pull request.
   * Uses a per-call token (user OAuth token).
   */
  getPullRequestCommits(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestCommit[], GitHubPRClientError>>;

  /**
   * Get the base branch of a pull request.
   * Uses a per-call token (user OAuth token).
   */
  getPullRequestBaseBranch(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<string, GitHubPRClientError>>;

  /**
   * Post a comment on a pull request (via the issues API).
   * Uses a per-call token (user OAuth token).
   */
  postPRComment(
    token: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<Result<{ commentId: number }, GitHubPRClientError>>;
}
