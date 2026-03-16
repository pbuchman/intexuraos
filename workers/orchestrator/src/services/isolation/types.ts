/**
 * IsolationProvider Interface
 *
 * Defines the contract for isolated worker execution environments.
 * Implementations may use Docker containers, VMs, or other isolation mechanisms.
 */

import type { CodeTaskWorkerType } from '@intexuraos/common-core';

export interface AnthropicOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

export type OAuthState =
  | { status: 'active'; expiresAt: string; expiresInMinutes: number; subscriptionType: string }
  | { status: 'expired'; message: string }
  | { status: 'not_configured'; message: string };

export type WorkerType = CodeTaskWorkerType;

export interface WorkerTypeConfig {
  apiBaseUrl: string;
  apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'MINIMAX_API_KEY' | 'DASHSCOPE_API_KEY';
  model?: string;
}

export const WORKER_TYPES: Record<WorkerType, WorkerTypeConfig> = {
  auto: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  opus: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'opus',
  },
  sonnet: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'sonnet',
  },
  minimax: {
    apiBaseUrl: 'https://api.minimax.io/anthropic',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    model: 'MiniMax-M2.5',
  },
  glm: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'glm-5',
  },
  qwen: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'qwen3.5-plus',
  },
  kimi: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'kimi-k2.5',
  },
};

export interface WorkerSecrets {
  ANTHROPIC_API_KEY: string;
  LINEAR_API_KEY: string;
  SENTRY_AUTH_TOKEN: string;
  MINIMAX_API_KEY: string;
  DASHSCOPE_API_KEY: string;
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
  continueSession?: boolean;
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

export interface DiscoveredContainer {
  containerId: string;
  taskId: string;
  state: string;
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

  /**
   * Cleanup persistent per-task session artifacts.
   */
  cleanupTaskSession?(taskId: string): Promise<void>;

  preserveWorker?(taskId: string): Promise<void>;

  listPreservedWorkers?(): Promise<{ containerId: string; taskId: string; preservedAt: string }[]>;

  listWorkerContainers?(): Promise<DiscoveredContainer[]>;

  startPeriodicCleanup?(): void;

  stopPeriodicCleanup?(): void;

  getImageInfo?(): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  };

  isHealthy?(): boolean;

  getHealthDetails?(): { docker: boolean; disk: boolean };

  startHealthMonitor?(): void;

  stopHealthMonitor?(): void;
}
