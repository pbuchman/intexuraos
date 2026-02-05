/**
 * Repository port for GitHub PR events.
 */

import type { Result } from '@intexuraos/common-core';
import type { GitHubPREvent, CreateGitHubPREventInput } from '../models/gitHubPREvent.js';

export type RepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string }
  | { code: 'DUPLICATE_EVENT'; message: string };

export interface GitHubPREventRepository {
  /**
   * Save a new GitHub PR event.
   * Returns error if event with same githubEventId already exists (deduplication).
   */
  save(input: CreateGitHubPREventInput): Promise<Result<GitHubPREvent, RepositoryError>>;

  /**
   * Find all events for a specific pull request.
   * Returns empty array if no events found.
   */
  findByPullRequest(
    repository: string,
    pullRequestNumber: number
  ): Promise<Result<GitHubPREvent[], RepositoryError>>;

  /**
   * Find recent events for a repository.
   * Returns empty array if no events found.
   */
  findByRepository(
    repository: string,
    limit?: number
  ): Promise<Result<GitHubPREvent[], RepositoryError>>;
}
