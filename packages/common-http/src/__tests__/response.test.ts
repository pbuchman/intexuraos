/**
 * Tests for API response utilities.
 */
import { describe, it, expect } from 'vitest';
import { ok, fail, type Diagnostics } from '../http/response.js';

describe('Response utilities', () => {
  describe('ok', () => {
    it('creates success response with data only', () => {
      const result = ok({ id: 1, name: 'test' });

      expect(result).toEqual({
        success: true,
        data: { id: 1, name: 'test' },
      });
    });

    it('creates success response with data and diagnostics', () => {
      const diagnostics: Diagnostics = {
        requestId: 'req-123',
        durationMs: 50,
      };

      const result = ok({ id: 1 }, diagnostics);

      expect(result).toEqual({
        success: true,
        data: { id: 1 },
        diagnostics: {
          requestId: 'req-123',
          durationMs: 50,
        },
      });
    });

    it('creates success response with full diagnostics', () => {
      const diagnostics: Diagnostics = {
        requestId: 'req-456',
        durationMs: 100,
        downstreamStatus: 200,
        downstreamRequestId: 'ds-req-789',
        endpointCalled: 'https://api.example.com/resource',
      };

      const result = ok('success', diagnostics);

      expect(result).toEqual({
        success: true,
        data: 'success',
        diagnostics,
      });
    });

    it('does not include diagnostics when undefined', () => {
      const result = ok('data', undefined);

      expect(result).toEqual({
        success: true,
        data: 'data',
      });
      expect(result).not.toHaveProperty('diagnostics');
    });

    it('handles null data', () => {
      const result = ok(null);

      expect(result).toEqual({
        success: true,
        data: null,
      });
    });

    it('handles array data', () => {
      const result = ok([1, 2, 3]);

      expect(result).toEqual({
        success: true,
        data: [1, 2, 3],
      });
    });
  });

  describe('fail', () => {
    it('creates error response with code and message', () => {
      const result = fail('NOT_FOUND', 'Resource not found');

      expect(result).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    });

    it('creates error response with diagnostics', () => {
      const diagnostics: Diagnostics = {
        requestId: 'req-err-123',
        durationMs: 25,
      };

      const result = fail('UNAUTHORIZED', 'Invalid token', diagnostics);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token',
        },
        diagnostics,
      });
    });

    it('creates error response with details', () => {
      const details = {
        errors: [
          { path: 'email', message: 'Invalid format' },
          { path: 'name', message: 'Required' },
        ],
      };

      const result = fail('INVALID_REQUEST', 'Validation failed', undefined, details);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details,
        },
      });
    });

    it('creates error response with all parameters', () => {
      const diagnostics: Diagnostics = {
        requestId: 'req-full-123',
        durationMs: 150,
        downstreamStatus: 500,
      };
      const details = { context: 'additional info' };

      const result = fail('DOWNSTREAM_ERROR', 'External service failed', diagnostics, details);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'DOWNSTREAM_ERROR',
          message: 'External service failed',
          details,
        },
        diagnostics,
      });
    });

    it('does not include diagnostics when undefined', () => {
      const result = fail('INTERNAL_ERROR', 'Server error');

      expect(result).not.toHaveProperty('diagnostics');
    });

    it('does not include details when undefined', () => {
      const result = fail('FORBIDDEN', 'Access denied');

      expect(result.error).not.toHaveProperty('details');
    });

    it('creates error response for all error codes', () => {
      const codes = [
        'INVALID_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'DOWNSTREAM_ERROR',
        'INTERNAL_ERROR',
        'MISCONFIGURED',
      ] as const;

      for (const code of codes) {
        const result = fail(code, `Error: ${code}`);
        expect(result.success).toBe(false);
        expect(result.error.code).toBe(code);
      }
    });
  });
});
