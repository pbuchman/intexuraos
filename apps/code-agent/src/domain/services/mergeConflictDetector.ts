import type { Logger } from 'pino';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';

export interface ReconcileResult {
  /** Number of PRs processed (includes both successes and per-PR errors; excludes skipped invalid repos). */
  processed: number;
  /** PRs whose GitHub state is 'closed' or merged — skipped without conflict check. */
  closed: number;
  /** PRs with detected merge conflicts against the base branch. */
  conflicting: number;
  /** PRs with no merge conflicts (mergeable). */
  clean: number;
  /** PRs whose mergeability could not be determined by GitHub. */
  unknown: number;
  /** PRs intentionally skipped (e.g. no OAuth user found, failed to load PR details). */
  skipped: number;
  /** PRs that threw an unhandled exception during processing. */
  error: number;
}

/** Zero-valued result for early returns where no PRs were processed. */
export const EMPTY_RECONCILE_RESULT: ReconcileResult = Object.freeze({
  processed: 0,
  closed: 0,
  conflicting: 0,
  clean: 0,
  unknown: 0,
  skipped: 0,
  error: 0,
});

export interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
  reconcile(logger: Logger): Promise<ReconcileResult>;
}
