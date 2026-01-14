/**
 * @intexuraos/common-core
 *
 * Pure utilities with zero infrastructure dependencies.
 * This is a leaf package that cannot depend on any other packages.
 */

// Result types for explicit error handling
export { type Result, ok, err, isOk, isErr } from './result.js';

// Error types and codes
export { type ErrorCode, ERROR_HTTP_STATUS, IntexuraOSError, getErrorMessage } from './errors.js';

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
