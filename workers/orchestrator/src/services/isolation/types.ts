/**
 * IsolationProvider Interface
 *
 * Defines the contract for isolated worker execution environments.
 * Implementations may use Docker containers, VMs, or other isolation mechanisms.
 */

export type WorkerType = 'opus' | 'auto' | 'glm';

export interface WorkerTypeConfig {
  apiBaseUrl: string;
  apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'ZAI_API_KEY';
  model?: string;
}

export const WORKER_TYPES: Record<WorkerType, WorkerTypeConfig> = {
  opus: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'claude-opus-4-5-20251101',
  },
  auto: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  glm: {
    apiBaseUrl: 'https://api.z.ai/api/anthropic',
    apiKeyEnvVar: 'ZAI_API_KEY',
  },
};

export interface WorkerSecrets {
  ANTHROPIC_API_KEY: string;
  LINEAR_API_KEY: string;
  SENTRY_AUTH_TOKEN: string;
  ZAI_API_KEY: string;
}

export interface WorkerConfig {
  taskId: string;
  worktreePath: string;
  prompt: string;
  systemPrompt: string;
  workerType: WorkerType;
  secrets: WorkerSecrets;
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
  jsonSchema?: string;
  onLog?: (chunk: string) => void;
  onComplete?: (exitCode: number) => void;
}

export type WorkerStatus = 'starting' | 'running' | 'completed' | 'failed' | 'timeout';

export interface WorkerHandle {
  taskId: string;
  containerId: string;
  status: WorkerStatus;
  startedAt: Date;
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryLimitMB: number;
}

export interface IsolationProvider {
  /**
   * Create and start an isolated worker container.
   * - Creates container with security controls
   * - Mounts worktree at /repo
   * - Mounts secrets at /secrets (including prompt files)
   * - Starts Claude in --print mode (non-interactive)
   */
  createWorker(config: WorkerConfig): Promise<WorkerHandle>;

  /**
   * Forcefully terminate a worker.
   * - Sends SIGTERM, waits 10s
   * - If still running, SIGKILL
   * - Removes container
   */
  destroyWorker(taskId: string): Promise<void>;

  /**
   * Check if worker container is still running.
   */
  isWorkerRunning(taskId: string): Promise<boolean>;

  /**
   * Get all logs from worker container.
   */
  getWorkerLogs(taskId: string): Promise<string>;

  /**
   * Stream logs from worker in real-time.
   */
  streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void>;

  /**
   * Wait for worker to complete or timeout.
   * @returns Exit code (0 = success, -1 = timeout, other = failure)
   */
  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;

  /**
   * Get current resource usage of worker container.
   */
  getResourceUsage(taskId: string): Promise<ResourceUsage>;

  /**
   * List all running worker containers.
   */
  listWorkers(): Promise<WorkerHandle[]>;
}
