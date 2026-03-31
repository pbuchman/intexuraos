import type { GroupStatus } from './types.js';

export interface GroupSummaryFields {
  activeTaskCount: number;
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  latestTaskStatus: string;
  latestReviewNeedsRemediation: boolean | null;
}

export function deriveAggregateStatusFromSummary(fields: GroupSummaryFields): GroupStatus {
  // 1. Active: any task is running/dispatched/queued
  if (fields.activeTaskCount > 0) {
    return 'active';
  }

  // 2. Needs-action: planning completed but no execution yet (pessimistic — assumes label present)
  if (fields.hasCompletedPlanning && !fields.hasCompletedExecution && !fields.hasImplementationTaskId) {
    return 'needs-action';
  }

  // 3. Needs-action: execution completed with PR and review says no remediation needed
  if (fields.hasCompletedExecution && fields.hasPrUrl && fields.latestReviewNeedsRemediation === false) {
    return 'needs-action';
  }

  // 4. Failed: latest non-archived task is failed or interrupted
  if (fields.latestTaskStatus === 'failed' || fields.latestTaskStatus === 'interrupted') {
    return 'failed';
  }

  // 5. Done: everything else
  return 'done';
}
