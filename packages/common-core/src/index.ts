/**
 * @intexuraos/common-core
 *
 * Pure utilities with zero infrastructure dependencies.
 * This is a leaf package that cannot depend on any other packages.
 */

// Result types for explicit error handling
export { type Result, ok, err, isOk, isErr } from './result.js';

// Error types and codes
export {
  type ErrorCode,
  ERROR_HTTP_STATUS,
  IntexuraOSError,
  getErrorMessage,
  getErrorCauseChain,
  type SerializedError,
  serializeError,
} from './errors.js';

// Logger interface for adapters
export type { Logger } from './logging.js';
export { getLogLevel } from './logging.js';

// Typed env reader
export { loadEnv } from './loadEnv.js';

// Public web app URL helpers
export {
  DEFAULT_WEB_APP_URL,
  buildWebAppHashUrl,
  normalizeWebAppUrl,
  resolveWebAppUrl,
} from './webAppUrl.js';

// Generic service container factory (DI lifecycle)
export { createServiceContainer, type ServiceContainerHandle } from './serviceContainer.js';

// Service feedback contract (cross-service communication)
export type { ServiceFeedback } from './serviceFeedback.js';
export {
  isSuccessFeedback,
  isFailureFeedback,
  successFeedback,
  failureFeedback,
} from './serviceFeedback.js';

// Service error codes
export { ServiceErrorCodes, type ServiceErrorCode } from './serviceErrorCodes.js';

// Tracing utilities for distributed tracing
export * from './tracing/index.js';

// Redaction helpers for logging
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';
