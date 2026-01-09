/**
 * Calendar domain error types.
 */

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
