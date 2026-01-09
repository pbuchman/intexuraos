/**
 * User Service HTTP client for OAuth token retrieval.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../../domain/errors.js';
import type { OAuthTokenResult, UserServiceClient } from '../../domain/ports.js';

interface TokenResponse {
  accessToken: string;
  email: string;
}

interface ErrorResponse {
  code: string;
  error: string;
}

export class UserServiceClientImpl implements UserServiceClient {
  private baseUrl: string;
  private internalAuthToken: string;

  constructor(baseUrl: string, internalAuthToken: string) {
    this.baseUrl = baseUrl;
    this.internalAuthToken = internalAuthToken;
  }

  async getOAuthToken(userId: string): Promise<Result<OAuthTokenResult, CalendarError>> {
    try {
      const url = `${this.baseUrl}/internal/users/${userId}/oauth/google/token`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-internal-auth': this.internalAuthToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as ErrorResponse;
        const code = errorBody.code;

        if (code === 'CONNECTION_NOT_FOUND' || response.status === 404) {
          return err({ code: 'NOT_CONNECTED', message: 'Google Calendar not connected' });
        }
        if (code === 'TOKEN_REFRESH_FAILED') {
          return err({ code: 'TOKEN_ERROR', message: 'Failed to refresh token' });
        }
        if (code === 'CONFIGURATION_ERROR') {
          return err({ code: 'INTERNAL_ERROR', message: 'OAuth not configured' });
        }

        return err({
          code: 'INTERNAL_ERROR',
          message: errorBody.error,
        });
      }

      const body = (await response.json()) as TokenResponse;
      return ok({
        accessToken: body.accessToken,
        email: body.email,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to communicate with user-service: ${getErrorMessage(error)}`,
      });
    }
  }
}
