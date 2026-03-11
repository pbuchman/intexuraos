/**
 * Tests for retryable error classification utilities.
 */

import { describe, it, expect } from 'vitest';
import { isRetryableErrorCode } from '../../../domain/utils/retryableErrors.js';

describe('retryableErrors', () => {
  describe('isRetryableErrorCode', () => {
    it('returns true for worker_unavailable', () => {
      expect(isRetryableErrorCode('worker_unavailable')).toBe(true);
    });

    it('returns true for network_error', () => {
      expect(isRetryableErrorCode('network_error')).toBe(true);
    });

    it('returns false for at_capacity', () => {
      expect(isRetryableErrorCode('at_capacity')).toBe(false);
    });

    it('returns false for worker_busy', () => {
      expect(isRetryableErrorCode('worker_busy')).toBe(false);
    });

    it('returns false for dispatch_failed', () => {
      expect(isRetryableErrorCode('dispatch_failed')).toBe(false);
    });

    it('returns false for invalid_response', () => {
      expect(isRetryableErrorCode('invalid_response')).toBe(false);
    });
  });
});
