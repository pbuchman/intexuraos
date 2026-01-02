/**
 * @intexuraos/llm-audit
 *
 * LLM API audit logging to Firestore.
 * Logs all LLM requests and responses for debugging and monitoring.
 *
 * Configuration:
 * - INTEXURAOS_AUDIT_LLMS: Enable/disable audit logging (defaults to true)
 *
 * Depends on @intexuraos/common-core for Result types.
 */

// Types and functions from audit.ts
export type {
  LlmProvider,
  LlmAuditStatus,
  LlmAuditLog,
  CreateAuditLogParams,
  CompleteAuditLogSuccessParams,
  CompleteAuditLogErrorParams,
} from './audit.js';

export { isAuditEnabled, createAuditContext, AuditContext } from './audit.js';
