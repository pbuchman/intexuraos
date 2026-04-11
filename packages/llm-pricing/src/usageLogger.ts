/**
 * LLM Usage Logger.
 *
 * Logs LLM usage via a pluggable UsageSink. The default sink (NoopUsageSink)
 * discards events; in-cluster apps should wire up HttpInternalAuthUsageSink to
 * forward events to llm-usage-service.
 */

import { getErrorMessage } from '@intexuraos/common-core';
import type { NormalizedUsage } from '@intexuraos/llm-contract';
import type { LlmProvider } from './types.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * LLM operation types for usage tracking.
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
  | 'visualization_vegalite'
  /** Tool calling / function calling agent loops */
  | 'tool_calling';

/**
 * Parameters for logging LLM usage.
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
 * Sink contract for persisting usage events.
 */
export interface UsageSink {
  log(params: UsageLogParams): Promise<void>;
}

/**
 * Sink that emits usage payloads to structured logs.
 */
export class StructuredLogUsageSink implements UsageSink {
  readonly logger: Logger;

  constructor(deps: { logger: Logger }) {
    this.logger = deps.logger;
  }

  log(params: UsageLogParams): Promise<void> {
    this.logger.info(
      {
        usage: {
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
      },
      'LLM usage sink log'
    );
    return Promise.resolve();
  }
}

/**
 * Sink that discards all usage events.
 *
 * Default sink used when no explicit sink is provided. Apps that want usage
 * events persisted must pass HttpInternalAuthUsageSink (or another concrete
 * sink) when constructing their LLM clients.
 */
export class NoopUsageSink implements UsageSink {
  log(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Check if usage logging is enabled.
 *
 * @remarks
 * Controlled by `INTEXURAOS_LOG_LLM_USAGE` environment variable.
 * Defaults to `true` - only disabled if explicitly set to `false`, `0`, or `no` (case-insensitive).
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
 * Wraps a UsageSink and emits structured logs alongside delegation to the sink.
 * Requires a Logger instance. Sink is optional and defaults to NoopUsageSink —
 * production apps should pass an explicit sink (typically HttpInternalAuthUsageSink).
 */
export class UsageLogger {
  readonly logger: Logger;
  readonly sink: UsageSink;

  constructor(deps: { logger: Logger; sink?: UsageSink | undefined }) {
    this.logger = deps.logger;
    this.sink = deps.sink ?? new NoopUsageSink();
  }

  /**
   * Log LLM usage via the configured sink and to structured logs.
   *
   * @remarks
   * Fire-and-forget operation - sink errors are logged but don't propagate to
   * avoid disrupting LLM operations.
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
      await this.sink.log(params);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), params }, 'Failed to log LLM usage');
    }
  }
}

/**
 * Create a UsageLogger instance.
 */
export function createUsageLogger(deps: {
  logger: Logger;
  sink?: UsageSink | undefined;
}): UsageLogger {
  return new UsageLogger(deps);
}

/**
 * @deprecated Use {@link UsageLogger.log} or {@link createUsageLogger} instead.
 *
 * Legacy standalone function — always uses NoopUsageSink (no-op). Kept for
 * backward compatibility during the migration off FirestoreUsageSink.
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
