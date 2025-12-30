/**
 * LLM Audit Logging Implementation.
 *
 * Logs all LLM API requests and responses to Firestore.
 * Controlled by INTEXURAOS_AUDIT_LLMS environment variable (defaults to true).
 */

import { getFirestore } from '@intexuraos/infra-firestore';
import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  LlmAuditLog,
  CreateAuditLogParams,
  CompleteAuditLogSuccessParams,
  CompleteAuditLogErrorParams,
} from './types.js';

const COLLECTION_NAME = 'llm_api_logs';

/**
 * Check if audit logging is enabled.
 * Controlled by INTEXURAOS_AUDIT_LLMS env var, defaults to true.
 */
export function isAuditEnabled(): boolean {
  const envValue = process.env['INTEXURAOS_AUDIT_LLMS'];
  // Default to true if not set
  if (envValue === undefined || envValue === '') {
    return true;
  }
  // Only explicitly disable if set to 'false', '0', or 'no'
  return !['false', '0', 'no'].includes(envValue.toLowerCase());
}

/**
 * Create a pending audit log entry and start timing.
 * Returns an audit context that should be completed with success or error.
 */
export function createAuditContext(params: CreateAuditLogParams): AuditContext {
  return new AuditContext(params);
}

/**
 * Audit context for tracking an LLM request/response cycle.
 */
export class AuditContext {
  private readonly id: string;
  private readonly params: CreateAuditLogParams;
  private completed = false;

  constructor(params: CreateAuditLogParams) {
    this.id = crypto.randomUUID();
    this.params = params;
  }

  /**
   * Complete the audit with a successful response.
   */
  async success(result: CompleteAuditLogSuccessParams): Promise<void> {
    if (this.completed) return;
    this.completed = true;

    if (!isAuditEnabled()) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.params.startedAt.getTime();

    // Build log object, conditionally adding optional properties
    const log: LlmAuditLog = {
      id: this.id,
      provider: this.params.provider,
      model: this.params.model,
      method: this.params.method,
      prompt: this.params.prompt,
      promptLength: this.params.prompt.length,
      status: 'success',
      response: result.response,
      responseLength: result.response.length,
      startedAt: this.params.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      createdAt: completedAt.toISOString(),
    };

    // Add optional context if provided
    if (this.params.userId !== undefined) {
      log.userId = this.params.userId;
    }
    if (this.params.researchId !== undefined) {
      log.researchId = this.params.researchId;
    }

    await saveAuditLog(log);
  }

  /**
   * Complete the audit with an error.
   */
  async error(result: CompleteAuditLogErrorParams): Promise<void> {
    if (this.completed) return;
    this.completed = true;

    if (!isAuditEnabled()) return;

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.params.startedAt.getTime();

    // Build log object, conditionally adding optional properties
    const log: LlmAuditLog = {
      id: this.id,
      provider: this.params.provider,
      model: this.params.model,
      method: this.params.method,
      prompt: this.params.prompt,
      promptLength: this.params.prompt.length,
      status: 'error',
      error: result.error,
      startedAt: this.params.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      createdAt: completedAt.toISOString(),
    };

    // Add optional context if provided
    if (this.params.userId !== undefined) {
      log.userId = this.params.userId;
    }
    if (this.params.researchId !== undefined) {
      log.researchId = this.params.researchId;
    }

    await saveAuditLog(log);
  }
}

/**
 * Save an audit log entry to Firestore.
 */
async function saveAuditLog(log: LlmAuditLog): Promise<Result<void>> {
  try {
    const firestore = getFirestore();

    // Remove undefined fields before saving
    const cleanLog: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(log)) {
      if (value !== undefined) {
        cleanLog[key] = value;
      }
    }

    await firestore.collection(COLLECTION_NAME).doc(log.id).set(cleanLog);
    return ok(undefined);
  } catch (error) {
    const message = getErrorMessage(error);
    // eslint-disable-next-line no-console
    console.error(`Failed to save LLM audit log: ${message}`);
    return err(new Error(message));
  }
}
