/**
 * Initiate GitHub OAuth Flow Use-Case
 *
 * Generates authorization URL for GitHub OAuth.
 * Creates state token for CSRF protection.
 */

import type { Logger } from '@intexuraos/common-core';
import { createHash, randomBytes } from 'node:crypto';
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

  // 12 hex chars (48 bits) of SHA-256 — sufficient for log correlation
  // without exposing enough of the digest to enable preimage attacks.
  const stateHash = createHash('sha256').update(state).digest('hex').slice(0, 12);
  logger.info({ userId, provider, stateHash }, 'GitHub OAuth state generated for CSRF protection');

  return {
    authorizationUrl,
    state,
  };
}
