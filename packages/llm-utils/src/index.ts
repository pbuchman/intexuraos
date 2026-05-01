/**
 * @intexuraos/llm-utils
 *
 * Utility functions for LLM operations across IntexuraOS.
 */

// LLM parse error utilities
export {
  createLlmParseError,
  logLlmParseError,
  withLlmParseErrorLogging,
  createDetailedParseErrorMessage,
  formatZodErrors,
  type LlmParseErrorDetails,
} from './parseError.js';

// OTel span wrapper for LLM provider calls
export {
  withLlmSpan,
  type LlmProviderName,
  type LlmSpanAttributes,
  type WithLlmSpanResult,
} from './withLlmSpan.js';

// Retry helper for transient LLM errors
export { withRetry, type WithRetryOptions } from './withRetry.js';

// Structured-output helper: markdown-strip + JSON.parse + Zod + repair loop
export {
  generateStructured,
  type GenerateStructuredParams,
  type GenerateStructuredOutput,
  type StructuredClient,
  type StructuredError,
  type StructuredGenerateResult,
} from './generateStructured.js';
