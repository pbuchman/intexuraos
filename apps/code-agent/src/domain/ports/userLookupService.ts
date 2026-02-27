/**
 * Port for GitHub username to user resolution.
 *
 * Resolves GitHub usernames from PR comments to userId and worker credentials
 * for dispatching tasks.
 */

import type { Result } from '@intexuraos/common-core';
import type { WorkerConfig } from '../models/workerSettings.js';

export interface UserLookupError {
  code: 'not_found' | 'internal_error';
  message: string;
}

export interface ResolvedUser {
  userId: string;
  worker: WorkerConfig;
}

export interface UserLookupService {
  /**
   * Resolve a GitHub username to userId and worker config for dispatch.
   * Returns null if no user is found with that GitHub username or no enabled workers.
   */
  resolveUserFromGitHubUsername(
    githubUsername: string
  ): Promise<Result<ResolvedUser | null, UserLookupError>>;
}
