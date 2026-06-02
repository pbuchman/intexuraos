export interface MeasureLlmCallResult<T> {
  result: T;
  durationMs: number;
}

export async function measureLlmCall<T>(fn: () => Promise<T>): Promise<MeasureLlmCallResult<T>> {
  const start = Date.now();
  const result = await fn();
  return {
    result,
    durationMs: Date.now() - start,
  };
}
