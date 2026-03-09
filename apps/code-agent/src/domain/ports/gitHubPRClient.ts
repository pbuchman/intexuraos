/**
 * Port for interacting with GitHub Pull Requests.
 *
 * Token is passed per-call to support per-user OAuth tokens
 * or platform-level bot tokens.
 */

import type { Result } from '@intexuraos/common-core';

export interface GitHubPRClientError {
  code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

/** A file changed in a pull request. */
export interface PullRequestFile {
  filename: string;
  status: string;
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
   */
  getPullRequestFiles(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestFile[], GitHubPRClientError>>;

  /**
   * Get the list of commits in a pull request.
   */
  getPullRequestCommits(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestCommit[], GitHubPRClientError>>;

  /**
   * Post a comment on a pull request (via the issues API).
   */
  postPRComment(
    token: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<Result<{ commentId: number }, GitHubPRClientError>>;
}
