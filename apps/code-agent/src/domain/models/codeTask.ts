import type { CodeTaskRebaseResult, CodeTaskWorkerType } from '@intexuraos/code-task-domain';
import { Timestamp } from '@google-cloud/firestore';
import type { ExecutionMemoryType } from './executionMemory.js';
import type { ExecutionMemoryApplicationCandidate } from './executionMemoryApplication.js';
import type { SentryIssueTaskContext } from './sentryIssueEvent.js';

/**
 * Worker type determines which model Claude uses.
 * Uses shared worker types from common-core.
 */
export type WorkerType = CodeTaskWorkerType;

/**
 * Worker location for routing.
 * Dynamic user-defined worker names (e.g., "home-mac", "office-pc", "worker1").
 * Configured per-user via Worker Settings UI.
 */
export type WorkerLocation = string;

export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent' | 'sentry';

/** System prompt hash for auto-triggered merge-conflict resolution tasks. */
export const MERGE_CONFLICT_SYSTEM_PROMPT_HASH = 'pr-merge-conflict-auto';

/**
 * Task status lifecycle.
 * Design reference: Lines 316, 1422
 *
 * Flow: queued → dispatched → running → planned|implemented|reviewed|failed|cancelled
 *       dispatched → interrupted (if worker dies)
 *       queued → failed (if TTL expires or queue full)
 *       failed|cancelled|interrupted → archived (when task is retried, INT-711)
 *
 * 'planned'      = Planning Agent task completed successfully
 * 'implemented'  = Execution Agent task completed successfully
 */
export type TaskStatus =
  | 'dispatched'   // Sent to worker, awaiting start
  | 'running'      // Worker actively processing
  | 'queued'       // Waiting for worker capacity (INT-619)
  | 'planned'      // Planning Agent task finished
  | 'implemented'  // Execution Agent task finished
  | 'reviewed'     // Review Agent task finished
  | 'failed'       // Error occurred
  | 'interrupted'  // Worker died unexpectedly
  | 'cancelled'    // User cancelled
  | 'archived';    // Task archived after retry (INT-711)

/**
 * Status summary phases for UI display when logs unavailable.
 * Design reference: Lines 1019-1041
 */
export type TaskPhase =
  | 'starting'
  | 'analyzing'
  | 'implementing'
  | 'testing'
  | 'creating_pr'
  | 'completed';

/**
 * Task result on successful completion.
 * Design reference: Lines 1356-1364, 1425
 */
export interface TaskResult {
  prUrl?: string;           // GitHub PR URL (may be absent if PR creation failed)
  branch?: string;          // Git branch name (absent for planning-agent tasks)
  commits?: number;         // Number of commits made (absent for planning-agent tasks)
  summary?: string;         // AI-generated summary of changes
  ciFailed?: boolean;       // True if CI checks failed
  partialWork?: boolean;    // True if task timed out with partial progress
  rebaseResult?: CodeTaskRebaseResult;  // For long tasks (design lines 1356-1364)
  comment_replied?: boolean; // True if PR comment reply was sent (for pull_request agent)
  pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
  merge_ready?: '1';
  merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_subtask_urls?: string;
  planning_has_plan_doc?: '0' | '1';
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented' | 'already_completed';
  execution_superpowers_subagent_driven_dev_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_memory_ids_used?: string;
  execution_memory_ids_rejected?: string;
  execution_memory_usage_summary?: string;
  execution_linear_issue_url?: string;
  review_id?: string;
  review_comments_posted?: string;
  review_types?: string;
  review_body?: string;
  review_inline_comments?: string;
  requirements_tracker_updated?: string;
  gh_actions_status?: string;
  needs_remediation?: string;
  requires_re_review?: string;
  sentry_issue_url?: string;
  sentry_linear_issue?: string;
  sentry_outcome?: 'fixed' | 'suppressed';
  sentry_verification?: string;
}

export interface ExecutionMemoryContextMemory {
  memoryId: string;
  title: string;
  memoryType: ExecutionMemoryType;
  score: number;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
}

export interface ExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: Timestamp;
  matchedMemories?: ExecutionMemoryContextMemory[];
  topCandidates?: ExecutionMemoryApplicationCandidate[];
  totalSearchResults?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ExecutionMemoryPostRun {
  status: 'pending' | 'processing' | 'completed' | 'skipped' | 'error';
  attempts: number;
  lastAttemptAt?: Timestamp;
  generatedMemoryIds: string[];
  evaluationSummary?: string;
  skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson' | 'planning_unclear';
  errorMessage?: string;
  completedAt?: Timestamp;
}

/**
 * Scheduling metadata for deferred dispatch (INT-1468).
 *
 * Carries the earliest time a queued task may be dispatched plus provenance for
 * how that time was derived (user-provided vs. LLM-parsed vs. fallback). The
 * queue drainer consults `notBeforeAt` to skip tasks still in their wait window.
 */
export interface DispatchSchedule {
  /** Earliest permissible dispatch time. */
  notBeforeAt: Timestamp;
  /** Origin of the schedule — user-entered or automatic retry cooloff. */
  source: 'user_scheduled' | 'retry_cooloff';
  /** IANA timezone (e.g. 'UTC', 'Europe/Warsaw') used to compute notBeforeAt. */
  timezone?: string;
  /** Local-clock representation of notBeforeAt (e.g. '2026-04-24T22:00'). */
  localDateTime?: string;
  /** Raw text we parsed the schedule from (e.g. Claude usage-limit message). */
  sourceText?: string;
  /** How notBeforeAt was derived. */
  derivedBy: 'user_input' | 'parser' | 'llm' | 'fallback';
  /** Task that produced this schedule (set for retry_cooloff chains). */
  derivedFromTaskId?: string;
}

/**
 * Task error on failure.
 * Design reference: Lines 1762-1848 (error taxonomy)
 */
export interface TaskError {
  code: string;             // Error code (see design lines 1774-1812)
  message: string;          // Human-readable message
  remediation?: {           // Design reference: Lines 1818-1848
    action?: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';  // Orchestrator hint; honored by classifyFailure as fallback
    retryAfter?: number;    // Seconds to wait before retry
    manualSteps?: string;   // Instructions for user
    supportLink?: string;   // Link to docs/support
  };
}

export type CodeTaskDispatchStatusReason =
  | 'no_enabled_workers'
  | 'workers_unreachable'
  | 'worker_health_contract_mismatch'
  | 'workers_at_capacity'
  | 'codex_auth_unavailable'
  | 'claude_auth_unavailable'
  | 'provider_auth_unavailable'
  | 'docker_unavailable'
  | 'disk_unavailable'
  | 'unknown_worker_type'
  | 'worker_unavailable'
  | 'worker_busy'
  | 'at_capacity'
  | 'network_error'
  | 'dispatch_failed'
  | 'invalid_response'
  | 'queue_full'
  | 'queue_timeout'
  | 'retry_expired'
  | 'retry_exhausted'
  | 'missing_pr_branch'
  | 'scheduled_wait'
  | 'active_task_blocked';

export interface CodeTaskDispatchStatus {
  state: 'waiting' | 'blocked' | 'terminal';
  reason: CodeTaskDispatchStatusReason;
  terminal: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  remediation: string;
  workerNames: string[];
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  nextAction: 'will_retry_automatically' | 'retry_after_fix' | 'wait_until_scheduled' | 'wait_for_active_task';
  lastAttemptAt?: Timestamp;
  attemptCount?: number;
  expiresAt?: Timestamp;
  terminalCause?: {
    reason: CodeTaskDispatchStatusReason;
    message: string;
    remediation: string;
    workerNames: string[];
    lastSeenAt: Timestamp;
  };
  workerHealthDetails?: {
    workerName: string;
    tag: string;
    healthy: boolean;
    reason?: string;
    error?: string;
    code?: string;
    missingFields?: string[];
    contractMismatch?: boolean;
  }[];
  notifiedReasons?: Partial<Record<CodeTaskDispatchStatusReason, Timestamp>>;
}

/**
 * Status summary for UI when logs unavailable.
 * Design reference: Lines 1017-1041
 */
export interface StatusSummary {
  phase: TaskPhase;
  message: string;          // e.g., "Running tests: 45/100 passed"
  progress?: number;        // 0-100 percentage
  updatedAt: Timestamp;
}

export type CodeTaskCallbackOwner = 'dev' | 'prod' | 'custom';

export type CodeTaskCallbackEndpoint =
  | 'logs'
  | 'task_event'
  | 'task_complete'
  | 'status'
  | 'turn_metrics';

export interface CodeTaskCallbackFailure {
  endpoint: CodeTaskCallbackEndpoint;
  status?: number;
  message: string;
  occurredAt: Timestamp;
}

export interface CodeTaskCallbackState {
  webhookUrl: string;
  callbackBaseUrl: string;
  owner: CodeTaskCallbackOwner;
  configuredAt: Timestamp;
  lastSuccessAt?: Timestamp;
  lastSuccessEndpoint?: CodeTaskCallbackEndpoint;
  lastFailure?: CodeTaskCallbackFailure;
}

/**
 * Main CodeTask document structure.
 * Design reference: Lines 1996-2021
 *
 * Collection: code_tasks
 * Document ID: Auto-generated UUID
 */
export interface CodeTask {
  id: string;

  // Correlation and idempotency
  traceId: string;              // End-to-end correlation ID (design line 1998)
  retriedFrom?: string;         // Original taskId if retry

  // User and worker info
  userId: string;
  workerType: WorkerType;
  workerLocation: WorkerLocation;

  // Task state
  status: TaskStatus;

  // Prompt data
  prompt: string;               // Original user request
  sanitizedPrompt: string;      // After sanitization (design lines 1130-1165)
  systemPromptHash: string;     // SHA256 for audit (design line 1137)

  // Repository context
  repository: string;           // e.g., "pbuchman/intexuraos"
  baseBranch: string;           // e.g., "development"

  // Linear integration
  linearIssueId?: string;

  // PR Correlation (for linking tasks to PRs - INT-465)
  prNumber?: number;           // GitHub PR number (populated on completion)
  prBranch?: string;           // Branch name (queryable, redundant with result.branch)
  prMergedAt?: Timestamp;      // When the PR was merged (set by handlePrClose webhook, INT-1174)
  prClosedAt?: Timestamp;      // When PR was closed without merge (set by handlePrClose webhook, INT-1316)
  prUrlValidationFailed?: boolean;    // True if PR URL validation found issues (INT-1361)
  prUrlValidationErrors?: string[];   // Validation error details (INT-1361)

  // Resume/Follow-up tracking (for PR comment auto-response - INT-465)
  parentTaskId?: string;       // If this task is a follow-up to another
  followUpReason?: 'pr_comment' | 'user_feedback' | 'retry' | 'execution_implement' | 'ci_failure' | 'merge_conflict';
  agentType?: AgentType;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];

  // Results
  result?: TaskResult;
  error?: TaskError;
  dispatchStatus?: CodeTaskDispatchStatus;

  // Timestamps
  createdAt: Timestamp;
  queuedAt?: Timestamp;           // When task entered queue (INT-619)
  dispatchedAt?: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;         // For zombie detection queries

  // Webhook state
  callbackReceived: boolean;
  webhookSecret?: string;     // Per-task secret for HMAC signature validation (design lines 1634-1636)
  callbackState?: CodeTaskCallbackState;

  // Heartbeat for zombie detection
  lastHeartbeat?: Timestamp;   // Last heartbeat received from orchestrator (INT-372)

  // Log streaming health
  logChunksDropped?: number;    // Count of failed uploads (design line 1004)

  // Status summary (fallback when logs fail)
  statusSummary?: StatusSummary;

  // Queued user messages (accumulated while task is running)
  pendingUserMessages?: string[];

  // Deduplication key
  dedupKey: string;             // sha256(userId + prompt)[0:16] (design line 1547)

  // WhatsApp cancel nonce (INT-379)
  cancelNonce?: string;           // 4-char hex nonce for WhatsApp cancel button
  cancelNonceExpiresAt?: string;  // ISO timestamp (15 min TTL)

  // Dispatch metadata for queue reconstruction (INT-949)
  planningPrBranch?: string;     // Planning PR branch to merge into execution worktree
  planningPrUrl?: string;        // Planning PR URL to close after execution
  trackingCommentId?: string;    // PR tracking comment ID to reuse for pull_request tasks

  // Review task metadata
  reviewTypes?: string[];        // Review types requested (e.g., ['code_quality', 'security'])
  executionMemoryContext?: ExecutionMemoryContext;
  executionMemoryPostRun?: ExecutionMemoryPostRun;

  // Remediation task metadata
  requiresReReview?: boolean;    // Set by remediation tasks before pushing code

  // Sentry issue metadata
  sentryIssue?: SentryIssueTaskContext;

  // Auto-retry metadata (INT-1375)
  failedWorkerLocation?: string;   // Worker location that failed, to exclude on retry dispatch
  autoRetryAttempt?: number;       // 1-based auto-retry attempt number (max 3)

  // Deferred dispatch metadata (INT-1468)
  dispatchSchedule?: DispatchSchedule;

  /**
   * Optional per-task timeout override in hours (1–12).
   * When undefined, the orchestrator applies its default (5h).
   * Source of truth: user input on the New Code Task UI (INT-1585).
   */
  timeoutHours?: number;
}
