/**
 * Shared utilities module.
 *
 * Cross-cutting utilities used across multiple domains.
 */

export { type PromptBuilder, type PromptDeps } from './types.js';
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';
export {
  createLlmParseError,
  logLlmParseError,
  withLlmParseErrorLogging,
  createDetailedParseErrorMessage,
  type LlmParseErrorDetails,
} from './parseError.js';
export {
  DOMAINS,
  MODES,
  type Domain,
  type Mode,
  type DefaultApplied,
  type SafetyInfo,
} from './contextTypes.js';
export {
  isStringArray,
  isObject,
  isDomain,
  isMode,
  isDefaultApplied,
  isSafetyInfo,
} from './contextGuards.js';
// Zod schemas for direct use
export {
  DomainSchema,
  ModeSchema,
  DefaultAppliedSchema,
  SafetyInfoSchema,
} from './contextSchemas.js';
