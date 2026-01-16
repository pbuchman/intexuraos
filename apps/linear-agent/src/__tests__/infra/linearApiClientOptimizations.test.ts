/**
 * Tests for Linear API client optimization utilities.
 * Tests client caching, request deduplication, and helper exports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearClientCache,
  getClientCacheSize,
  getDedupCacheSize,
} from '../../infra/linear/linearApiClient.js';

describe('LinearApiClient Optimization Utilities', () => {
  afterEach(() => {
    clearClientCache();
  });

  describe('clearClientCache', () => {
    it('clears both client cache and request dedup cache', () => {
      clearClientCache();

      expect(getClientCacheSize()).toBe(0);
      expect(getDedupCacheSize()).toBe(0);
    });
  });

  describe('getClientCacheSize', () => {
    it('returns 0 for empty cache', () => {
      clearClientCache();

      expect(getClientCacheSize()).toBe(0);
    });
  });

  describe('getDedupCacheSize', () => {
    it('returns 0 for empty cache', () => {
      clearClientCache();

      expect(getDedupCacheSize()).toBe(0);
    });
  });
});
