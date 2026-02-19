/**
 * Port for Linear OAuth credential storage.
 * Stores workspace-level OAuth credentials for the Linear Agents integration.
 */

import type { Result } from '@intexuraos/common-core';

export interface LinearOAuthCredentials {
  accessToken: string;
  appUserId: string;
  workspaceId: string;
  installedAt: string;
  installedBy: string;
}

export interface LinearOAuthError {
  code: 'internal_error';
  message: string;
}

export interface LinearOAuthRepository {
  /**
   * Store OAuth credentials for a workspace.
   * Uses workspaceId as the document ID.
   */
  save(credentials: LinearOAuthCredentials): Promise<Result<void, LinearOAuthError>>;

  /**
   * Retrieve OAuth credentials for a workspace.
   * Returns null if no credentials found.
   */
  get(workspaceId: string): Promise<Result<LinearOAuthCredentials | null, LinearOAuthError>>;

  /**
   * Find credentials by appUserId (the agent's user ID in the workspace).
   * Useful for webhook handling where we get appUserId from the event.
   */
  findByAppUserId(appUserId: string): Promise<Result<LinearOAuthCredentials | null, LinearOAuthError>>;
}
