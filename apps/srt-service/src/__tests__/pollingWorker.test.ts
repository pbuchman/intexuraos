/**
 * Tests for polling worker.
 */
import { describe, it, expect } from 'vitest';
import { calculateNextPollDelay, DEFAULT_POLLING_CONFIG } from '../workers/pollingWorker.js';

describe('Polling Worker', () => {
  describe('calculateNextPollDelay', () => {
    it('returns initial delay for first poll', () => {
      const delay = calculateNextPollDelay(0);
      expect(delay).toBe(DEFAULT_POLLING_CONFIG.initialPollDelayMs);
    });

    it('doubles delay with each attempt', () => {
      expect(calculateNextPollDelay(0)).toBe(5000); // 5s
      expect(calculateNextPollDelay(1)).toBe(10000); // 10s
      expect(calculateNextPollDelay(2)).toBe(20000); // 20s
      expect(calculateNextPollDelay(3)).toBe(40000); // 40s
    });

    it('caps at max delay', () => {
      // At attempt 10, delay would be 5s * 2^10 = 5120s > 1h
      const delay = calculateNextPollDelay(10);
      expect(delay).toBe(DEFAULT_POLLING_CONFIG.maxPollDelayMs);
    });

    it('uses custom config when provided', () => {
      const customConfig = {
        pollCycleIntervalMs: 500,
        initialPollDelayMs: 1000,
        maxPollDelayMs: 10000,
        batchSize: 5,
      };

      expect(calculateNextPollDelay(0, customConfig)).toBe(1000);
      expect(calculateNextPollDelay(1, customConfig)).toBe(2000);
      expect(calculateNextPollDelay(5, customConfig)).toBe(10000); // Capped
    });
  });

  describe('DEFAULT_POLLING_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_POLLING_CONFIG.pollCycleIntervalMs).toBe(1000);
      expect(DEFAULT_POLLING_CONFIG.initialPollDelayMs).toBe(5000);
      expect(DEFAULT_POLLING_CONFIG.maxPollDelayMs).toBe(3600000); // 1 hour
      expect(DEFAULT_POLLING_CONFIG.batchSize).toBe(10);
    });
  });
});
