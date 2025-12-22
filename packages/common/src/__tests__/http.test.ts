import { describe, it, expect } from 'vitest';
import { ok, fail } from '../http/response.js';
import { getRequestId, REQUEST_ID_HEADER } from '../http/requestId.js';
import { PraxOSError, ERROR_HTTP_STATUS, getErrorMessage } from '../http/errors.js';

describe('HTTP Response', () => {
  describe('ok()', () => {
    it('creates success response with data', () => {
      const response = ok({ id: 'test-123' });

      expect(response).toEqual({
        success: true,
        data: { id: 'test-123' },
      });
    });

    it('creates success response with diagnostics', () => {
      const response = ok({ id: 'test-123' }, { requestId: 'req-456', durationMs: 42 });

      expect(response).toEqual({
        success: true,
        data: { id: 'test-123' },
        diagnostics: {
          requestId: 'req-456',
          durationMs: 42,
        },
      });
    });
  });

  describe('fail()', () => {
    it('creates error response with code and message', () => {
      const response = fail('INVALID_REQUEST', 'Missing required field');

      expect(response).toEqual({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing required field',
        },
      });
    });

    it('creates error response with details', () => {
      const response = fail('INVALID_REQUEST', 'Validation failed', undefined, { field: 'email' });

      expect(response).toEqual({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: { field: 'email' },
        },
      });
    });

    it('creates error response with diagnostics', () => {
      const response = fail('DOWNSTREAM_ERROR', 'External service failed', {
        requestId: 'req-789',
        durationMs: 100,
        downstreamStatus: 500,
        endpointCalled: 'https://api.example.com/data',
      });

      expect(response).toEqual({
        success: false,
        error: {
          code: 'DOWNSTREAM_ERROR',
          message: 'External service failed',
        },
        diagnostics: {
          requestId: 'req-789',
          durationMs: 100,
          downstreamStatus: 500,
          endpointCalled: 'https://api.example.com/data',
        },
      });
    });
  });
});

describe('Request ID', () => {
  it('extracts request ID from headers', () => {
    const headers = { [REQUEST_ID_HEADER]: 'existing-id-123' };
    const requestId = getRequestId(headers);

    expect(requestId).toBe('existing-id-123');
  });

  it('extracts request ID from array header', () => {
    const headers = { [REQUEST_ID_HEADER]: ['first-id', 'second-id'] };
    const requestId = getRequestId(headers);

    expect(requestId).toBe('first-id');
  });

  it('generates UUID when header is missing', () => {
    const headers = {};
    const requestId = getRequestId(headers);

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('generates UUID when header is empty string', () => {
    const headers = { [REQUEST_ID_HEADER]: '' };
    const requestId = getRequestId(headers);

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('PraxOSError', () => {
  it('creates error with code and message', () => {
    const error = new PraxOSError('NOT_FOUND', 'Resource not found');

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error.httpStatus).toBe(404);
    expect(error.details).toBeUndefined();
  });

  it('creates error with details', () => {
    const error = new PraxOSError('INVALID_REQUEST', 'Bad input', {
      field: 'id',
    });

    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.httpStatus).toBe(400);
    expect(error.details).toEqual({ field: 'id' });
  });

  it('maps all error codes to HTTP status', () => {
    expect(ERROR_HTTP_STATUS.INVALID_REQUEST).toBe(400);
    expect(ERROR_HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.DOWNSTREAM_ERROR).toBe(502);
    expect(ERROR_HTTP_STATUS.INTERNAL_ERROR).toBe(500);
    expect(ERROR_HTTP_STATUS.MISCONFIGURED).toBe(503);
  });
});

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    const error = new Error('Something went wrong');
    expect(getErrorMessage(error)).toBe('Something went wrong');
  });

  it('extracts message from PraxOSError instance', () => {
    const error = new PraxOSError('NOT_FOUND', 'Resource not found');
    expect(getErrorMessage(error)).toBe('Resource not found');
  });

  it('returns default fallback for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('Unknown error');
    expect(getErrorMessage(123)).toBe('Unknown error');
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
    expect(getErrorMessage({ message: 'not an Error' })).toBe('Unknown error');
  });

  it('returns custom fallback for non-Error values', () => {
    expect(getErrorMessage('string error', 'Custom fallback')).toBe('Custom fallback');
    expect(getErrorMessage(null, 'Unknown Firestore error')).toBe('Unknown Firestore error');
    expect(getErrorMessage({}, 'Unknown Notion error')).toBe('Unknown Notion error');
  });
});
