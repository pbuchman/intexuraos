/**
 * Standard error codes for service execution failures.
 * Used with ServiceFeedback.errorCode for debugging and logging.
 */
export const ServiceErrorCodes = {
  // Network/Infrastructure
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication/Authorization
  AUTH_FAILED: 'AUTH_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Business Logic
  DUPLICATE: 'DUPLICATE',
  NOT_FOUND: 'NOT_FOUND',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',

  // External API
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
} as const;

export type ServiceErrorCode = (typeof ServiceErrorCodes)[keyof typeof ServiceErrorCodes];
