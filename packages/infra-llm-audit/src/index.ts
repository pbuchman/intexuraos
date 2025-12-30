/**
 * @intexuraos/infra-llm-audit
 *
 * LLM API audit logging to Firestore.
 * Logs all LLM requests and responses for debugging and monitoring.
 *
 * Configuration:
 * - INTEXURAOS_AUDIT_LLMS: Enable/disable audit logging (defaults to true)
 *
 * Depends on @intexuraos/common-core for Result types.
 */

// Types
export type {
  LlmProvider,
  LlmAuditStatus,
  LlmAuditLog,
  CreateAuditLogParams,
  CompleteAuditLogSuccessParams,
  CompleteAuditLogErrorParams,
} from './types.js';

// Audit functions
export {
  isAuditEnabled,
  setAuditFirestore,
  resetAuditFirestore,
  createAuditContext,
  AuditContext,
} from './audit.js';
