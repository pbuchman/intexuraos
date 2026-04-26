import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
  type RequestContext,
} from '../requestContextShim.js';

describe('requestContextShim', () => {
  it('getRequestContext returns undefined outside any runWithRequestContext', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('getRequestId returns undefined outside any context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('runWithRequestContext exposes ctx via getRequestContext and getRequestId', () => {
    const ctx: RequestContext = { requestId: 'r-1', correlationId: 'c-1' };
    runWithRequestContext(ctx, () => {
      expect(getRequestContext()).toBe(ctx);
      expect(getRequestId()).toBe('r-1');
    });
  });

  it('runWithRequestContext returns the value fn returns', () => {
    const ctx: RequestContext = { requestId: 'r-2', correlationId: 'c-2' };
    const result = runWithRequestContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  it('context is restored to undefined after runWithRequestContext exits', () => {
    const ctx: RequestContext = { requestId: 'r-3', correlationId: 'c-3' };
    runWithRequestContext(ctx, () => {
      expect(getRequestContext()).toBe(ctx);
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates contexts across concurrent runWithRequestContext calls', async () => {
    const ctxA: RequestContext = { requestId: 'r-A', correlationId: 'c-A' };
    const ctxB: RequestContext = { requestId: 'r-B', correlationId: 'c-B' };

    const captureAfterMicrotask = async (ctx: RequestContext): Promise<string | undefined> =>
      runWithRequestContext(ctx, async () => {
        await Promise.resolve();
        return getRequestContext()?.requestId;
      });

    const [seenA, seenB] = await Promise.all([
      captureAfterMicrotask(ctxA),
      captureAfterMicrotask(ctxB),
    ]);

    expect(seenA).toBe('r-A');
    expect(seenB).toBe('r-B');
  });
});
