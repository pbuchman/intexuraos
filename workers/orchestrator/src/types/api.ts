import type { OrchestratorStatus } from './state.js';

// POST /tasks request
export interface CreateTaskRequest {
  taskId: string;
  workerType: 'opus' | 'auto' | 'glm';
  prompt: string;
  repository?: string;
  baseBranch?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearIssueLabels: string[];
  hasChildren: boolean;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
  /**
   * For retried tasks: points to the original task ID that this task is retrying.
   * Used for tracking retry chains and debugging.
   */
  retriedFrom?: string;
}

// GET /health response
export interface HealthResponse {
  status: OrchestratorStatus;
  capacity: number;
  running: number;
  available: number;
  githubTokenExpiresAt: string | null;
}
