/**
 * Tests for error utilities and types.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_HTTP_STATUS, type ErrorCode, getErrorMessage, IntexuraOSError } from '../errors.js';

describe('Error utilities', () => {
  describe('ERROR_HTTP_STATUS', () => {
    it('maps INVALID_REQUEST to 400', () => {
      expect(ERROR_HTTP_STATUS.INVALID_REQUEST).toBe(400);
    });

    it('maps UNAUTHORIZED to 401', () => {
      expect(ERROR_HTTP_STATUS.UNAUTHORIZED).toBe(401);
    });

    it('maps FORBIDDEN to 403', () => {
      expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    });

    it('maps NOT_FOUND to 404', () => {
      expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    });

    it('maps CONFLICT to 409', () => {
      expect(ERROR_HTTP_STATUS.CONFLICT).toBe(409);
    });

    it('maps DOWNSTREAM_ERROR to 502', () => {
      expect(ERROR_HTTP_STATUS.DOWNSTREAM_ERROR).toBe(502);
    });

    it('maps INTERNAL_ERROR to 500', () => {
      expect(ERROR_HTTP_STATUS.INTERNAL_ERROR).toBe(500);
    });

    it('maps MISCONFIGURED to 503', () => {
      expect(ERROR_HTTP_STATUS.MISCONFIGURED).toBe(503);
    });

    it('has mapping for all error codes', () => {
      const allCodes: ErrorCode[] = [
        'INVALID_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'DOWNSTREAM_ERROR',
        'INTERNAL_ERROR',
        'MISCONFIGURED',
        'NOTION_NOT_CONNECTED',
        'PAGE_NOT_CONFIGURED',
        'RESEARCH_NOT_COMPLETED',
        'NO_SYNTHESIS',
        'ALREADY_EXPORTED',
        'NOTION_UNAUTHORIZED',
      ];

      for (const code of allCodes) {
        expect(ERROR_HTTP_STATUS[code]).toBeDefined();
        expect(typeof ERROR_HTTP_STATUS[code]).toBe('number');
      }
    });
  });

  describe('IntexuraOSError', () => {
    it('creates error with code and message', () => {
      const error = new IntexuraOSError('NOT_FOUND', 'Resource not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(IntexuraOSError);
      expect(error.name).toBe('IntexuraOSError');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Resource not found');
      expect(error.httpStatus).toBe(404);
      expect(error.details).toBeUndefined();
    });

    it('creates error with details', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const error = new IntexuraOSError('INVALID_REQUEST', 'Validation failed', details);

      expect(error.code).toBe('INVALID_REQUEST');
      expect(error.message).toBe('Validation failed');
      expect(error.httpStatus).toBe(400);
      expect(error.details).toEqual(details);
    });

    it('sets correct HTTP status for each error code', () => {
      const testCases: { code: ErrorCode; expectedStatus: number }[] = [
        { code: 'INVALID_REQUEST', expectedStatus: 400 },
        { code: 'UNAUTHORIZED', expectedStatus: 401 },
        { code: 'FORBIDDEN', expectedStatus: 403 },
        { code: 'NOT_FOUND', expectedStatus: 404 },
        { code: 'CONFLICT', expectedStatus: 409 },
        { code: 'DOWNSTREAM_ERROR', expectedStatus: 502 },
        { code: 'INTERNAL_ERROR', expectedStatus: 500 },
        { code: 'MISCONFIGURED', expectedStatus: 503 },
      ];

      for (const { code, expectedStatus } of testCases) {
        const error = new IntexuraOSError(code, 'test message');
        expect(error.httpStatus).toBe(expectedStatus);
      }
    });

    it('can be thrown and caught', () => {
      expect(() => {
        throw new IntexuraOSError('INTERNAL_ERROR', 'Something broke');
      }).toThrow(IntexuraOSError);
    });

    it('has stack trace', () => {
      const error = new IntexuraOSError('INTERNAL_ERROR', 'test');
      expect(error.stack).toBeDefined();
    });
  });

  describe('getErrorMessage', () => {
    it('extracts message from Error instance', () => {
      const error = new Error('Something went wrong');
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('extracts message from IntexuraOSError', () => {
      const error = new IntexuraOSError('NOT_FOUND', 'Resource not found');
      expect(getErrorMessage(error)).toBe('Resource not found');
    });

    it('returns fallback for non-Error object', () => {
      expect(getErrorMessage({ foo: 'bar' })).toBe('Unknown error');
    });

    it('returns fallback for null', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
    });

    it('returns fallback for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });

    it('returns fallback for string', () => {
      expect(getErrorMessage('error string')).toBe('Unknown error');
    });

    it('returns fallback for number', () => {
      expect(getErrorMessage(42)).toBe('Unknown error');
    });

    it('uses custom fallback when provided', () => {
      expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    });

    it('uses custom fallback for non-Error objects', () => {
      expect(getErrorMessage({ code: 500 }, 'Server error')).toBe('Server error');
    });

    it('still extracts message from Error even with custom fallback', () => {
      const error = new Error('Actual message');
      expect(getErrorMessage(error, 'Custom fallback')).toBe('Actual message');
    });
  });
});
