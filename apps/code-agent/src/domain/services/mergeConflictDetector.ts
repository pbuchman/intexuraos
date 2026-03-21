import type { Logger } from 'pino';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';

export interface ReconcileResult {
  /** Number of summaries processed (state transitions + skips). */
  processed: number;
  /** Summaries transitioned from open → closed (PR no longer on GitHub). */
  closed: number;
  /** Summaries transitioned from non-open → open (PR reappeared on GitHub). */
  reopened: number;
  /** Open summaries whose mergeConflictStatus was refreshed from GitHub. */
  mergeConflictRefreshed: number;
  /** Summaries intentionally skipped (e.g. no OAuth user found, API error). */
  skipped: number;
  /** Summaries that threw an unhandled exception during processing. */
  error: number;
}

/** Zero-valued result for early returns where no summaries were processed. */
export const EMPTY_RECONCILE_RESULT: ReconcileResult = Object.freeze({
  processed: 0,
  closed: 0,
  reopened: 0,
  mergeConflictRefreshed: 0,
  skipped: 0,
  error: 0,
});

export interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
  reconcile(logger: Logger): Promise<ReconcileResult>;
}
