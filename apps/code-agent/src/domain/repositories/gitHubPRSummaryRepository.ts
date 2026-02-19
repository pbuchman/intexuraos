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
}
