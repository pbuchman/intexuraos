import { describe, expect, it } from 'vitest';

import { measureLlmCall } from '../measureLlmCall.js';

describe('measureLlmCall', () => {
  it('returns the result and elapsed duration for successful calls', async () => {
    const { result, durationMs } = await measureLlmCall(() => Promise.resolve('ok'));

    expect(result).toBe('ok');
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rethrows provider errors without wrapping them', async () => {
    const error = new Error('provider failed');

    await expect(measureLlmCall(() => Promise.reject(error))).rejects.toBe(error);
  });
});
