import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
  type RequestContext,
} from '../requestContext.js';

const baseCtx: RequestContext = {
  requestId: 'req-1',
  correlationId: 'req-1',
};

describe('runWithRequestContext / getRequestContext', () => {
  it('returns undefined outside any context', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it('makes context available inside the runner (sync)', () => {
    const result = runWithRequestContext(baseCtx, () => {
      const ctx = getRequestContext();
      return ctx?.requestId;
    });
    expect(result).toBe('req-1');
  });

  it('exposes requestId via convenience getRequestId()', () => {
    runWithRequestContext(baseCtx, () => {
      expect(getRequestId()).toBe('req-1');
    });
  });

  it('makes context available inside async work', async () => {
    const out = await runWithRequestContext(baseCtx, async () => {
      await Promise.resolve();
      return getRequestId();
    });
    expect(out).toBe('req-1');
  });

  it('isolates contexts across concurrent runs', async () => {
    const ctxA: RequestContext = { requestId: 'A', correlationId: 'A' };
    const ctxB: RequestContext = { requestId: 'B', correlationId: 'B' };

    const both = await Promise.all([
      runWithRequestContext(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getRequestId();
      }),
      runWithRequestContext(ctxB, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getRequestId();
      }),
    ]);

    expect(both).toEqual(['A', 'B']);
  });

  it('propagates traceId and parentId fields when provided', () => {
    runWithRequestContext(
      {
        requestId: 'r-1',
        correlationId: 'c-1',
        traceId: 't-1',
        parentId: 'p-1',
      },
      () => {
        const ctx = getRequestContext();
        expect(ctx).toEqual({
          requestId: 'r-1',
          correlationId: 'c-1',
          traceId: 't-1',
          parentId: 'p-1',
        });
      }
    );
  });

  it('returns undefined again after the runner completes', () => {
    runWithRequestContext(baseCtx, () => {
      expect(getRequestId()).toBe('req-1');
    });
    expect(getRequestId()).toBeUndefined();
  });
});
