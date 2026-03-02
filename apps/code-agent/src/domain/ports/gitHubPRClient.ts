/**
 * Port for GitHub PR operations.
 * Used to update PR metadata (e.g., title) for Linear auto-linking.
 */

import type { Result } from '@intexuraos/common-core';

export type GitHubPRClientErrorCode = 'UNAVAILABLE' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNKNOWN';

export interface GitHubPRClientError {
  code: GitHubPRClientErrorCode;
  message: string;
}

export interface GitHubPRClient {
  updatePRTitle(
    owner: string,
    repo: string,
    prNumber: number,
    newTitle: string
  ): Promise<Result<void, GitHubPRClientError>>;
}
