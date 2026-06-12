import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createGuestRateLimiter } from './guestRateLimiter.js';

describe('guestRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('check', () => {
    it('allows first request from new session', () => {
      const limiter = createGuestRateLimiter();
      const result = limiter.check('session-1');
      expect(result.ok).toBe(true);
    });

    it('allows requests up to limit', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 3 });

      // Record 2 requests
      limiter.record('session-1');
      limiter.record('session-1');

      // Third request should still be allowed
      const result = limiter.check('session-1');
      expect(result.ok).toBe(true);
    });

    it('blocks requests when limit exceeded', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 2 });

      limiter.record('session-1');
      limiter.record('session-1');

      const result = limiter.check('session-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Rate limit exceeded');
      }
    });

    it('resets after hour window', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 2 });

      limiter.record('session-1');
      limiter.record('session-1');

      // Should be blocked
      expect(limiter.check('session-1').ok).toBe(false);

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Should be allowed again
      expect(limiter.check('session-1').ok).toBe(true);
    });

    it('tracks sessions independently', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 1 });

      limiter.record('session-1');

      // session-1 blocked
      expect(limiter.check('session-1').ok).toBe(false);

      // session-2 allowed
      expect(limiter.check('session-2').ok).toBe(true);
    });

    it('includes retry time in error message', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 1 });

      limiter.record('session-1');

      // Advance 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      const result = limiter.check('session-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('30 minutes');
      }
    });
  });

  describe('record', () => {
    it('increments count for session', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 5 });

      limiter.record('session-1');
      const usage1 = limiter.getUsage('session-1');
      expect(usage1?.count).toBe(1);

      limiter.record('session-1');
      const usage2 = limiter.getUsage('session-1');
      expect(usage2?.count).toBe(2);
    });

    it('starts new window when previous expired', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 5 });

      limiter.record('session-1');
      expect(limiter.getUsage('session-1')?.count).toBe(1);

      // Advance past window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      limiter.record('session-1');
      expect(limiter.getUsage('session-1')?.count).toBe(1);
    });
  });

  describe('getUsage', () => {
    it('returns null for unknown session', () => {
      const limiter = createGuestRateLimiter();
      const usage = limiter.getUsage('unknown');
      expect(usage).toEqual({ count: 0, remaining: 100 });
    });

    it('returns correct count and remaining', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 10 });

      limiter.record('session-1');
      limiter.record('session-1');
      limiter.record('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage?.count).toBe(3);
      expect(usage?.remaining).toBe(7);
    });

    it('returns fresh usage after window expires', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 10 });

      limiter.record('session-1');
      limiter.record('session-1');

      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      const usage = limiter.getUsage('session-1');
      expect(usage).toEqual({ count: 0, remaining: 10 });
    });

    it('remaining never goes below zero', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 2 });

      limiter.record('session-1');
      limiter.record('session-1');
      limiter.record('session-1'); // Over limit

      const usage = limiter.getUsage('session-1');
      expect(usage?.remaining).toBe(0);
    });
  });

  describe('default configuration', () => {
    it('uses 100 per hour by default', () => {
      const limiter = createGuestRateLimiter();

      const usage = limiter.getUsage('new-session');
      expect(usage?.remaining).toBe(100);
    });
  });

  describe('unbounded map protection', () => {
    it('evicts the oldest entries when capacity is exceeded', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 100, maxSessions: 3 });

      limiter.record('a');
      limiter.record('b');
      limiter.record('c');
      limiter.record('d'); // 'a' should be evicted

      const aUsage = limiter.getUsage('a');
      const dUsage = limiter.getUsage('d');

      expect(aUsage).toEqual({ count: 0, remaining: 100 }); // reset (evicted)
      expect(dUsage).toEqual({ count: 1, remaining: 99 });
    });
  });
});
