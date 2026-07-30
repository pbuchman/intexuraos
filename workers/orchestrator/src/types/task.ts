import type { WorkerRuntime } from '../services/runtime/types.js';
import type { WorkerType } from '../services/isolation/types.js';
import type { ExecutionMemoryPromptContext } from './execution-memory.js';
import type { CodeTaskRebaseResult } from '@intexuraos/code-task-domain';

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
  /** Memory-telemetry fields missing at this attempt. Separate from missingFields because they may be non-blocking for optional-tier workers. Absent in records written before the tiered-telemetry change. */
  telemetryMissingFields?: string[];
  /** True when this attempt was accepted despite missing telemetry (tier=optional). Absent or false otherwise. */
  telemetryAccepted?: boolean;
  verifierFailure: boolean;
  createdAt: string;
}

/**
 * Sub-reasons attached to a `WORKER_INFRA_FAILURE` TaskError (INT-1455).
 * Kept as a literal union so producers (the attempt classifier) and
 * consumers (orchestrator + downstream) can match exhaustively.
 */
export type InfraFailureSubReason =
  | 'container_exit_before_session_init'
  | 'entrypoint_failed'
  | 'git_worktree_lost'
  | 'image_pull_failed'
  | 'duration_below_threshold'
  | 'empty_transcript';

export interface TaskInfraFailureRecord {
  attempt: number;
  subReason: InfraFailureSubReason;
  createdAt: string;
}

export interface PendingResumeStart {
  prompt: string;
  acceptedAt: string;
}

export interface SentryIssueTaskContext {
  organizationSlug: string;
  projectSlug: string;
  projectId?: string | undefined;
  issueId: string;
  issueShortId?: string | undefined;
  issueUrl: string;
  title: string;
  action: string;
  eventId?: string | undefined;
  receivedAt: string;
}

export interface Task {
  taskId: string;
  workerType: WorkerType;
  runtime?: WorkerRuntime;
  runtimeSessionId?: string;
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
  agentType?:
    | 'planning'
    | 'execution'
    | 'pull_request'
    | 'review'
    | 'remediation'
    | 'ask_agent'
    | 'sentry';
  /** SentryBox issue context provided by code-agent for error-triggered code tasks. */
  sentryIssue?: SentryIssueTaskContext;
  /** Prompt-ready execution memory context prepared by code-agent retrieval. */
  executionMemoryContext?: ExecutionMemoryPromptContext;
  /** Existing PR tracking comment to reuse instead of creating a new one. */
  trackingCommentId?: string;
  /** PR number this task is operating on. Used to enforce one-per-PR container preservation. */
  prNumber?: number;
  /** Existing PR number inherited from retry/follow-up continuation flow. */
  continuationPrNumber?: number;
  /** Existing PR branch inherited from retry/follow-up continuation flow. */
  continuationPrBranch?: string;
  /** Review types requested for review agent tasks. */
  reviewTypes?: string[];
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
   * Records of attempts classified as WORKER_INFRA_FAILURE.
   * Used to abort retries when the same sub-reason repeats across attempts
   * (e.g. `git_worktree_lost` N vs N-1) — re-running Claude cannot fix infra.
   */
  taskInfraFailureHistory?: TaskInfraFailureRecord[];
  /**
   * Set when a completed task is resumed via sendMessage().
   * Gates loosened completion verification (exit code + runtime-reported hard error only).
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
  /**
   * Total number of inactivity restarts for this task (persisted to Firestore).
   * Tracks lifetime restarts for observability — never reset.
   */
  inactivityRestartCount?: number;
  /**
   * Resolved per-task timeout in milliseconds, derived from
   * `CreateTaskRequest.timeoutHours`. When undefined, the orchestrator
   * falls back to TASK_TIMEOUT_KILL_MS (5h). INT-1585.
   */
  timeoutMs?: number;
}

export interface TaskResult {
  prUrl?: string;
  branch?: string;
  commits?: number;
  commitDetails?: { sha: string; message: string }[];
  summary?: string;
  ciFailed?: boolean;
  comment_replied?: boolean;
  pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_has_plan_doc?: '0' | '1';
  planning_subtask_urls?: string;
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented' | 'already_completed' | 'failed';
  execution_superpowers_subagent_driven_dev_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_memory_ids_used?: string;
  execution_memory_ids_rejected?: string;
  execution_memory_usage_summary?: string;
  execution_linear_issue_url?: string;
  review_comments_posted?: string;
  review_id?: string;
  review_types?: string;
  requirements_tracker_updated?: string;
  gh_actions_status?: string;
  needs_remediation?: string; // '0' or '1'
  review_body?: string;
  review_inline_comments?: string;
  requires_re_review?: string; // '0' or '1'
  sentry_issue_url?: string;
  sentry_linear_issue?: string;
  sentry_outcome?: 'fixed' | 'suppressed';
  sentry_verification?: string;
  rebaseResult?: CodeTaskRebaseResult;
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
