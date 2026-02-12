/**
 * LLM Audit Logging Implementation.
 *
 * @packageDocumentation
 *
 * Logs all LLM API requests and responses to Firestore for debugging,
 * monitoring, and compliance. Controlled by `INTEXURAOS_AUDIT_LLMS`
 * environment variable (defaults to `true`).
 *
 * @remarks
 * Audit logs provide a complete trace of LLM interactions including:
 * - Full request prompts
 * - Response content (or error messages)
 * - Token usage and costs
 * - Timing information
 * - User attribution
 *
 * The audit context pattern ensures proper timing even if the caller
 * forgets to complete the audit (the timestamp is captured at creation).
 *
 * @example
 * ```ts
 * import { createAuditContext } from '@intexuraos/llm-audit';
 *
 * // Create audit context at the start of the request
 * const audit = createAuditContext({
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-5',
 *   method: 'research',
 *   prompt: 'Explain TypeScript',
 *   startedAt: new Date(),
 *   userId: 'user-123',
 * });
 *
 * try {
 *   const result = await llmClient.generate('Explain TypeScript');
 *   // Log successful completion
 *   await audit.success({
 *     response: result.content,
 *     inputTokens: result.usage.inputTokens,
 *     outputTokens: result.usage.outputTokens,
 *     costUsd: result.usage.costUsd,
 *   });
 * } catch (error) {
 *   // Log error
 *   await audit.error({ error: getErrorMessage(error) });
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '@intexuraos/common-core';
import { FirestoreAuditSink, type AuditSink } from './sink.js';
import type {
  LlmAuditLog,
  CreateAuditLogParams,
  CompleteAuditLogSuccessParams,
  CompleteAuditLogErrorParams,
} from './types.js';

const DEFAULT_AUDIT_SINK: AuditSink = new FirestoreAuditSink();

/**
 * Optional parameters for audit context creation.
 */
export interface AuditContextOptions {
  /** Custom sink used for persisting audit events. Defaults to Firestore. */
  sink?: AuditSink;
}

/**
 * Check if audit logging is enabled.
 *
 * @remarks
 * Controlled by `INTEXURAOS_AUDIT_LLMS` environment variable.
 * Defaults to `true` - only disabled if explicitly set to `false`, `0`, or `no` (case-insensitive).
 *
 * @returns `true` if audit logging is enabled, `false` otherwise
 *
 * @example
 * ```ts
 * import { isAuditEnabled } from '@intexuraos/llm-audit';
 *
 * if (isAuditEnabled()) {
 *   console.log('LLM calls will be audited');
 * }
 * ```
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
 * Create an audit context for tracking an LLM request.
 *
 * @remarks
 * Creates a unique audit log entry with the captured start time.
 * The returned {@link AuditContext} should be completed with either
 * {@link AuditContext.success} or {@link AuditContext.error}.
 *
 * @param params - Audit parameters including provider, model, method, and prompt
 * @returns Audit context for completing the log entry
 *
 * @example
 * ```ts
 * const audit = createAuditContext({
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-5',
 *   method: 'research',
 *   prompt: 'What is TypeScript?',
 *   startedAt: new Date(),
 * });
 *
 * // Later...
 * await audit.success({ response: 'TypeScript is...', inputTokens: 5, outputTokens: 20 });
 * ```
 */
export function createAuditContext(
  params: CreateAuditLogParams,
  options?: AuditContextOptions
): AuditContext {
  return new AuditContext(params, options?.sink ?? DEFAULT_AUDIT_SINK);
}

/**
 * Audit context for tracking an LLM request/response cycle.
 *
 * @remarks
 * Captures the start time when created, ensuring accurate duration
 * calculation even if there's delay before completion. Can only be
 * completed once - subsequent calls to {@link success} or {@link error}
 * are ignored.
 *
 * @example
 * ```ts
 * const audit = createAuditContext({...});
 *
 * // Complete with success
 * await audit.success({
 *   response: 'Generated text',
 *   inputTokens: 100,
 *   outputTokens: 50,
 * });
 *
 * // Or complete with error
 * await audit.error({ error: 'Rate limit exceeded' });
 *
 * // Subsequent calls are ignored
 * await audit.success({...}); // Does nothing
 * ```
 */
export class AuditContext {
  private readonly id: string;
  private readonly params: CreateAuditLogParams;
  private readonly sink: AuditSink;
  private completed = false;

  constructor(params: CreateAuditLogParams, sink: AuditSink = DEFAULT_AUDIT_SINK) {
    this.id = randomUUID();
    this.params = params;
    this.sink = sink;
  }

  /**
   * Complete the audit with a successful response.
   *
   * @remarks
   * Calculates duration from start time and writes the audit log to Firestore.
   * Only the first call takes effect - subsequent calls are ignored.
   * If audit logging is disabled, does nothing.
   *
   * @param result - Success parameters including response and optional token/cost info
   *
   * @example
   * ```ts
   * await audit.success({
   *   response: 'TypeScript is a typed superset of JavaScript...',
   *   inputTokens: 5,
   *   outputTokens: 20,
   *   costUsd: 0.0003,
   * });
   * ```
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

    // Add token and cost information if provided
    if (result.inputTokens !== undefined) {
      log.inputTokens = result.inputTokens;
    }
    if (result.outputTokens !== undefined) {
      log.outputTokens = result.outputTokens;
    }
    if (result.cacheCreationTokens !== undefined) {
      log.cacheCreationTokens = result.cacheCreationTokens;
    }
    if (result.cacheReadTokens !== undefined) {
      log.cacheReadTokens = result.cacheReadTokens;
    }
    if (result.cachedTokens !== undefined) {
      log.cachedTokens = result.cachedTokens;
    }
    if (result.reasoningTokens !== undefined) {
      log.reasoningTokens = result.reasoningTokens;
    }
    if (result.webSearchCalls !== undefined) {
      log.webSearchCalls = result.webSearchCalls;
    }
    if (result.groundingEnabled !== undefined) {
      log.groundingEnabled = result.groundingEnabled;
    }
    if (result.providerCost !== undefined) {
      log.providerCost = result.providerCost;
    }
    if (result.costUsd !== undefined) {
      log.costUsd = result.costUsd;
    }
    if (result.imageCount !== undefined) {
      log.imageCount = result.imageCount;
    }
    if (result.imageModel !== undefined) {
      log.imageModel = result.imageModel;
    }
    if (result.imageSize !== undefined) {
      log.imageSize = result.imageSize;
    }
    if (result.imageCostUsd !== undefined) {
      log.imageCostUsd = result.imageCostUsd;
    }

    await this.saveAuditLog(log);
  }

  /**
   * Complete the audit with an error.
   *
   * @remarks
   * Calculates duration from start time and writes the audit log with error details to Firestore.
   * Only the first call takes effect - subsequent calls are ignored.
   * If audit logging is disabled, does nothing.
   *
   * @param result - Error parameters including error message
   *
   * @example
   * ```ts
   * try {
   *   const result = await llmClient.generate(prompt);
   *   await audit.success({ response: result.content, ... });
   * } catch (error) {
   *   await audit.error({ error: getErrorMessage(error) });
   * }
   * ```
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

    await this.saveAuditLog(log);
  }

  private async saveAuditLog(log: LlmAuditLog): Promise<void> {
    const result = await this.sink.save(log);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`Failed to save LLM audit log: ${getErrorMessage(result.error)}`);
    }
  }
}
