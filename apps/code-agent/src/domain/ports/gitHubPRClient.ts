/**
 * Port for interacting with GitHub Pull Requests.
 *
 * Bot methods (getPullRequestFiles, getPullRequestCommits, postPRComment)
 * use the platform token baked into the client at factory time.
 * Only updatePRTitle takes a per-call token for user OAuth tokens.
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
   * Uses the platform bot token baked into the client at factory time.
   */
  getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestFile[], GitHubPRClientError>>;

  /**
   * Get the list of commits in a pull request.
   * Uses the platform bot token baked into the client at factory time.
   */
  getPullRequestCommits(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestCommit[], GitHubPRClientError>>;

  /**
   * Post a comment on a pull request (via the issues API).
   * Uses the platform bot token baked into the client at factory time.
   */
  postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<Result<{ commentId: number }, GitHubPRClientError>>;
}
