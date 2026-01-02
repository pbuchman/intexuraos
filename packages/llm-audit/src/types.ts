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

  prompt: string;
  promptLength: number;

  status: LlmAuditStatus;
  response?: string;
  responseLength?: number;
  error?: string;

  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;

  startedAt: string;
  completedAt: string;
  durationMs: number;

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
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Parameters for completing an audit log entry with error.
 */
export interface CompleteAuditLogErrorParams {
  error: string;
}
