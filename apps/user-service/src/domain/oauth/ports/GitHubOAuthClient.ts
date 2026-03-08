/**
 * Port for GitHub OAuth operations.
 * Implemented by infra layer.
 */

import type { Result } from '@intexuraos/common-core';
import type { OAuthError } from '../models/OAuthError.js';

export interface GitHubTokenResponse {
  accessToken: string;
  tokenType: string;
  scope: string;
}

export interface GitHubUserInfo {
  username: string;
  email: string | null;
}

export interface GitHubOAuthClient {
  generateAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<Result<GitHubTokenResponse, OAuthError>>;
  getUserInfo(accessToken: string): Promise<Result<GitHubUserInfo, OAuthError>>;
  revokeToken(accessToken: string): Promise<Result<void, OAuthError>>;
}
