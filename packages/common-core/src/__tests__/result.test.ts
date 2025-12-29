/**
 * Tests for Result type utilities.
 */
import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, type Result } from '../result.js';

describe('Result utilities', () => {
  describe('ok', () => {
    it('creates a successful result with value', () => {
      const result = ok('hello');

      expect(result.ok).toBe(true);
      expect(result).toHaveProperty('value', 'hello');
    });

    it('creates a successful result with object value', () => {
      const data = { id: 1, name: 'test' };
      const result = ok(data);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(data);
      }
    });

    it('creates a successful result with null value', () => {
      const result = ok(null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('creates a successful result with undefined value', () => {
      const result = ok(undefined);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });
  });

  describe('err', () => {
    it('creates a failed result with error', () => {
      const error = new Error('Something went wrong');
      const result = err(error);

      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('error', error);
    });

    it('creates a failed result with string error', () => {
      const result = err('validation failed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('validation failed');
      }
    });

    it('creates a failed result with custom error object', () => {
      const customError = { code: 'NOT_FOUND', message: 'Resource not found' };
      const result = err(customError);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(customError);
      }
    });
  });

  describe('isOk', () => {
    it('returns true for successful result', () => {
      const result = ok('value');

      expect(isOk(result)).toBe(true);
    });

    it('returns false for failed result', () => {
      const result = err(new Error('fail'));

      expect(isOk(result)).toBe(false);
    });

    it('narrows type correctly for successful result', () => {
      const result: Result<string> = ok('hello');

      if (isOk(result)) {
        // TypeScript should know result.value is string here
        const value: string = result.value;
        expect(value).toBe('hello');
      }
    });
  });

  describe('isErr', () => {
    it('returns true for failed result', () => {
      const result = err(new Error('fail'));

      expect(isErr(result)).toBe(true);
    });

    it('returns false for successful result', () => {
      const result = ok('value');

      expect(isErr(result)).toBe(false);
    });

    it('narrows type correctly for failed result', () => {
      const result: Result<string> = err(new Error('something failed'));

      if (isErr(result)) {
        // TypeScript should know result.error is Error here
        const error: Error = result.error;
        expect(error.message).toBe('something failed');
      }
    });
  });

  describe('Result type usage patterns', () => {
    it('works with type narrowing in if statements', () => {
      const result: Result<number, string> = ok(42);

      if (result.ok) {
        expect(result.value).toBe(42);
      } else {
        // This branch should not be reached
        expect.fail('Should not reach error branch');
      }
    });

    it('works with type narrowing for error path', () => {
      const result: Result<number, string> = err('invalid input');

      if (!result.ok) {
        expect(result.error).toBe('invalid input');
      } else {
        // This branch should not be reached
        expect.fail('Should not reach success branch');
      }
    });
  });
});
