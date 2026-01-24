/**
 * @intexuraos/common-http
 *
 * Fastify helpers, requestId, error mapping, and authentication utilities.
 * Depends on @intexuraos/common-core for error types.
 */

// Re-export common-core types for convenience
export type { ErrorCode, Result } from '@intexuraos/common-core';
export {
  ERROR_HTTP_STATUS,
  IntexuraOSError,
  getErrorMessage,
  ok,
  err,
  isOk,
  isErr,
} from '@intexuraos/common-core';

// Re-export llm-utils redaction utilities for convenience
export { redactToken, redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-utils';

// HTTP response types and helpers
export {
  type Diagnostics,
  type ApiOk,
  type ApiError,
  type ErrorBody,
  type ApiResponse,
  ok as apiOk,
  fail as apiFail,
} from './http/response.js';

// Request ID handling
export { REQUEST_ID_HEADER, getRequestId } from './http/requestId.js';

// Fastify plugin
export { intexuraFastifyPlugin } from './http/fastifyPlugin.js';

// Validation helpers
export { handleValidationError } from './http/validation.js';

// Logger utilities
export {
  shouldLogRequest,
  registerQuietHealthCheckLogging,
  logIncomingRequest,
  type LogIncomingRequestOptions,
} from './http/logger.js';

// Auth utilities
export { type JwtConfig, type VerifiedJwt, verifyJwt, clearJwksCache } from './auth/jwt.js';

export {
  type AuthUser,
  requireAuth,
  tryAuth,
  fastifyAuthPlugin,
} from './auth/fastifyAuthPlugin.js';

// Internal service-to-service auth
export { type InternalAuthResult, validateInternalAuth } from './auth/internalAuth.js';
