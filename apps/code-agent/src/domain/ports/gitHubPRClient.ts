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

export interface PullRequestStatus {
  state: 'open' | 'closed';
  mergedAt: Date | null;
  headRef: string;
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

export interface GitHubPullRequestListItem {
  number: number;
  title: string;
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  createdAt: string;
}

export interface GitHubPullRequestDetails {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  headSha: string;
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
   * Get current PR state and head branch.
   * Used to verify whether retries should continue on an existing PR.
   */
  getPullRequestStatus(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<PullRequestStatus, GitHubPRClientError>>;

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

  /**
   * List open pull requests targeting a specific base branch.
   */
  listOpenPullRequestsByBaseBranch(
    token: string,
    owner: string,
    repo: string,
    baseBranch: string
  ): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>>;

  /**
   * Get full pull request details, including mergeability.
   */
  getPullRequestDetails(
    token: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<GitHubPullRequestDetails, GitHubPRClientError>>;

  /**
   * Get an existing issue comment by ID.
   * Used to read the current comment body before appending new content.
   */
  getIssueComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
  ): Promise<Result<{ body: string }, GitHubPRClientError>>;

  /**
   * Update an existing issue comment.
   */
  updateIssueComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<Result<{ commentId: number }, GitHubPRClientError>>;

  /**
   * Merge a pull request. Returns 405 if already merged — treat as success.
   */
  mergePullRequest(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
    mergeMethod: 'merge',
    commitTitle?: string
  ): Promise<Result<{ sha: string; merged: boolean }, GitHubPRClientError>>;

  /**
   * Get combined status check state for a commit ref.
   */
  getCombinedCheckStatus(
    token: string,
    owner: string,
    repo: string,
    ref: string
  ): Promise<Result<{ state: 'success' | 'failure' | 'pending' }, GitHubPRClientError>>;

  /**
   * List all open pull requests in a repo (not filtered by base branch).
   * Used by the branches endpoint to group by base branch.
   */
  listAllOpenPullRequests(
    token: string,
    owner: string,
    repo: string
  ): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>>;
}
