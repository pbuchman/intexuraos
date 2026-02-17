/**
 * Calendar domain error types.
 */

import type { UserServiceError } from '@intexuraos/internal-clients';

export type CalendarErrorCode =
  | 'NOT_CONNECTED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'TOKEN_ERROR';

export interface CalendarError {
  code: CalendarErrorCode;
  message: string;
  details?: unknown;
}

export function mapUserServiceError(error: UserServiceError): CalendarError {
  switch (error.code) {
    case 'CONNECTION_NOT_FOUND':
      return { code: 'NOT_CONNECTED', message: 'Google Calendar not connected' };
    case 'TOKEN_REFRESH_FAILED':
      return { code: 'TOKEN_ERROR', message: 'Failed to refresh token' };
    case 'OAUTH_NOT_CONFIGURED':
      return { code: 'INTERNAL_ERROR', message: 'OAuth not configured' };
    default:
      return { code: 'INTERNAL_ERROR', message: error.message };
  }
}
