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

// Null safety utilities
export {
  ensureAllDefined,
  getFirstOrNull,
  toDateOrNull,
  toISOStringOrNull,
} from './nullability.js';

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

// Label utilities for Linear issue labels
export {
  normalizeLabel,
  hasCodeTaskLabel,
  hasPlanningTaskLabel,
  hasComplexTaskLabel,
} from './labels.js';

// Shared code-task worker type contract
export {
  CODE_TASK_WORKER_TYPES,
  isCodeTaskWorkerType,
  type CodeTaskWorkerType,
} from './codeTaskWorkerTypes.js';

// Shared internal API service catalog
export {
  INTERNAL_API_SERVICE_CATALOG,
  INTERNAL_API_BASE_URL_ENV_VARS,
  INTERNAL_API_OPENAPI_URL_ENV_VARS,
  buildInternalApiServiceDefinitions,
  buildInternalApiOpenApiSources,
  type InternalApiServiceCatalogEntry,
  type InternalApiServiceDefinition,
  type InternalApiOpenApiSource,
} from './internalServiceCatalog.js';
