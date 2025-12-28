/**
 * Auth0 client implementation for OAuth2 operations.
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Auth0Client, RefreshResult, AuthError } from '../../domain/identity/index.js';

/**
 * Auth0 configuration.
 */
export interface Auth0Config {
  domain: string;
  clientId: string;
}

/**
 * Load Auth0 config from environment.
 */
export function loadAuth0Config(): Auth0Config | null {
  const domain = process.env['AUTH0_DOMAIN'];
  const clientId = process.env['AUTH0_CLIENT_ID'];

  if (domain === undefined || domain === '' || clientId === undefined || clientId === '') {
    return null;
  }

  return { domain, clientId };
}

/**
 * Auth0 error response structure.
 */
interface Auth0ErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Auth0 token response.
 */
interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

/**
 * HTTP client for Auth0 token endpoint.
 */
async function postTokenRequest(
  url: string,
  body: string
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const responseBody: unknown = await response.json();
  return { status: response.status, body: responseBody };
}

/**
 * Auth0 client implementation.
 */
export class Auth0ClientImpl implements Auth0Client {
  constructor(private readonly config: Auth0Config) {}

  async refreshAccessToken(refreshToken: string): Promise<Result<RefreshResult, AuthError>> {
    const tokenUrl = `https://${this.config.domain}/oauth/token`;

    const formBody = [
      `client_id=${encodeURIComponent(this.config.clientId)}`,
      `grant_type=refresh_token`,
      `refresh_token=${encodeURIComponent(refreshToken)}`,
    ].join('&');

    try {
      const httpRes = await postTokenRequest(tokenUrl, formBody);

      if (httpRes.status < 200 || httpRes.status >= 300) {
        const body = httpRes.body;

        if (
          body !== null &&
          typeof body === 'object' &&
          'error' in body &&
          typeof body.error === 'string'
        ) {
          const auth0Error = body as Auth0ErrorResponse;

          // Map Auth0 errors to domain errors
          if (auth0Error.error === 'invalid_grant') {
            return err({
              code: 'INVALID_GRANT',
              message: auth0Error.error_description ?? 'Refresh token is invalid or expired',
            });
          }

          return err({
            code: 'INTERNAL_ERROR',
            message: auth0Error.error_description ?? auth0Error.error,
          });
        }

        return err({
          code: 'INTERNAL_ERROR',
          message: 'Auth0 token refresh failed',
        });
      }

      const tokenResponse = httpRes.body as Auth0TokenResponse;

      return ok({
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type,
        expiresIn: tokenResponse.expires_in,
        scope: tokenResponse.scope,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token, // new refresh token if rotation enabled
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Auth0 request failed: ${getErrorMessage(error)}`,
      });
    }
  }
}
