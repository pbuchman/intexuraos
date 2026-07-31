const RETRYABLE_GENERATION_FAILURES: ReadonlySet<string> = new Set([
  'SOURCE_NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_CHANGED',
  'READINESS_UNAVAILABLE',
  'DELIVERY_NOT_READY',
  'READINESS_CHANGED',
  'LLM_UNAVAILABLE',
]);

export function isRetryableMessageDigestGenerationFailure(code: string): boolean {
  return RETRYABLE_GENERATION_FAILURES.has(code);
}
