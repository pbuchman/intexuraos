/**
 * Settings domain error types.
 */

export type SettingsErrorCode =
  | 'NOT_FOUND' // Settings not found (used internally)
  | 'FORBIDDEN' // User not authorized to access settings
  | 'INTERNAL_ERROR'; // Unexpected error

export interface SettingsError {
  code: SettingsErrorCode;
  message: string;
  details?: unknown;
}
