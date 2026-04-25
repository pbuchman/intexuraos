/**
 * `withLlmSpan` — wrap an LLM provider call with an OpenTelemetry span and
 * record canonical `llm.*` attributes plus duration.
 *
 * Span name pattern: `llm.<provider>.generate`. Attributes follow the
 * INT-1538 observability contract:
 *   - llm.provider
 *   - llm.model
 *   - llm.input_tokens
 *   - llm.output_tokens
 *   - llm.cached_input_tokens (only when caller provides it)
 *   - llm.cost_usd
 *   - llm.duration_ms
 *
 * The helper is OTel-SDK-agnostic. It calls `trace.getTracer(...)`, which
 * returns a no-op tracer when OTel has not been initialized. That keeps it
 * safe to drop into a worker before S1 (`initWorker()`) lands.
 */
import { getErrorMessage } from '@intexuraos/common-core';
import { type LlmProvider } from '@intexuraos/llm-contract';
import { SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Span tag names accepted by {@link withLlmSpan}. Kept as a closed union so
 * span names are a known finite set that matches the dashboards.
 *
 * Span tags use the canonical `LlmProviders` values from
 * `@intexuraos/llm-contract` (anthropic/openai/google/perplexity/openrouter),
 * matching the architectural rule enforced by `verify-llm-architecture`.
 */
export type LlmProviderName = LlmProvider;

/**
 * Attributes recorded on the LLM span on success. `durationMs` is filled in
 * automatically by the helper — callers do not pass it.
 */
export interface LlmSpanAttributes {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Optional. Only set on the span when defined. */
  cachedInputTokens?: number;
  costUsd: number;
  durationMs: number;
}

/**
 * Successful return value of {@link withLlmSpan}.
 */
export interface WithLlmSpanResult<T> {
  result: T;
  durationMs: number;
}

const TRACER_NAME = '@intexuraos/llm-utils';

/**
 * Wrap an async LLM provider call with an OpenTelemetry span.
 *
 * @param provider - Provider name; embedded in the span name.
 * @param fn - The provider call. Receives no arguments and returns a Promise.
 * @param recordAttributes - Maps the resolved value into the LLM span
 *   attributes. Called only on success. Receives the value the helper will
 *   return inside `result`.
 * @returns On success, `{ result, durationMs }`. On failure, the original
 *   error is rethrown so the caller's existing error mapping still runs.
 */
export async function withLlmSpan<T>(
  provider: LlmProviderName,
  fn: () => Promise<T>,
  recordAttributes: (result: T) => Omit<LlmSpanAttributes, 'durationMs'>
): Promise<WithLlmSpanResult<T>> {
  const tracer = trace.getTracer(TRACER_NAME);
  const span = tracer.startSpan(`llm.${provider}.generate`);
  span.setAttribute('llm.provider', provider);
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const attrs = recordAttributes(result);
    span.setAttribute('llm.model', attrs.model);
    span.setAttribute('llm.input_tokens', attrs.inputTokens);
    span.setAttribute('llm.output_tokens', attrs.outputTokens);
    if (attrs.cachedInputTokens !== undefined) {
      span.setAttribute('llm.cached_input_tokens', attrs.cachedInputTokens);
    }
    span.setAttribute('llm.cost_usd', attrs.costUsd);
    span.setAttribute('llm.duration_ms', durationMs);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = getErrorMessage(error);
    span.setAttribute('llm.duration_ms', durationMs);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
    throw error;
  }
}
