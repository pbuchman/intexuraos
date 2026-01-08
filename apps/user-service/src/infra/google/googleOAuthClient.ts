/**
 * Google OAuth client implementation.
 * Handles token exchange, refresh, and user info retrieval.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  GoogleOAuthClient,
  GoogleTokenResponse,
  GoogleUserInfo,
} from '../../domain/oauth/index.js';
import type { OAuthError } from '../../domain/oauth/models/OAuthError.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GoogleOAuthClientImpl implements GoogleOAuthClient {
  private config: GoogleOAuthConfig;

  constructor(config: GoogleOAuthConfig) {
    this.config = config;
  }

  generateAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<Result<GoogleTokenResponse, OAuthError>> {
    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return err({
          code: 'TOKEN_EXCHANGE_FAILED',
          message: `Token exchange failed: ${String(response.status)}`,
          details: errorBody,
        });
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
        token_type: string;
      };

      if (data.refresh_token === undefined) {
        return err({
          code: 'TOKEN_EXCHANGE_FAILED',
          message: 'No refresh token received. User may need to revoke app access and try again.',
        });
      }

      return ok({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
        tokenType: data.token_type,
      });
    } catch (error) {
      return err({
        code: 'TOKEN_EXCHANGE_FAILED',
        message: `Token exchange error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async refreshAccessToken(
    refreshToken: string
  ): Promise<Result<GoogleTokenResponse, OAuthError>> {
    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return err({
          code: 'TOKEN_REFRESH_FAILED',
          message: `Token refresh failed: ${String(response.status)}`,
          details: errorBody,
        });
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
        token_type: string;
      };

      return ok({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresIn: data.expires_in,
        scope: data.scope,
        tokenType: data.token_type,
      });
    } catch (error) {
      return err({
        code: 'TOKEN_REFRESH_FAILED',
        message: `Token refresh error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async getUserInfo(accessToken: string): Promise<Result<GoogleUserInfo, OAuthError>> {
    try {
      const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to get user info: ${String(response.status)}`,
          details: errorBody,
        });
      }

      const data = (await response.json()) as {
        email: string;
        verified_email: boolean;
      };

      return ok({
        email: data.email,
        verified: data.verified_email,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `User info error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async revokeToken(token: string): Promise<Result<void, OAuthError>> {
    try {
      const response = await fetch(`${GOOGLE_REVOKE_URL}?token=${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok && response.status !== 400) {
        const errorBody = await response.text();
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to revoke token: ${String(response.status)}`,
          details: errorBody,
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Token revoke error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }
}
