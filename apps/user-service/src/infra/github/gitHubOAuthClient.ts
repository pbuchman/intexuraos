/**
 * GitHub OAuth client implementation.
 * Handles token exchange and user info retrieval.
 * GitHub OAuth App tokens do not expire, so no refresh is needed.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  GitHubOAuthClient,
  GitHubTokenResponse,
  GitHubUserInfo,
} from '../../domain/oauth/index.js';
import type { OAuthError } from '../../domain/oauth/models/OAuthError.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

const GITHUB_SCOPES = ['repo', 'read:user'];

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GitHubOAuthClientImpl implements GitHubOAuthClient {
  private config: GitHubOAuthConfig;

  constructor(config: GitHubOAuthConfig) {
    this.config = config;
  }

  generateAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GITHUB_SCOPES.join(' '),
      state,
    });

    return `${GITHUB_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<Result<GitHubTokenResponse, OAuthError>> {
    try {
      const response = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
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
        token_type: string;
        scope: string;
      };

      return ok({
        accessToken: data.access_token,
        tokenType: data.token_type,
        scope: data.scope,
      });
    } catch (error) {
      return err({
        code: 'TOKEN_EXCHANGE_FAILED',
        message: `Token exchange error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async getUserInfo(accessToken: string): Promise<Result<GitHubUserInfo, OAuthError>> {
    try {
      const response = await fetch(GITHUB_USER_URL, {
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
        login: string;
        email: string | null;
      };

      return ok({
        username: data.login,
        email: data.email,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `User info error: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async revokeToken(accessToken: string): Promise<Result<void, OAuthError>> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(
        `https://api.github.com/applications/${this.config.clientId}/grant`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: accessToken }),
        }
      );

      if (!response.ok) {
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
