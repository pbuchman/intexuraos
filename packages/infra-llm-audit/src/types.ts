/**
 * LLM Audit Logging Types.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type LlmAuditStatus = 'success' | 'error';

/**
 * LLM Audit Log entry stored in Firestore.
 */
export interface LlmAuditLog {
  id: string;
  provider: LlmProvider;
  model: string;
  method: string;

  // Request (full storage)
  prompt: string;
  promptLength: number;

  // Response (full storage)
  status: LlmAuditStatus;
  response?: string;
  responseLength?: number;
  error?: string;

  // Timing
  startedAt: string;
  completedAt: string;
  durationMs: number;

  // Context (optional)
  userId?: string;
  researchId?: string;

  createdAt: string;
}

/**
 * Parameters for creating an audit log entry.
 */
export interface CreateAuditLogParams {
  provider: LlmProvider;
  model: string;
  method: string;
  prompt: string;
  startedAt: Date;
  userId?: string;
  researchId?: string;
}

/**
 * Parameters for completing an audit log entry with success.
 */
export interface CompleteAuditLogSuccessParams {
  response: string;
}

/**
 * Parameters for completing an audit log entry with error.
 */
export interface CompleteAuditLogErrorParams {
  error: string;
}
