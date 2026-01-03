/**
 * Domain error types for Inbox operations.
 */
import type { Result } from '@intexuraos/common-core';

/**
 * Domain error codes for Inbox operations.
 */
export type WhatsAppErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Domain error type.
 */
export interface WhatsAppError {
  code: WhatsAppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Result type for Inbox operations.
 */
export type WhatsAppResult<T> = Result<T, WhatsAppError>;
