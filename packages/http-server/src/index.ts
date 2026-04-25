/**
 * HTTP Server utilities package.
 *
 * This package provides:
 * - Health check utilities for services
 * - Validation error handlers
 * - Common server setup patterns
 */

// Health check utilities
export {
  type HealthStatus,
  type HealthCheck,
  type HealthResponse,
  checkSecrets,
  checkFirestore,
  checkNotionSdk,
  computeOverallStatus,
  buildHealthResponse,
  validateRequiredEnv,
} from './health.js';

// Validation error handler
export { createValidationErrorHandler } from './validation-handler.js';

// IntexuraOSError-aware error handler (plan §8)
export { createErrorHandler, type CreateErrorHandlerOptions } from './errorHandler.js';

// Request-context Fastify integration (plan §3)
export {
  registerRequestContext,
  buildRequestContext,
  X_REQUEST_ID,
  X_CORRELATION_ID,
} from './requestContext.js';
