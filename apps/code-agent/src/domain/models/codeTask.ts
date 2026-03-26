import type { CodeTaskWorkerType } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';

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

export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation';

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
  rebaseResult?: 'success' | 'conflict' | 'skipped';  // For long tasks (design lines 1356-1364)
  comment_replied?: boolean; // True if PR comment reply was sent (for pull_request agent)
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_subtask_urls?: string;
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented' | 'already_completed';
  execution_superpowers_executing_plans_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_linear_issue_url?: string;
  review_comments_posted?: string;
  review_types?: string;
  requirements_tracker_updated?: string;
  needs_remediation?: string;
}

/**
 * Task error on failure.
 * Design reference: Lines 1762-1848 (error taxonomy)
 */
export interface TaskError {
  code: string;             // Error code (see design lines 1774-1812)
  message: string;          // Human-readable message
  remediation?: {           // Design reference: Lines 1818-1848
    retryAfter?: number;    // Seconds to wait before retry
    manualSteps?: string;   // Instructions for user
    supportLink?: string;   // Link to docs/support
  };
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
  actionId?: string;            // Link to parent action (for dedup, design line 1539)
  approvalEventId?: string;     // Unique per approval (design lines 1532-1536)
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

  // Resume/Follow-up tracking (for PR comment auto-response - INT-465)
  parentTaskId?: string;       // If this task is a follow-up to another
  followUpReason?: 'pr_comment' | 'user_feedback' | 'retry' | 'execution_implement' | 'ci_failure';
  agentType?: AgentType;
  implementationTaskId?: string;

  // Results
  result?: TaskResult;
  error?: TaskError;

  // Timestamps
  createdAt: Timestamp;
  queuedAt?: Timestamp;           // When task entered queue (INT-619)
  dispatchedAt?: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;         // For zombie detection queries

  // Webhook state
  callbackReceived: boolean;
  webhookSecret?: string;     // Per-task secret for HMAC signature validation (design lines 1634-1636)

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

  // Remediation task metadata
  requiresReReview?: boolean;    // Set by remediation tasks before pushing code
}
