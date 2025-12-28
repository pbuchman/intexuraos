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
} from './health.js';

// Validation error handler
export { createValidationErrorHandler } from './validation-handler.js';
