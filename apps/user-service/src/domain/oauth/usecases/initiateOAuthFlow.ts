/**
 * Initiate OAuth Flow Use-Case
 *
 * Generates authorization URL for Google OAuth.
 * Creates state token for CSRF protection.
 */

import { ok, type Result } from '@intexuraos/common-core';
import { randomBytes } from 'node:crypto';
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
}

export function initiateOAuthFlow(
  input: InitiateOAuthFlowInput,
  deps: InitiateOAuthFlowDeps
): Result<InitiateOAuthFlowResult, never> {
  const { userId, provider, redirectUri } = input;
  const { googleOAuthClient } = deps;

  const statePayload = {
    userId,
    provider,
    redirectUri,
    createdAt: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };

  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
  const authorizationUrl = googleOAuthClient.generateAuthUrl(state, redirectUri);

  return ok({
    authorizationUrl,
    state,
  });
}
