/**
 * Port for Google OAuth operations.
 * Implemented by infra layer.
 */

import type { Result } from '@intexuraos/common-core';
import type { OAuthError } from '../models/OAuthError.js';

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

export interface GoogleUserInfo {
  email: string;
  verified: boolean;
}

export interface GoogleOAuthClient {
  generateAuthUrl(state: string, redirectUri: string): string;

  exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<Result<GoogleTokenResponse, OAuthError>>;

  refreshAccessToken(
    refreshToken: string
  ): Promise<Result<GoogleTokenResponse, OAuthError>>;

  getUserInfo(accessToken: string): Promise<Result<GoogleUserInfo, OAuthError>>;

  revokeToken(token: string): Promise<Result<void, OAuthError>>;
}
