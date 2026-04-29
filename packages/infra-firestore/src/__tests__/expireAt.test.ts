/**
 * Tests for the `computeExpireAt` TTL helper.
 */

import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { computeExpireAt, RETENTION_24H_MS, RETENTION_7D_MS } from '../expireAt.js';

describe('computeExpireAt', () => {
  it('returns now + retentionMs as a Firestore Timestamp', () => {
    const now = new Date('2026-04-29T00:00:00.000Z');
    const expireAt = computeExpireAt(RETENTION_24H_MS, now);

    expect(expireAt).toBeInstanceOf(Timestamp);
    expect(expireAt.toDate().toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('handles 7-day retention', () => {
    const now = new Date('2026-04-29T12:00:00.000Z');
    const expireAt = computeExpireAt(RETENTION_7D_MS, now);

    expect(expireAt.toDate().toISOString()).toBe('2026-05-06T12:00:00.000Z');
  });

  it('preserves millisecond precision', () => {
    const now = new Date('2026-04-29T00:00:00.123Z');
    const expireAt = computeExpireAt(1000, now);

    expect(expireAt.toMillis()).toBe(now.getTime() + 1000);
  });

  it('defaults `now` to current time when omitted', () => {
    const before = Date.now();
    const expireAt = computeExpireAt(RETENTION_24H_MS);
    const after = Date.now();

    const expectedMin = before + RETENTION_24H_MS;
    const expectedMax = after + RETENTION_24H_MS;
    expect(expireAt.toMillis()).toBeGreaterThanOrEqual(expectedMin);
    expect(expireAt.toMillis()).toBeLessThanOrEqual(expectedMax);
  });
});

describe('retention constants', () => {
  it('RETENTION_24H_MS equals 24 hours in milliseconds', () => {
    expect(RETENTION_24H_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('RETENTION_7D_MS equals 7 days in milliseconds', () => {
    expect(RETENTION_7D_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
