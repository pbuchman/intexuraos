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
import type { NormalizedUsage, OwnerType } from '@intexuraos/llm-contract';
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
  /** Owner scope of the call. Defaults to 'system' when omitted to preserve legacy behavior. */
  ownerType?: OwnerType;
  /** Label identifying the calling client/transport (e.g. 'openrouter-generate'). Defaults to source.component when omitted. */
  clientName?: string;
  /** Cost reported by the provider (e.g. OpenRouter usage.cost). When set, the receiver records pricingSource: 'provider_reported'. */
  providerReportedUsd?: number | null;
  /** Semantic identifier for what the prompt was used for (e.g. 'linear-issue-title', 'code-worker-validation') */
  promptType?: string;
  /**
   * Wall-clock duration of the LLM call, in milliseconds.
   *
   * REQUIRED. Captured by the provider wrapper or computed from a `Date.now()`
   * checkpoint on the failure path. Forwarded into the structured log line and
   * to the configured sink so dashboards have per-call latency.
   */
  durationMs: number;
  /**
   * Optional per-call correlation overrides. Sinks forward these into
   * the emitted usage event's `correlation` block (alongside any
   * sink-level overrides such as `taskId` resolved from
   * `getCorrelationTaskId`). Primary use case: callers that have
   * per-call context (e.g. orchestrator forwarding `researchId` from the
   * triggering research record) can opt in without changing the sink wiring.
   */
  correlation?: {
    taskId?: string | null;
    sessionId?: string | null;
    requestId?: string | null;
    researchId?: string | null;
  };
}

/**
 * Sink contract for persisting LLM usage events.
 *
 * `UsageSink` is an **abstract class with a private brand**, not a structural
 * interface. This is deliberate: TypeScript's `private` modifier makes the
 * type **nominal**, so an inline object literal like
 * `{ log: () => Promise.resolve() }` — a bespoke no-op — is rejected at
 * compile time ("Property '__usageSinkBrand' is missing"). Only classes that
 * `extends UsageSink` inherit the brand and can be passed where a `UsageSink`
 * is required.
 *
 * Every LLM call in the monorepo MUST report usage through one of the
 * officially-sanctioned sinks:
 *
 * - Production services → {@link HttpInternalAuthUsageSink} (posts to
 *   `llm-usage-service`).
 * - Webhook-style integrations → {@link HttpWebhookUsageSink}.
 * - Tests → {@link FakeUsageSink} (captures records for assertions).
 * - CLI tools / scripts that genuinely opt out → {@link NoopUsageSink}.
 *
 * If you find yourself reaching for an inline no-op, you are bypassing
 * observability. Use {@link NoopUsageSink} instead — its name is the audit
 * trail, and code review has a fighting chance to notice.
 */
export abstract class UsageSink {
  /**
   * Nominal brand. The `private` modifier means external code cannot
   * synthesise this field; subclasses inherit it and satisfy the type.
   * Do not remove, rename, or duplicate on ad-hoc objects.
   */
  private readonly __usageSinkBrand = 'UsageSink' as const;

  abstract log(params: UsageLogParams): Promise<void>;

  /**
   * Accessor exposed purely so the private brand field is referenced and
   * TypeScript's `noUnusedLocals` flag does not strip it. Never call this
   * outside of regression tests — it leaks the brand name and has no
   * business purpose.
   *
   * @internal
   */
  get __brand(): 'UsageSink' {
    return this.__usageSinkBrand;
  }
}

/**
 * Sink that discards all usage events.
 *
 * Deliberate opt-out for CLI tools, scripts, and other contexts that genuinely
 * do not want usage tracking. No longer used as a silent default — every
 * LLM client construction must pass an explicit sink.
 */
export class NoopUsageSink extends UsageSink {
  override log(): Promise<void> {
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
        durationMs: params.durationMs,
        success: params.success,
        ...(params.errorMessage !== undefined && { errorMessage: params.errorMessage }),
        ...(params.promptType !== undefined && { promptType: params.promptType }),
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
