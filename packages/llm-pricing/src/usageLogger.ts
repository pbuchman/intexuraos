/**
 * LLM Usage Logger.
 *
 * Logs LLM usage via a pluggable UsageSink. Every UsageLogger requires an
 * explicit sink — there is no silent default. Production apps should wire up
 * HttpInternalAuthUsageSink to forward events to llm-usage-service. Tests may
 * pass a fake sink (e.g., FakeUsageSink). The legacy NoopUsageSink remains
 * exported as a deliberate opt-out for CLI tools / scripts that genuinely do
 * not want usage tracking.
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
 * Deliberate opt-out for CLI tools, scripts, and other contexts that genuinely
 * do not want usage tracking. No longer used as a silent default — every
 * LLM client construction must pass an explicit sink.
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
 * Requires both a Logger and an explicit UsageSink — production apps should
 * pass HttpInternalAuthUsageSink, tests should pass a fake, and CLI/script
 * contexts that genuinely opt out can pass NoopUsageSink.
 */
export class UsageLogger {
  readonly logger: Logger;
  readonly sink: UsageSink;

  constructor(deps: { logger: Logger; sink: UsageSink }) {
    this.logger = deps.logger;
    this.sink = deps.sink;
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
export function createUsageLogger(deps: { logger: Logger; sink: UsageSink }): UsageLogger {
  return new UsageLogger(deps);
}
