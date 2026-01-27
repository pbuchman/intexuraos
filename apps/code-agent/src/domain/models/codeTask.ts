import { Timestamp } from '@google-cloud/firestore';

/**
 * Worker type determines which model Claude uses.
 * Design reference: Lines 1207-1212
 * - opus: Force Opus model
 * - auto: Automatic model selection (default)
 * - glm: Use Z.ai GLM model
 */
export type WorkerType = 'opus' | 'auto' | 'glm';

/**
 * Worker location for routing.
 * Design reference: Lines 1214-1219
 * - mac: Primary MacBook worker (preferred)
 * - vm: GCP VM fallback (auto-started if Mac unavailable)
 */
export type WorkerLocation = 'mac' | 'vm';

/**
 * Task status lifecycle.
 * Design reference: Lines 316, 1422
 *
 * Flow: dispatched → running → completed|failed|cancelled
 *       dispatched → interrupted (if worker dies)
 */
export type TaskStatus =
  | 'dispatched'   // Sent to worker, awaiting start
  | 'running'      // Worker actively processing
  | 'completed'    // Successfully finished with PR
  | 'failed'       // Error occurred
  | 'interrupted'  // Worker died unexpectedly
  | 'cancelled';   // User cancelled

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
  branch: string;           // Git branch name
  commits: number;          // Number of commits made
  summary: string;          // AI-generated summary of changes
  ciFailed?: boolean;       // True if CI checks failed
  partialWork?: boolean;    // True if task timed out with partial progress
  rebaseResult?: 'success' | 'conflict' | 'skipped';  // For long tasks (design lines 1356-1364)
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
  linearIssueTitle?: string;
  linearFallback?: boolean;     // True if Linear was unavailable (design lines 290-296)

  // Results
  result?: TaskResult;
  error?: TaskError;

  // Timestamps
  createdAt: Timestamp;
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

  // Deduplication key
  dedupKey: string;             // sha256(userId + prompt)[0:16] (design line 1547)

  // WhatsApp cancel nonce (INT-379)
  cancelNonce?: string;           // 4-char hex nonce for WhatsApp cancel button
  cancelNonceExpiresAt?: string;  // ISO timestamp (15 min TTL)
}
