/**
 * Isolation Provider Factory and Exports
 *
 * Provides factory function for creating Docker-based isolation providers
 * and re-exports all isolation-related types and implementations.
 */

import type { Logger } from '@intexuraos/common-core';
import { DockerProvider, type DockerProviderConfig } from './docker-provider.js';
import type { IsolationProvider } from './types.js';

/**
 * Create a Docker isolation provider.
 *
 * @param config - Configuration options for the Docker provider
 * @param logger - Logger instance
 * @returns An IsolationProvider instance
 */
export async function createIsolationProvider(
  config: Partial<DockerProviderConfig>,
  logger: Logger
): Promise<IsolationProvider> {
  const provider = new DockerProvider(config, logger);
  await provider.cleanupOrphanedContainers();
  return provider;
}

// Re-export types
export type {
  IsolationProvider,
  WorkerConfig,
  WorkerHandle,
  WorkerStatus,
  WorkerSecrets,
  WorkerType,
  WorkerTypeConfig,
  ResourceUsage,
  TTYStreams,
} from './types.js';

export { WORKER_TYPES } from './types.js';

// Re-export implementations
export { DockerProvider, type DockerProviderConfig } from './docker-provider.js';
export { TokenRefresher, type TokenRefresherConfig } from './token-refresher.js';
