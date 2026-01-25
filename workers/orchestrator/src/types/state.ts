import type { Task } from './task.js';

export type OrchestratorStatus =
  | 'initializing'
  | 'recovering'
  | 'ready'
  | 'degraded'
  | 'auth_degraded'
  | 'shutting_down';

export interface OrchestratorState {
  tasks: Record<string, Task>;
  githubToken: {
    token: string;
    expiresAt: string;
  } | null;
  pendingWebhooks: PendingWebhook[];
}

export interface PendingWebhook {
  taskId: string;
  url: string;
  payload: unknown;
  attempts: number;
  lastAttempt: string;
}
