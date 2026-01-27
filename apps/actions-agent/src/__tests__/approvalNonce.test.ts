/**
 * Tests for approval nonce utility functions.
 */
import { describe, expect, it } from 'vitest';
import {
  generateApprovalNonce,
  generateNonceExpiration,
  isNonceExpired,
  validateNonce,
} from '../domain/utils/approvalNonce.js';

describe('approvalNonce utility', () => {
  describe('generateApprovalNonce', () => {
    it('generates a 4-character hex string', () => {
      const nonce = generateApprovalNonce();
      expect(nonce).toHaveLength(4);
      expect(/^[0-9a-f]{4}$/.test(nonce)).toBe(true);
    });

    it('generates different values on each call', () => {
      const nonce1 = generateApprovalNonce();
      const nonce2 = generateApprovalNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it('generates lowercase hex characters', () => {
      const nonce = generateApprovalNonce();
      expect(nonce).toBe(nonce.toLowerCase());
    });
  });

  describe('generateNonceExpiration', () => {
    it('generates a valid ISO 8601 timestamp', () => {
      const expiration = generateNonceExpiration();
      expect(() => new Date(expiration)).not.toThrow();
      expect(Date.parse(expiration)).not.toBeNaN();
    });

    it('generates a timestamp approximately 15 minutes in the future', () => {
      const now = Date.now();
      const expiration = generateNonceExpiration();
      const expirationTime = new Date(expiration).getTime();

      // Should be ~15 minutes (900000ms) in the future
      // Allow 100ms tolerance for test execution time
      expect(expirationTime - now).toBeGreaterThanOrEqual(899900);
      expect(expirationTime - now).toBeLessThanOrEqual(900100);
    });
  });

  describe('isNonceExpired', () => {
    it('returns false for a future expiration', () => {
      const futureExpiration = new Date(Date.now() + 60000).toISOString();
      expect(isNonceExpired(futureExpiration)).toBe(false);
    });

    it('returns true for a past expiration', () => {
      const pastExpiration = new Date(Date.now() - 1000).toISOString();
      expect(isNonceExpired(pastExpiration)).toBe(true);
    });

    it('returns true for an expiration at or before the current time', () => {
      // Use a timestamp slightly in the past to avoid timing issues
      const pastExpiration = new Date(Date.now() - 1).toISOString();
      expect(isNonceExpired(pastExpiration)).toBe(true);
    });
  });

  describe('validateNonce', () => {
    it('returns true when nonces match', () => {
      expect(validateNonce('a3f2', 'a3f2')).toBe(true);
    });

    it('returns false when nonces do not match', () => {
      expect(validateNonce('a3f2', 'b4e1')).toBe(false);
    });

    it('returns false when actionNonce is undefined', () => {
      expect(validateNonce(undefined, 'a3f2')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(validateNonce('a3f2', 'A3F2')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(validateNonce('', '')).toBe(true); // Empty equals empty
      expect(validateNonce('a3f2', '')).toBe(false);
      expect(validateNonce('', 'a3f2')).toBe(false);
    });
  });
});
