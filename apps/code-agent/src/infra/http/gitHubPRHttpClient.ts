/**
 * HTTP implementation of GitHubPRClient.
 *
 * Uses the GitHub REST API to interact with pull requests.
 * All methods use per-call tokens (user OAuth tokens resolved by the caller).
 *
 * This file is intentionally a thin facade: each method delegates to an
 * endpoint module under `./github-pr/`, which shares a private
 * `fetchGitHub` wrapper that centralizes timeout, auth headers, body
 * serialization, and NETWORK_ERROR mapping.
 */

import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { GitHubPRHttpClientConfig } from './github-pr/github-fetch-util.js';
import {
  getPullRequestBaseBranch,
  getPullRequestDetails,
  getPullRequestFiles,
  getPullRequestStatus,
  listAllOpenPullRequests,
  listOpenPullRequestsByBaseBranch,
  mergePullRequest,
  updatePRTitle,
} from './github-pr/github-pr-endpoints/pull-requests.js';
import {
  getIssueComment,
  postPRComment,
  updateIssueComment,
} from './github-pr/github-pr-endpoints/reviews.js';
import { getCombinedCheckStatus } from './github-pr/github-pr-endpoints/checks.js';
import { getPullRequestCommits } from './github-pr/github-pr-endpoints/commits.js';

export type { GitHubPRHttpClientConfig } from './github-pr/github-fetch-util.js';

export function createGitHubPRHttpClient(config: GitHubPRHttpClientConfig): GitHubPRClient {
  return {
    updatePRTitle: (token, owner, repo, prNumber, newTitle) =>
      updatePRTitle(config, token, owner, repo, prNumber, newTitle),

    getPullRequestFiles: (token, owner, repo, prNumber) =>
      getPullRequestFiles(config, token, owner, repo, prNumber),

    getPullRequestCommits: (token, owner, repo, prNumber) =>
      getPullRequestCommits(config, token, owner, repo, prNumber),

    getPullRequestBaseBranch: (token, owner, repo, prNumber) =>
      getPullRequestBaseBranch(config, token, owner, repo, prNumber),

    getPullRequestStatus: (token, owner, repo, prNumber) =>
      getPullRequestStatus(config, token, owner, repo, prNumber),

    postPRComment: (token, owner, repo, prNumber, body) =>
      postPRComment(config, token, owner, repo, prNumber, body),

    listOpenPullRequestsByBaseBranch: (token, owner, repo, baseBranch) =>
      listOpenPullRequestsByBaseBranch(config, token, owner, repo, baseBranch),

    getPullRequestDetails: (token, owner, repo, prNumber) =>
      getPullRequestDetails(config, token, owner, repo, prNumber),

    getIssueComment: (token, owner, repo, commentId) =>
      getIssueComment(config, token, owner, repo, commentId),

    updateIssueComment: (token, owner, repo, commentId, body) =>
      updateIssueComment(config, token, owner, repo, commentId, body),

    mergePullRequest: (token, owner, repo, pullNumber, mergeMethod, commitTitle) =>
      mergePullRequest(config, token, owner, repo, pullNumber, mergeMethod, commitTitle),

    getCombinedCheckStatus: (token, owner, repo, ref) =>
      getCombinedCheckStatus(config, token, owner, repo, ref),

    listAllOpenPullRequests: (token, owner, repo) =>
      listAllOpenPullRequests(config, token, owner, repo),
  };
}
