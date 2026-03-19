import type { Logger } from 'pino';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';

export interface ReconcileResult {
  checked: number;
}

export interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
  reconcile(logger: Logger): Promise<ReconcileResult>;
}
