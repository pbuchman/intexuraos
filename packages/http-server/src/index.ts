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
  type HealthCheckResult,
  type HealthResponse,
  type RegisterHealthCheckOptions,
  checkSecrets,
  secretsHealthCheck,
  computeOverallStatus,
  buildHealthResponse,
  validateRequiredEnv,
  registerHealthCheck,
} from './health.js';

// Validation error handler
export { createValidationErrorHandler } from './validation-handler.js';
