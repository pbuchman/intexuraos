/**
 * LLM Usage Logger.
 *
 * Logs LLM usage to Firestore for cost tracking and analytics.
 * Follows the same pattern as llm-audit - direct Firestore writes, no DI needed.
 *
 * Structure:
 * llm_usage_stats/{model}/                      (model as doc ID)
 *   by_call_type/{callType}/                    (callType subcollection)
 *     by_period/
 *       total/                                  (all-time aggregate)
 *         by_user/{userId}
 *       YYYY-MM/                                (monthly aggregate)
 *         by_user/{userId}
 *       YYYY-MM-DD/                             (daily stats)
 *         by_user/{userId}
 */

import { getFirestore, FieldValue } from '@intexuraos/infra-firestore';
import { getErrorMessage } from '@intexuraos/common-core';
import type { NormalizedUsage } from '@intexuraos/llm-contract';
import type { LlmProvider } from './types.js';
import type { Logger } from '@intexuraos/common-core';

const COLLECTION_NAME = 'llm_usage_stats';

/**
 * LLM operation types for usage tracking.
 *
 * @remarks
 * Each call type is tracked separately in Firestore for granular cost analysis.
 * Used to categorize operations for both usage stats and pricing calculations.
 *
 * @example
 * ```ts
 * import type { CallType } from '@intexuraos/llm-pricing';
 *
 * const callType: CallType = 'research'; // Web search enhanced
 * const simple: CallType = 'generate';   // Simple text generation
 * const image: CallType = 'image_generation'; // Image creation
 * ```
 */
export type CallType =
  /** Web search enhanced generation (with sources) */
  | 'research'
  /** Simple text generation (no web search) */
  | 'generate'
  /** Image generation operations */
  | 'image_generation'
  /** Visualization chart data analysis */
  | 'visualization_insights'
  /** Vega-Lite chart generation */
  | 'visualization_vegalite';

/**
 * Parameters for logging LLM usage.
 *
 * @remarks
 * Passed to {@link UsageLogger.log} to record token usage and costs to Firestore.
 * Aggregated by model, call type, period (total/monthly/daily), and user.
 *
 * @example
 * ```ts
 * const params: UsageLogParams = {
 *   userId: 'user-123',
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-5',
 *   callType: 'research',
 *   usage: {
 *     inputTokens: 1000,
 *     outputTokens: 500,
 *     totalTokens: 1500,
 *     costUsd: 0.0105,
 *     webSearchCalls: 3,
 *   },
 *   success: true,
 *   logger: pinoLogger, // Optional pino logger
 * };
 * ```
 */
export interface UsageLogParams {
  /** User ID for per-user tracking */
  userId: string;
  /** LLM provider (anthropic, openai, google, perplexity) */
  provider: LlmProvider;
  /** Model identifier (e.g., 'claude-sonnet-4-5') */
  model: string;
  /** Type of LLM operation performed */
  callType: CallType;
  /** Normalized usage with token counts and calculated cost */
  usage: NormalizedUsage;
  /** Whether the LLM call succeeded */
  success: boolean;
  /** Error message if success is false */
  errorMessage?: string;
  /** Optional pino logger for structured logging */
  logger?: Logger;
}

/**
 * Check if usage logging is enabled.
 *
 * @remarks
 * Controlled by `INTEXURAOS_LOG_LLM_USAGE` environment variable.
 * Defaults to `true` - only disabled if explicitly set to `false`, `0`, or `no` (case-insensitive).
 *
 * @returns `true` if logging is enabled, `false` otherwise
 *
 * @example
 * ```ts
 * import { isUsageLoggingEnabled } from '@intexuraos/llm-pricing';
 *
 * if (isUsageLoggingEnabled()) {
 *   console.log('LLM usage will be tracked');
 * }
 * ```
 */
export function isUsageLoggingEnabled(): boolean {
  const envValue = process.env['INTEXURAOS_LOG_LLM_USAGE'];
  if (envValue === undefined || envValue === '') {
    return true;
  }
  return !['false', '0', 'no'].includes(envValue.toLowerCase());
}

/**
 * LLM Usage Logger.
 *
 * @remarks
 * Logs LLM usage to Firestore for cost tracking and analytics.
 * Requires a Logger instance for structured logging - no optional logging.
 *
 * @example
 * ```ts
 * import { UsageLogger } from '@intexuraos/llm-pricing';
 * import pino from 'pino';
 *
 * const logger = pino({ name: 'my-service' });
 * const usageLogger = new UsageLogger({ logger });
 *
 * await usageLogger.log({
 *   userId: 'user-123',
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-5',
 *   callType: 'research',
 *   usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.0105 },
 *   success: true,
 * });
 * ```
 */
export class UsageLogger {
  readonly logger: Logger;

  constructor(deps: { logger: Logger }) {
    this.logger = deps.logger;
  }

  /**
   * Log LLM usage to Firestore and Cloud Logging.
   *
   * @remarks
   * Fire-and-forget operation - errors are logged but don't propagate to avoid
   * disrupting LLM operations. Writes to three aggregation levels:
   * - `total`: All-time aggregate
   * - `{YYYY-MM}`: Monthly aggregate
   * - `{YYYY-MM-DD}`: Daily aggregate
   *
   * Also writes per-user stats under `by_user/{userId}` subcollection.
   *
   * @param params - Usage parameters including tokens, cost, and metadata
   *
   * @example
   * ```ts
   * await usageLogger.log({
   *   userId: 'user-123',
   *   provider: 'anthropic',
   *   model: 'claude-sonnet-4-5',
   *   callType: 'research',
   *   usage: {
   *     inputTokens: 1000,
   *     outputTokens: 500,
   *     totalTokens: 1500,
   *     costUsd: 0.0105,
   *   },
   *   success: true,
   * });
   * ```
   *
   * @see {@link UsageLogParams} for parameter structure
   */
  async log(params: UsageLogParams): Promise<void> {
    if (!isUsageLoggingEnabled()) return;

    this.logger.info(
      {
        userId: params.userId,
        provider: params.provider,
        model: params.model,
        callType: params.callType,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        costUsd: params.usage.costUsd,
        success: params.success,
        ...(params.errorMessage !== undefined && { errorMessage: params.errorMessage }),
      },
      'LLM usage logged'
    );

    try {
      const firestore = getFirestore();
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const monthKey = now.toISOString().slice(0, 7); // YYYY-MM

      // Path: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{period}
      const modelRef = firestore.collection(COLLECTION_NAME).doc(params.model);
      const callTypeRef = modelRef.collection('by_call_type').doc(params.callType);

      const batch = firestore.batch();

      // Ensure model doc exists with metadata (prevents ghost documents)
      batch.set(
        modelRef,
        {
          model: params.model,
          provider: params.provider,
          updatedAt: now.toISOString(),
        },
        { merge: true }
      );

      // Ensure callType doc exists with metadata
      batch.set(
        callTypeRef,
        {
          callType: params.callType,
          updatedAt: now.toISOString(),
        },
        { merge: true }
      );

      // Update periods: total, month, day
      const periods = ['total', monthKey, dateKey];
      for (const period of periods) {
        const periodRef = callTypeRef.collection('by_period').doc(period);
        const updateData = {
          provider: params.provider,
          model: params.model,
          callType: params.callType,
          period,
          totalCalls: FieldValue.increment(1),
          successfulCalls: FieldValue.increment(params.success ? 1 : 0),
          failedCalls: FieldValue.increment(params.success ? 0 : 1),
          inputTokens: FieldValue.increment(params.usage.inputTokens),
          outputTokens: FieldValue.increment(params.usage.outputTokens),
          totalTokens: FieldValue.increment(params.usage.inputTokens + params.usage.outputTokens),
          costUsd: FieldValue.increment(params.usage.costUsd),
          updatedAt: now.toISOString(),
        };
        batch.set(periodRef, updateData, { merge: true });
      }

      await batch.commit();

      // Log per-user stats if userId is provided
      if (params.userId !== '') {
        await this.logUserUsage(params, now, callTypeRef, dateKey);
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), params },
        'Failed to log LLM usage to Firestore'
      );
    }
  }

  /**
   * Log per-user usage stats.
   * Path: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{date}/by_user/{userId}
   */
  private async logUserUsage(
    params: UsageLogParams,
    now: Date,
    callTypeRef: FirebaseFirestore.DocumentReference,
    dateKey: string
  ): Promise<void> {
    const firestore = getFirestore();
    const userDocRef = callTypeRef
      .collection('by_period')
      .doc(dateKey)
      .collection('by_user')
      .doc(params.userId);

    const updateData = {
      userId: params.userId,
      totalCalls: FieldValue.increment(1),
      successfulCalls: FieldValue.increment(params.success ? 1 : 0),
      inputTokens: FieldValue.increment(params.usage.inputTokens),
      outputTokens: FieldValue.increment(params.usage.outputTokens),
      costUsd: FieldValue.increment(params.usage.costUsd),
      updatedAt: now.toISOString(),
    };

    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(userDocRef);
      if (doc.exists) {
        transaction.update(userDocRef, updateData);
      } else {
        transaction.set(userDocRef, {
          ...updateData,
          createdAt: now.toISOString(),
        });
      }
    });
  }
}

/**
 * Create a UsageLogger instance.
 *
 * @remarks
 * Factory function for creating a UsageLogger with required logger dependency.
 * Use this instead of `new UsageLogger()` for consistency.
 *
 * @param deps - Dependencies including required logger
 * @returns Configured UsageLogger instance
 *
 * @example
 * ```ts
 * import { createUsageLogger } from '@intexuraos/llm-pricing';
 * import pino from 'pino';
 *
 * const logger = pino({ name: 'my-service' });
 * const usageLogger = createUsageLogger({ logger });
 * ```
 */
export function createUsageLogger(deps: { logger: Logger }): UsageLogger {
  return new UsageLogger(deps);
}

/**
 * @deprecated Use {@link UsageLogger.log} or {@link createUsageLogger} instead.
 * This standalone function will be removed in a future version.
 *
 * Log LLM usage to Firestore and Cloud Logging.
 *
 * @remarks
 * This is a legacy function for backward compatibility.
 * It uses a silent logger (no output) - migrate to UsageLogger class for proper logging.
 *
 * @param params - Usage parameters including tokens, cost, and metadata
 */
export async function logUsage(params: UsageLogParams): Promise<void> {
  const silentLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const usageLogger = new UsageLogger({ logger: silentLogger });
  await usageLogger.log(params);
}
