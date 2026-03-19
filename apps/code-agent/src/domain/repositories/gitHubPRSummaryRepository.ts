/**
 * Repository port for GitHub PR summaries.
 */

import type { Result } from '@intexuraos/common-core';
import type { GitHubPRSummary, UpsertGitHubPRSummaryInput } from '../models/gitHubPRSummary.js';

export interface SummaryRepositoryError { code: 'FIRESTORE_ERROR'; message: string }

export interface GitHubPRSummaryRepository {
  /**
   * Upsert a PR summary document.
   * Creates if not exists, merges title/state/mergedAt when present in input.
   */
  upsert(input: UpsertGitHubPRSummaryInput): Promise<Result<void, SummaryRepositoryError>>;

  /**
   * Find PRs with lastActivityAt within the last N days, newest-activity first.
   */
  findRecentlyActive(withinDays: number): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>>;

  /**
   * Find a PR summary by repository and pull request number.
   */
  findByPullRequest(
    repository: string,
    pullRequestNumber: number
  ): Promise<Result<GitHubPRSummary | null, SummaryRepositoryError>>;

  /**
   * Find open PR summaries for a repository/base-branch pair.
   */
  findOpenByBaseBranch(
    repository: string,
    baseBranch: string
  ): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>>;

  /**
   * Find all open PR summaries across all repositories and base branches.
   */
  findAllOpen(): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>>;
}
