import type { Logger } from 'pino';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';

export interface ReconcileResult {
  /** Number of PRs for which reconciliation was attempted (includes both successes and per-PR errors). */
  attempted: number;
}

export interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
  reconcile(logger: Logger): Promise<ReconcileResult>;
}
