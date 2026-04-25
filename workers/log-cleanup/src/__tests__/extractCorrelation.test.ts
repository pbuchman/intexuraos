import { describe, it, expect } from 'vitest';
import { extractCorrelation } from '../extractCorrelation.js';
import { runWithRequestContext, getRequestContext } from '../requestContextShim.js';

describe('extractCorrelation', () => {
  it('uses x-request-id when present', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'abc' });
    expect(ctx.requestId).toBe('abc');
    expect(ctx.correlationId).toBe('abc');
    expect(ctx.traceId).toBeUndefined();
    expect(ctx.parentId).toBeUndefined();
  });

  it('falls back to generated UUID when x-request-id is missing', () => {
    const ctx = extractCorrelation({});
    expect(typeof ctx.requestId).toBe('string');
    expect(ctx.requestId.length).toBeGreaterThan(0);
    expect(ctx.correlationId).toBe(ctx.requestId);
  });

  it('falls back to generated UUID when x-request-id is empty string', () => {
    const ctx = extractCorrelation({ 'x-request-id': '' });
    expect(ctx.requestId.length).toBeGreaterThan(0);
  });

  it('handles null/undefined attributes', () => {
    const a = extractCorrelation(null);
    const b = extractCorrelation(undefined);
    expect(a.requestId.length).toBeGreaterThan(0);
    expect(b.requestId.length).toBeGreaterThan(0);
  });

  it('uses x-correlation-id when distinct', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r1', 'x-correlation-id': 'c1' });
    expect(ctx.requestId).toBe('r1');
    expect(ctx.correlationId).toBe('c1');
  });

  it('falls back to requestId when x-correlation-id is empty', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r1', 'x-correlation-id': '' });
    expect(ctx.correlationId).toBe('r1');
  });

  it('parses W3C traceparent header', () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const ctx = extractCorrelation({ 'x-request-id': 'r1', traceparent });
    expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.parentId).toBe('b7ad6b7169203331');
  });

  it('ignores malformed traceparent', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r1', traceparent: 'garbage' });
    expect(ctx.traceId).toBeUndefined();
    expect(ctx.parentId).toBeUndefined();
  });
});

describe('runWithRequestContext', () => {
  it('exposes the context via getRequestContext within the callback', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'rc-1' });
    const seen = runWithRequestContext(ctx, () => getRequestContext());
    expect(seen?.requestId).toBe('rc-1');
  });

  it('returns undefined outside any context', () => {
    expect(getRequestContext()).toBeUndefined();
  });
});
