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

  // Timeout wrapper for Docker cleanup
  const DOCKER_CLEANUP_TIMEOUT_MS = 30 * 1000; // 30 seconds
  const cleanupPromise = provider.cleanupOrphanedContainers();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Docker cleanup timeout'));
    }, DOCKER_CLEANUP_TIMEOUT_MS);
  });

  try {
    await Promise.race([cleanupPromise, timeoutPromise]);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (
      errMsg.includes('timeout') ||
      errMsg.includes('ECONNREFUSED') ||
      errMsg.includes('ENOENT')
    ) {
      process.stderr.write(`\n❌ PRECONDITION FAILED: Cannot connect to Docker\n`);
      process.stderr.write(
        `   Docker cleanup failed after ${String(DOCKER_CLEANUP_TIMEOUT_MS / 1000)} seconds\n`
      );
      process.stderr.write(`   Ensure:\n`);
      process.stderr.write(`     1. Docker Desktop is running\n`);
      process.stderr.write(`     2. Docker daemon is responding\n`);
      process.stderr.write(`   Test with: docker ps\n\n`);
      process.exit(1);
    }
    throw error;
  }

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
  AnthropicOAuthCredentials,
  OAuthState,
} from './types.js';

export { WORKER_TYPES } from './types.js';

// Re-export implementations
export { DockerProvider, type DockerProviderConfig } from './docker-provider.js';
export { TokenRefresher, type TokenRefresherConfig } from './token-refresher.js';
export { AnthropicOAuthManager, type AnthropicOAuthManagerConfig } from './anthropic-oauth.js';
