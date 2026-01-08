/**
 * Exchange OAuth Code Use-Case
 *
 * Exchanges authorization code for tokens and stores connection.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { OAuthConnectionPublic, OAuthState, OAuthTokens } from '../models/OAuthConnection.js';
import type { OAuthError } from '../models/OAuthError.js';
import type { OAuthConnectionRepository } from '../ports/OAuthConnectionRepository.js';
import type { GoogleOAuthClient } from '../ports/GoogleOAuthClient.js';

export interface ExchangeOAuthCodeInput {
  code: string;
  state: string;
}

export interface ExchangeOAuthCodeDeps {
  oauthConnectionRepository: OAuthConnectionRepository;
  googleOAuthClient: GoogleOAuthClient;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function parseState(stateString: string): OAuthState | null {
  try {
    const decoded = Buffer.from(stateString, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'userId' in parsed &&
      'provider' in parsed &&
      'redirectUri' in parsed &&
      'createdAt' in parsed
    ) {
      return parsed as OAuthState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function exchangeOAuthCode(
  input: ExchangeOAuthCodeInput,
  deps: ExchangeOAuthCodeDeps
): Promise<Result<OAuthConnectionPublic, OAuthError>> {
  const { code, state: stateString } = input;
  const { oauthConnectionRepository, googleOAuthClient } = deps;

  const state = parseState(stateString);
  if (state === null) {
    return err({
      code: 'INVALID_STATE',
      message: 'Invalid OAuth state parameter',
    });
  }

  if (Date.now() - state.createdAt > STATE_TTL_MS) {
    return err({
      code: 'INVALID_STATE',
      message: 'OAuth state has expired',
    });
  }

  const tokenResult = await googleOAuthClient.exchangeCode(code, state.redirectUri);
  if (!tokenResult.ok) {
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: tokenResult.error.message,
      details: tokenResult.error.details,
    });
  }

  const tokenResponse = tokenResult.value;

  const userInfoResult = await googleOAuthClient.getUserInfo(tokenResponse.accessToken);
  if (!userInfoResult.ok) {
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: `Failed to get user info: ${userInfoResult.error.message}`,
    });
  }

  const userInfo = userInfoResult.value;

  const tokens: OAuthTokens = {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt: new Date(Date.now() + tokenResponse.expiresIn * 1000).toISOString(),
    scope: tokenResponse.scope,
  };

  const saveResult = await oauthConnectionRepository.saveConnection(
    state.userId,
    state.provider,
    userInfo.email,
    tokens
  );

  if (!saveResult.ok) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save connection: ${saveResult.error.message}`,
    });
  }

  return ok(saveResult.value);
}
