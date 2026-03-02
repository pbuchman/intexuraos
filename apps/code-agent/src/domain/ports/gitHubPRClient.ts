/**
 * Port for interacting with GitHub Pull Requests.
 *
 * Token is passed per-call to support per-user OAuth tokens.
 */

import type { Result } from '@intexuraos/common-core';

export interface GitHubPRClientError {
  code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

export interface GitHubPRClient {
  /**
   * Update the title of a pull request.
   *
   * @param token - OAuth token for authentication
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @param newTitle - New title for the PR
   */
  updatePRTitle(
    token: string,
    owner: string,
    repo: string,
    prNumber: number,
    newTitle: string
  ): Promise<Result<void, GitHubPRClientError>>;
}
