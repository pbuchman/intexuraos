import { describe, expect, it } from 'vitest';
import { extractCorrelation } from '../extractCorrelation.js';

describe('extractCorrelation', () => {
  it('extracts requestId and correlationId from attributes', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r', 'x-correlation-id': 'c' });
    expect(ctx.requestId).toBe('r');
    expect(ctx.correlationId).toBe('c');
  });

  it('generates a fresh UUID for requestId when missing, and mirrors it as correlationId', () => {
    const ctx = extractCorrelation({});
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ctx.correlationId).toBe(ctx.requestId);
  });

  it('defaults correlationId to requestId when only correlationId is missing', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'req-9' });
    expect(ctx.requestId).toBe('req-9');
    expect(ctx.correlationId).toBe('req-9');
  });

  it('treats empty string x-request-id as missing and generates a UUID', () => {
    const ctx = extractCorrelation({ 'x-request-id': '', 'x-correlation-id': 'c' });
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ctx.correlationId).toBe('c');
  });

  it('treats empty string x-correlation-id as missing and falls back to requestId', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r', 'x-correlation-id': '' });
    expect(ctx.requestId).toBe('r');
    expect(ctx.correlationId).toBe('r');
  });

  it('ignores traceparent attributes', () => {
    const ctx = extractCorrelation({
      'x-request-id': 'r',
      'x-correlation-id': 'c',
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    });
    expect('traceId' in ctx).toBe(false);
    expect('parentId' in ctx).toBe(false);
  });

  it('treats null attributes as empty and generates a UUID', () => {
    const ctx = extractCorrelation(null);
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ctx.correlationId).toBe(ctx.requestId);
  });

  it('treats undefined attributes as empty and generates a UUID', () => {
    const ctx = extractCorrelation(undefined);
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ctx.correlationId).toBe(ctx.requestId);
  });
});
