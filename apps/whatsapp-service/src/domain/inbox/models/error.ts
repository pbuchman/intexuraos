/**
 * Domain error types for Inbox operations.
 */
import type { Result } from '@intexuraos/common-core';

/**
 * Domain error codes for Inbox operations.
 */
export type InboxErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Domain error type.
 */
export interface InboxError {
  code: InboxErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Result type for Inbox operations.
 */
export type InboxResult<T> = Result<T, InboxError>;
