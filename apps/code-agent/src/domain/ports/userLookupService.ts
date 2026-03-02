/**
 * Port for resolving GitHub usernames to IntexuraOS user + worker config.
 *
 * Used by the GitHub webhook flow to determine which user owns a PR
 * and which worker to dispatch to.
 */

import type { Result } from '@intexuraos/common-core';
import type { WorkerConfig } from '../models/workerSettings.js';

/**
 * Result of resolving a GitHub username.
 */
export interface UserLookupResult {
  userId: string;
  worker: WorkerConfig;
}

export interface UserLookupError {
  code: 'USER_NOT_FOUND' | 'NO_ENABLED_WORKER' | 'INTERNAL_ERROR';
  message: string;
}

export interface UserLookupService {
  /**
   * Resolve a GitHub username to a userId and first enabled worker.
   *
   * Flow:
   * 1. Call user-service to resolve GitHub username -> userId
   * 2. Fetch worker settings for that userId
   * 3. Return first enabled worker
   */
  resolveByGitHubUsername(
    githubUsername: string
  ): Promise<Result<UserLookupResult, UserLookupError>>;
}
