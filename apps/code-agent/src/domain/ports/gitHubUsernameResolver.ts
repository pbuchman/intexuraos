/**
 * Port for resolving GitHub usernames to IntexuraOS user IDs.
 *
 * This will be backed by UserServiceClient.resolveGitHubUsername()
 * once Stream B (user-service OAuth) is merged.
 */

import type { Result } from '@intexuraos/common-core';

export interface GitHubUsernameResolverError {
  code: 'NOT_FOUND' | 'INTERNAL_ERROR';
  message: string;
}

export interface GitHubUsernameResolver {
  /**
   * Resolve a GitHub username to an IntexuraOS user ID.
   */
  resolve(githubUsername: string): Promise<Result<string, GitHubUsernameResolverError>>;
}
