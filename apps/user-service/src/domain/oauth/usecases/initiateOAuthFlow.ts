/**
 * Initiate OAuth Flow Use-Case
 *
 * Generates authorization URL for Google OAuth.
 * Creates state token for CSRF protection.
 */

import type { Logger } from '@intexuraos/common-core';
import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProvider } from '../models/OAuthConnection.js';
import type { GoogleOAuthClient } from '../ports/GoogleOAuthClient.js';

export interface InitiateOAuthFlowInput {
  userId: string;
  provider: OAuthProvider;
  redirectUri: string;
}

export interface InitiateOAuthFlowResult {
  authorizationUrl: string;
  state: string;
}

export interface InitiateOAuthFlowDeps {
  googleOAuthClient: GoogleOAuthClient;
  logger: Logger;
}

export function initiateOAuthFlow(
  input: InitiateOAuthFlowInput,
  deps: InitiateOAuthFlowDeps
): InitiateOAuthFlowResult {
  const { userId, provider, redirectUri } = input;
  const { googleOAuthClient, logger } = deps;

  logger.info({ userId, provider }, 'OAuth flow initiated');

  const statePayload = {
    userId,
    provider,
    redirectUri,
    createdAt: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };

  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
  const authorizationUrl = googleOAuthClient.generateAuthUrl(state, redirectUri);

  // 12 hex chars (48 bits) of SHA-256 — sufficient for log correlation
  // without exposing enough of the digest to enable preimage attacks.
  const stateHash = createHash('sha256').update(state).digest('hex').slice(0, 12);
  logger.info({ userId, provider, stateHash }, 'OAuth state generated for CSRF protection');

  return {
    authorizationUrl,
    state,
  };
}

/**
 * Factory to create a bound initiateOAuthFlow use case.
 */
export function createInitiateOAuthFlowUseCase(
  googleOAuthClient: GoogleOAuthClient,
  logger: Logger
): (input: InitiateOAuthFlowInput) => InitiateOAuthFlowResult {
  return (input) => initiateOAuthFlow(input, { googleOAuthClient, logger });
}
