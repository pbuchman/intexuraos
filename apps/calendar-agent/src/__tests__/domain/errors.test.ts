/**
 * Tests for calendar domain errors.
 */
import { describe, it, expect } from 'vitest';
import { mapUserServiceError } from '../../domain/errors.js';
import type { UserServiceError } from '@intexuraos/internal-clients';

describe('mapUserServiceError', () => {
  it('maps CONNECTION_NOT_FOUND to NOT_CONNECTED', () => {
    const userServiceError: UserServiceError = {
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found',
    };
    const result = mapUserServiceError(userServiceError);

    expect(result).toEqual({
      code: 'NOT_CONNECTED',
      message: 'Google Calendar not connected',
    });
  });

  it('maps TOKEN_REFRESH_FAILED to TOKEN_ERROR', () => {
    const userServiceError: UserServiceError = {
      code: 'TOKEN_REFRESH_FAILED',
      message: 'Token refresh failed',
    };
    const result = mapUserServiceError(userServiceError);

    expect(result).toEqual({
      code: 'TOKEN_ERROR',
      message: 'Failed to refresh token',
    });
  });

  it('maps OAUTH_NOT_CONFIGURED to INTERNAL_ERROR', () => {
    const userServiceError: UserServiceError = {
      code: 'OAUTH_NOT_CONFIGURED',
      message: 'OAuth not configured',
    };
    const result = mapUserServiceError(userServiceError);

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'OAuth not configured',
    });
  });

  it('maps unknown error codes to INTERNAL_ERROR with original message', () => {
    const userServiceError: UserServiceError = {
      code: 'UNKNOWN_ERROR' as UserServiceError['code'],
      message: 'Something went wrong',
    };
    const result = mapUserServiceError(userServiceError);

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    });
  });

  it('maps FORBIDDEN to INTERNAL_ERROR with original message', () => {
    const userServiceError: UserServiceError = {
      code: 'FORBIDDEN' as UserServiceError['code'],
      message: 'Access forbidden',
    };
    const result = mapUserServiceError(userServiceError);

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Access forbidden',
    });
  });
});
