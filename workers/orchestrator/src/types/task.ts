export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';

export interface Task {
  taskId: string;
  workerType: 'opus' | 'auto' | 'glm';
  prompt: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
  status: TaskStatus;
  tmuxSession: string;
  worktreePath: string;
  startedAt: string;
  completedAt?: string;
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
