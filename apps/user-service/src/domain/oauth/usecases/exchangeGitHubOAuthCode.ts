/**
 * Exchange GitHub OAuth Code Use-Case
 *
 * Exchanges authorization code for tokens and stores connection.
 * GitHub does not issue refresh tokens, so we store an empty string
 * and set a far-future expiry.
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { OAuthConnectionPublic, OAuthState } from '../models/OAuthConnection.js';
import type { OAuthError } from '../models/OAuthError.js';
import type { OAuthConnectionRepository } from '../ports/OAuthConnectionRepository.js';
import type { GitHubOAuthClient } from '../ports/GitHubOAuthClient.js';

export interface ExchangeGitHubOAuthCodeInput {
  code: string;
  state: string;
}

export interface ExchangeGitHubOAuthCodeDeps {
  oauthConnectionRepository: OAuthConnectionRepository;
  gitHubOAuthClient: GitHubOAuthClient;
  logger: Logger;
}

const STATE_TTL_MS = 10 * 60 * 1000;

// Far-future expiry — GitHub tokens don't expire unless revoked
const GITHUB_TOKEN_EXPIRES_AT = '9999-12-31T00:00:00.000Z';

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

export async function exchangeGitHubOAuthCode(
  input: ExchangeGitHubOAuthCodeInput,
  deps: ExchangeGitHubOAuthCodeDeps
): Promise<Result<OAuthConnectionPublic, OAuthError>> {
  const { code, state: stateString } = input;
  const { oauthConnectionRepository, gitHubOAuthClient, logger } = deps;

  const state = parseState(stateString);
  if (state === null) {
    logger.warn({}, 'SECURITY: Invalid OAuth state parameter - potential CSRF attack');
    return err({
      code: 'INVALID_STATE',
      message: 'Invalid OAuth state parameter',
    });
  }

  if (Date.now() - state.createdAt > STATE_TTL_MS) {
    logger.warn(
      { userId: state.userId, provider: state.provider },
      'SECURITY: OAuth state expired - potential replay attack'
    );
    return err({
      code: 'INVALID_STATE',
      message: 'OAuth state has expired',
    });
  }

  logger.info({ userId: state.userId, provider: state.provider }, 'GitHub OAuth state validated successfully');

  const tokenResult = await gitHubOAuthClient.exchangeCode(code, state.redirectUri);
  if (!tokenResult.ok) {
    logger.error(
      { userId: state.userId, provider: state.provider, errorMessage: tokenResult.error.message },
      'GitHub token exchange failed'
    );
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: tokenResult.error.message,
      details: tokenResult.error.details,
    });
  }

  logger.info({ userId: state.userId, provider: state.provider }, 'GitHub OAuth token exchanged successfully');

  const tokenResponse = tokenResult.value;

  const userInfoResult = await gitHubOAuthClient.getUserInfo(tokenResponse.accessToken);
  if (!userInfoResult.ok) {
    logger.error(
      { userId: state.userId, provider: state.provider, errorMessage: userInfoResult.error.message },
      'Failed to retrieve GitHub user info'
    );
    return err({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: `Failed to get user info: ${userInfoResult.error.message}`,
    });
  }

  const userInfo = userInfoResult.value;

  logger.info(
    { userId: state.userId, provider: state.provider, username: userInfo.username },
    'GitHub user info retrieved'
  );

  // Store username in email field — GitHub usernames are the primary identity
  // No refresh token for GitHub, empty string placeholder
  const saveResult = await oauthConnectionRepository.saveConnection(
    state.userId,
    state.provider,
    userInfo.username,
    {
      accessToken: tokenResponse.accessToken,
      refreshToken: '',
      expiresAt: GITHUB_TOKEN_EXPIRES_AT,
      scope: tokenResponse.scope,
    }
  );

  if (!saveResult.ok) {
    logger.error(
      { userId: state.userId, provider: state.provider, errorMessage: saveResult.error.message },
      'Failed to save GitHub OAuth connection'
    );
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save connection: ${saveResult.error.message}`,
    });
  }

  logger.info(
    { userId: state.userId, provider: state.provider, username: userInfo.username },
    'GitHub OAuth connection saved successfully'
  );

  return ok(saveResult.value);
}
