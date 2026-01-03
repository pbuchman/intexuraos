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

// Security utilities
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';

// Encryption utilities
export { type EncryptedValue, type Encryptor, createEncryptor } from './encryption.js';

// Prompt utilities for LLM operations
export {
  buildResearchPrompt,
  buildSynthesisPrompt,
  type SynthesisReport,
  type AdditionalSource,
} from './prompts/index.js';
