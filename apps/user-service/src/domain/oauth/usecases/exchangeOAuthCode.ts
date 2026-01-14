/**
 * Exchange OAuth Code Use-Case
 *
 * Exchanges authorization code for tokens and stores connection.
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
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
  logger: Logger;
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
  const { oauthConnectionRepository, googleOAuthClient, logger } = deps;

  const state = parseState(stateString);
  if (state === null) {
    logger.warn({}, 'SECURITY: Invalid OAuth state parameter - potential CSRF attack');
    return err({
      code: 'INVALID_STATE',
      message: 'Invalid OAuth state parameter',
    });
  }

  if (Date.now() - state.createdAt > STATE_TTL_MS) {
    logger.warn({ userId: state.userId, provider: state.provider }, 'SECURITY: OAuth state expired - potential replay attack');
    return err({
      code: 'INVALID_STATE',
      message: 'OAuth state has expired',
    });
  }

  logger.info({ userId: state.userId, provider: state.provider }, 'OAuth state validated successfully');

  const tokenResult = await googleOAuthClient.exchangeCode(code, state.redirectUri);
  if (!tokenResult.ok) {
    logger.error({ userId: state.userId, provider: state.provider, errorMessage: tokenResult.error.message }, 'Token exchange failed');
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: tokenResult.error.message,
      details: tokenResult.error.details,
    });
  }

  logger.info({ userId: state.userId, provider: state.provider }, 'OAuth token exchanged successfully');

  const tokenResponse = tokenResult.value;

  const userInfoResult = await googleOAuthClient.getUserInfo(tokenResponse.accessToken);
  if (!userInfoResult.ok) {
    logger.error({ userId: state.userId, provider: state.provider, errorMessage: userInfoResult.error.message }, 'Failed to retrieve user info');
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: `Failed to get user info: ${userInfoResult.error.message}`,
    });
  }

  const userInfo = userInfoResult.value;

  logger.info({ userId: state.userId, provider: state.provider, email: userInfo.email }, 'User info retrieved from OAuth provider');

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
    logger.error({ userId: state.userId, provider: state.provider, errorMessage: saveResult.error.message }, 'Failed to save OAuth connection');
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save connection: ${saveResult.error.message}`,
    });
  }

  logger.info({ userId: state.userId, provider: state.provider, email: userInfo.email }, 'OAuth connection saved successfully');

  return ok(saveResult.value);
}

/**
 * Factory to create a bound exchangeOAuthCode use case.
 */
export function createExchangeOAuthCodeUseCase(
  oauthConnectionRepository: OAuthConnectionRepository,
  googleOAuthClient: GoogleOAuthClient,
  logger: Logger
): (input: ExchangeOAuthCodeInput) => Promise<Result<OAuthConnectionPublic, OAuthError>> {
  return async (input) => await exchangeOAuthCode(input, { oauthConnectionRepository, googleOAuthClient, logger });
}
