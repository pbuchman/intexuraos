/**
 * Tests for request ID utilities.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestId, REQUEST_ID_HEADER } from '../http/requestId.js';

// Mock crypto.randomUUID
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-1234'),
}));

describe('Request ID utilities', () => {
  describe('REQUEST_ID_HEADER', () => {
    it('has correct header name', () => {
      expect(REQUEST_ID_HEADER).toBe('x-request-id');
    });
  });

  describe('getRequestId', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns existing string header value', () => {
      const headers = {
        'x-request-id': 'existing-request-id',
      };

      const result = getRequestId(headers);

      expect(result).toBe('existing-request-id');
    });

    it('returns first element of array header', () => {
      const headers = {
        'x-request-id': ['first-id', 'second-id'],
      };

      const result = getRequestId(headers);

      expect(result).toBe('first-id');
    });

    it('generates UUID when header is undefined', () => {
      const headers: Record<string, string | string[] | undefined> = {};

      const result = getRequestId(headers);

      expect(result).toBe('mock-uuid-1234');
    });

    it('generates UUID when header is empty string', () => {
      const headers = {
        'x-request-id': '',
      };

      const result = getRequestId(headers);

      expect(result).toBe('mock-uuid-1234');
    });

    it('generates UUID when array header is empty', () => {
      const headers = {
        'x-request-id': [],
      };

      const result = getRequestId(headers);

      expect(result).toBe('mock-uuid-1234');
    });

    it('generates UUID when array contains only empty strings', () => {
      const headers = {
        'x-request-id': [''],
      };

      const result = getRequestId(headers);

      expect(result).toBe('mock-uuid-1234');
    });

    it('generates UUID when first array element is undefined', () => {
      const headers = {
        'x-request-id': [undefined as unknown as string],
      };

      const result = getRequestId(headers);

      expect(result).toBe('mock-uuid-1234');
    });
  });
});
