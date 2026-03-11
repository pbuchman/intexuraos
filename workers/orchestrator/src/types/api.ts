import type { OrchestratorStatus } from './state.js';
import type { OAuthState, WorkerType } from '../services/isolation/types.js';

// POST /tasks request
export interface CreateTaskRequest {
  taskId: string;
  workerType: WorkerType;
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
  /** Agent type determined by code-agent routing analysis. */
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
  /** Existing PR tracking comment to reuse instead of creating a new one. */
  trackingCommentId?: string;
  /** Branch name of planning PR to merge into execution worktree. */
  planningPrBranch?: string;
  /** PR URL to close after successful execution. */
  planningPrUrl?: string;
}

// GET /health response
export interface HealthResponse {
  status: OrchestratorStatus;
  capacity: number;
  running: number;
  available: number;
  githubTokenExpiresAt: string | null;
  anthropicOAuth: OAuthState;
}
