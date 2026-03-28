import type { OrchestratorStatus } from './state.js';
import type { ExecutionMemoryPromptContext } from './execution-memory.js';
import type { WorkerType } from '../services/isolation/types.js';
import type { WorkerAuthProvider, WorkerAuthState } from '../services/worker-auth/index.js';

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
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation';
  /** Prompt-ready execution memory context prepared by code-agent retrieval. */
  executionMemoryContext?: ExecutionMemoryPromptContext;
  /** Existing PR tracking comment to reuse instead of creating a new one. */
  trackingCommentId?: string;
  /** PR number this task is operating on. Used to enforce one-per-PR container preservation. */
  prNumber?: number;
  /** Existing PR number to continue instead of creating a fresh PR. */
  continuationPrNumber?: number;
  /** Existing PR branch to continue instead of creating a fresh PR. */
  continuationPrBranch?: string;
  /** Branch name of planning PR to merge into execution worktree. */
  planningPrBranch?: string;
  /** PR URL to close after successful execution. */
  planningPrUrl?: string;
  /** Review types requested for review agent tasks. */
  reviewTypes?: string[];
}

// GET /health response
export interface HealthResponse {
  status: OrchestratorStatus;
  capacity: number;
  running: number;
  available: number;
  githubTokenExpiresAt: string | null;
  dockerHealthy: boolean;
  diskHealthy: boolean;
  workerAuths: Record<WorkerAuthProvider, WorkerAuthState>;
}
