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
  confidence: number;
  reasons: string[];
  missingCriteria: string[];
  resumeInstruction: string;
  usedLlm: boolean;
  createdAt: string;
}

export interface Task {
  taskId: string;
  workerType: 'opus' | 'auto' | 'glm';
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
}

export interface TaskResult {
  prUrl?: string;
  branch: string;
  commits: number;
  summary?: string;
  ciFailed?: boolean;
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
