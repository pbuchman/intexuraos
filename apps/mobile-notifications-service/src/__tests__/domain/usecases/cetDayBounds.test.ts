// apps/mobile-notifications-service/src/__tests__/domain/usecases/cetDayBounds.test.ts
import { describe, it, expect } from 'vitest';
import { cetDayBounds } from '../../../domain/usecases/cetDayBounds.js';

describe('cetDayBounds', () => {
  it('returns 00:00 CET (23:00 UTC prev day) .. 24:00 CET for a winter date (UTC+1)', () => {
    // 2026-02-10 CET = 2026-02-09T23:00:00Z .. 2026-02-10T23:00:00Z
    const bounds = cetDayBounds('2026-02-10');
    expect(new Date(bounds.fromSec * 1000).toISOString()).toBe('2026-02-09T23:00:00.000Z');
    expect(new Date(bounds.toSec * 1000).toISOString()).toBe('2026-02-10T23:00:00.000Z');
  });

  it('returns 00:00 CEST (22:00 UTC prev day) .. 24:00 CEST for a summer date (UTC+2)', () => {
    // 2026-07-15 CEST = 2026-07-14T22:00:00Z .. 2026-07-15T22:00:00Z
    const bounds = cetDayBounds('2026-07-15');
    expect(new Date(bounds.fromSec * 1000).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(new Date(bounds.toSec * 1000).toISOString()).toBe('2026-07-15T22:00:00.000Z');
  });

  it('emits bounds as unix seconds (not ms)', () => {
    const bounds = cetDayBounds('2026-04-17');
    expect(Number.isInteger(bounds.fromSec)).toBe(true);
    expect(bounds.toSec - bounds.fromSec).toBe(24 * 60 * 60);
  });
});
