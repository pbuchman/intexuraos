/**
 * Generic retry helper for LLM client operations.
 *
 * Retries transient {@link LLMError} codes (`RATE_LIMITED`, `OVERLOADED`, `TIMEOUT`)
 * with exponential backoff. Honors a provider-supplied `retryAfterMs` when present.
 *
 * @packageDocumentation
 */

import type { Result } from '@intexuraos/common-core';
import type { LLMError, LLMErrorCode } from '@intexuraos/llm-contract';

/**
 * The set of {@link LLMErrorCode}s that are considered transient and worth retrying.
 */
const RETRIABLE: ReadonlySet<LLMErrorCode> = new Set<LLMErrorCode>([
  'RATE_LIMITED',
  'OVERLOADED',
  'TIMEOUT',
]);

/**
 * Options for {@link withRetry}.
 */
export interface WithRetryOptions {
  /** Maximum number of attempts (inclusive of the first attempt). */
  maxAttempts: number;
  /** Initial backoff delay in milliseconds. Doubles every attempt. */
  baseDelayMs: number;
  /** Optional cap on backoff delay (default: 30_000ms). */
  maxDelayMs?: number;
  /** Sleep override for tests. Defaults to `setTimeout`-based promise. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps an LLM call with retry-on-transient-error semantics.
 *
 * @param fn - Function that performs the LLM call once. Returns a {@link Result}.
 * @param opts - Retry configuration.
 * @returns The first successful {@link Result}, or the last error after exhaustion.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => client.callApiOnce(prompt, options),
 *   { maxAttempts: 3, baseDelayMs: 500 },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<Result<T, LLMError>>,
  opts: WithRetryOptions
): Promise<Result<T, LLMError>> {
  const sleeper =
    opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const maxDelay = opts.maxDelayMs ?? 30_000;

  let last: Result<T, LLMError> | null = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const res = await fn();
    if (res.ok) return res;
    last = res;
    if (!RETRIABLE.has(res.error.code)) return res;
    if (attempt === opts.maxAttempts) break;
    const providerDelay = (res.error as { retryAfterMs?: number }).retryAfterMs;
    const expBackoff = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), maxDelay);
    const delay = providerDelay ?? expBackoff;
    await sleeper(delay);
  }
  return last as Result<T, LLMError>;
}
