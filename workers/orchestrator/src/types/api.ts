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
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
}

// GET /health response
export interface HealthResponse {
  status: OrchestratorStatus;
  capacity: number;
  running: number;
  available: number;
  githubTokenExpiresAt: string | null;
}
