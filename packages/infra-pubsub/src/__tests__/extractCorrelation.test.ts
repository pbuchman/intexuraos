import { describe, expect, it } from 'vitest';
import { extractCorrelation } from '../extractCorrelation.js';

describe('extractCorrelation', () => {
  it('extracts requestId and correlationId from attributes', () => {
    const ctx = extractCorrelation({ 'x-request-id': 'r', 'x-correlation-id': 'c' });
    expect(ctx.requestId).toBe('r');
    expect(ctx.correlationId).toBe('c');
    expect(ctx.traceId).toBeUndefined();
    expect(ctx.parentId).toBeUndefined();
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

  it('parses a valid traceparent', () => {
    const traceId = 'a'.repeat(32);
    const parentId = 'b'.repeat(16);
    const ctx = extractCorrelation({
      'x-request-id': 'r',
      'x-correlation-id': 'c',
      traceparent: `00-${traceId}-${parentId}-01`,
    });
    expect(ctx.traceId).toBe(traceId);
    expect(ctx.parentId).toBe(parentId);
  });

  it('omits traceId/parentId when traceparent is malformed (garbage)', () => {
    const ctx = extractCorrelation({
      'x-request-id': 'r',
      'x-correlation-id': 'c',
      traceparent: 'garbage',
    });
    expect('traceId' in ctx).toBe(false);
    expect('parentId' in ctx).toBe(false);
  });

  it('omits traceId/parentId when traceparent has wrong segment lengths', () => {
    const ctx = extractCorrelation({
      'x-request-id': 'r',
      'x-correlation-id': 'c',
      traceparent: '00-tooShort-bbbbbbbbbbbbbbbb-01',
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
