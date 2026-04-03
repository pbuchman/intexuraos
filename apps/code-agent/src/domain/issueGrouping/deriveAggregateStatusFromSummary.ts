import type { GroupStatus } from './types.js';

export interface GroupSummaryFields {
  activeTaskCount: number;
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  hasCompletedExecutionAgent: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  latestTaskStatus: string;
  latestReviewNeedsRemediation: boolean | null;
  /** Whether the Linear issue has the ready-to-implement (or code-task) label. undefined = unknown, use pessimistic default (true). */
  hasImplementationReadyLabel?: boolean;
  /** Whether the Linear issue has the ready-to-merge label. undefined = unknown, use conservative default (false). */
  hasMergeReadyLabel?: boolean;
}

export function deriveAggregateStatusFromSummary(fields: GroupSummaryFields): GroupStatus {
  // 1. Active: any task is running/dispatched/queued
  if (fields.activeTaskCount > 0) {
    return 'active';
  }

  // 1b. Active: execution agent completed but review hasn't cleared it
  if (fields.hasCompletedExecutionAgent && fields.latestReviewNeedsRemediation !== false) {
    return 'active';
  }

  // 2. Needs-action: planning completed but no execution yet
  // Pessimistic when label unknown (undefined → true), accurate when set
  if (
    fields.hasCompletedPlanning &&
    !fields.hasCompletedExecution &&
    !fields.hasImplementationTaskId &&
    (fields.hasImplementationReadyLabel ?? true)
  ) {
    return 'needs-action';
  }

  // 3. Needs-action: PR exists with positive review and ready-to-merge label
  // Covers both execution-based and review-only workflows
  // Conservative when label unknown (undefined → false)
  if (
    fields.hasPrUrl &&
    fields.latestReviewNeedsRemediation === false &&
    (fields.hasMergeReadyLabel ?? false)
  ) {
    return 'needs-action';
  }

  // 4. Failed: latest non-archived task is failed or interrupted
  if (fields.latestTaskStatus === 'failed' || fields.latestTaskStatus === 'interrupted') {
    return 'failed';
  }

  // 5. Done: everything else
  return 'done';
}
