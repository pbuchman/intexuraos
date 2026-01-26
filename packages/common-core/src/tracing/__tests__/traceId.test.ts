import { describe, expect, it } from 'vitest';
import { extractOrGenerateTraceId, traceIdHeaders, TRACE_ID_HEADER } from '../traceId.js';

describe('extractOrGenerateTraceId', () => {
  it('returns existing traceId from lowercase header', () => {
    const headers = {
      'x-trace-id': 'existing-trace-123',
    };
    const result = extractOrGenerateTraceId(headers);
    expect(result).toBe('existing-trace-123');
  });

  it('returns existing traceId from mixed-case header', () => {
    const headers = {
      'X-Trace-Id': 'existing-trace-456',
    };
    const result = extractOrGenerateTraceId(headers);
    expect(result).toBe('existing-trace-456');
  });

  it('returns existing traceId from header array', () => {
    const headers = {
      'x-trace-id': ['trace-1', 'trace-2'],
    };
    const result = extractOrGenerateTraceId(headers);
    expect(result).toBe('trace-1');
  });

  it('generates new traceId when header is missing', () => {
    const headers = {};
    const result = extractOrGenerateTraceId(headers);
    expect(result).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  });

  it('generates new traceId when header is empty string', () => {
    const headers = {
      'x-trace-id': '',
    };
    const result = extractOrGenerateTraceId(headers);
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates new traceId when header array is empty', () => {
    const headers = {
      'x-trace-id': [],
    };
    const result = extractOrGenerateTraceId(headers);
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('traceIdHeaders', () => {
  it('returns headers object with X-Trace-Id', () => {
    const result = traceIdHeaders('test-trace-789');
    expect(result).toEqual({ [TRACE_ID_HEADER]: 'test-trace-789' });
  });
});
