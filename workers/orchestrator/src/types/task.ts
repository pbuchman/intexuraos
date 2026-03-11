import type { WorkerType } from '../services/isolation/types.js';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';

export interface TaskVerificationRecord {
  attempt: number;
  passed: boolean;
  missingFields: string[];
  verifierFailure: boolean;
  createdAt: string;
}

export interface PendingResumeStart {
  prompt: string;
  acceptedAt: string;
}

export interface Task {
  taskId: string;
  workerType: WorkerType;
  prompt: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearIssueLabels: string[];
  hasChildren?: boolean;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
  status: TaskStatus;
  worktreePath: string;
  containerId: string;
  startedAt: string;
  completedAt?: string;
  /**
   * For retried tasks: points to the original task ID that this task is retrying.
   * Used for tracking retry chains and debugging.
   */
  retriedFrom?: string;
  /** Agent type from code-agent. When set, used instead of recalculating from labels. */
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
  /** Existing PR tracking comment to reuse instead of creating a new one. */
  trackingCommentId?: string;
  /** Branch name of planning PR to merge into execution worktree. */
  planningPrBranch?: string;
  /** PR URL to close after successful execution. */
  planningPrUrl?: string;
  /**
   * Current execution attempt (starts at 1).
   */
  attemptCount?: number;
  /**
   * Maximum attempts allowed before terminal failure.
   */
  maxAttempts?: number;
  /**
   * Exit code from the most recent worker attempt.
   */
  lastExitCode?: number;
  /**
   * Verification history for each completed attempt.
   */
  verificationHistory?: TaskVerificationRecord[];
  /**
   * Set when a completed task is resumed via sendMessage().
   * Gates loosened completion verification (exit code + Claude error only).
   * Cleared before persisting in finalizeTask().
   */
  resumedAfterSuccess?: boolean;
  /**
   * Result from the most recent successful completion.
   * Used as fallback when a resumed-after-success attempt completes
   * but checkForResult() returns undefined (e.g., planning tasks with no PR).
   * Updated on successful completion with a result; cleared on failure or
   * successful completion without a result.
   */
  lastSuccessResult?: TaskResult;
  /**
   * Set after a resume request is durably accepted but before the worker is ready.
   * Allows startup recovery to restart the accepted resume instead of interrupting it.
   */
  pendingResumeStart?: PendingResumeStart;
}

export interface TaskResult {
  prUrl?: string;
  branch?: string;
  commits?: number;
  summary?: string;
  ciFailed?: boolean;
  comment_replied?: boolean;
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_subtask_urls?: string;
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented';
  execution_superpowers_executing_plans_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_linear_issue_url?: string;
  review_comments_posted?: string;
  review_types?: string;
  rebaseResult?: {
    attempted: boolean;
    success: boolean;
    conflictFiles?: string[];
  };
}

export interface TaskError {
  code: string;
  message: string;
  remediation?: {
    action: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
    retryAfter?: string;
    manualSteps?: string[];
    worktreePath?: string;
  };
}
