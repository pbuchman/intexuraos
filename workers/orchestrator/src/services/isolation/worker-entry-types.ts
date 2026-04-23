import type { WorkerRuntime } from '../runtime/types.js';
import type { WorkerHandle } from './types.js';
import type { DockerProviderConfig } from './docker-provider-config.js';

export interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  runtime: WorkerRuntime;
  taskSecretsPath: string;
  taskRuntimeHomePath: string;
  attemptRunning: boolean;
  attemptLogBuffer: string;
  taskForensicsPath?: string;
  logStream?: NodeJS.ReadableStream;
}

export interface PreservedWorkerEntry {
  containerId: string;
  taskId: string;
  preservedAt: string;
}

/**
 * Subset of DockerProviderConfig needed by lifecycle/env/create helpers.
 * Declared as a structural Pick<> so a full DockerProviderConfig is assignable
 * without casts (see DockerProvider.getLifecycleConfig).
 */
export type LifecycleProviderConfig = Pick<
  DockerProviderConfig,
  | 'imageName'
  | 'managedAttemptsMode'
  | 'workerReadyTimeoutMs'
  | 'maxConcurrent'
  | 'sharedCredsPath'
  | 'sharedCodexAuthPath'
  | 'gitUserName'
  | 'gitUserEmail'
  | 'forensicsMode'
>;
