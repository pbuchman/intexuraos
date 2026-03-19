/**
 * Initiate GitHub OAuth Flow Use-Case
 *
 * Generates authorization URL for GitHub OAuth.
 * Creates state token for CSRF protection.
 */

import type { Logger } from '@intexuraos/common-core';
import { randomBytes } from 'node:crypto';
import type { OAuthProvider } from '../models/OAuthConnection.js';
import type { GitHubOAuthClient } from '../ports/GitHubOAuthClient.js';

export interface InitiateGitHubOAuthFlowInput {
  userId: string;
  provider: OAuthProvider;
  redirectUri: string;
}

export interface InitiateGitHubOAuthFlowResult {
  authorizationUrl: string;
  state: string;
}

export interface InitiateGitHubOAuthFlowDeps {
  gitHubOAuthClient: GitHubOAuthClient;
  logger: Logger;
}

export function initiateGitHubOAuthFlow(
  input: InitiateGitHubOAuthFlowInput,
  deps: InitiateGitHubOAuthFlowDeps
): InitiateGitHubOAuthFlowResult {
  const { userId, provider, redirectUri } = input;
  const { gitHubOAuthClient, logger } = deps;

  logger.info({ userId, provider }, 'GitHub OAuth flow initiated');

  const statePayload = {
    userId,
    provider,
    redirectUri,
    createdAt: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };

  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
  const authorizationUrl = gitHubOAuthClient.generateAuthUrl(state, redirectUri);

  logger.info({ userId, provider, state }, 'GitHub OAuth state generated for CSRF protection');

  return {
    authorizationUrl,
    state,
  };
}
