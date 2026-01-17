import { describe, expect, it } from 'vitest';
import { getStartOfWeek, getCurrentWeekRange } from '../dateUtils.js';

describe('getStartOfWeek', () => {
  it('returns Monday for a Wednesday date', () => {
    const wednesday = new Date('2026-01-14T15:30:00');
    const result = getStartOfWeek(wednesday);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(12);
    expect(result.getMonth()).toBe(0);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns same Monday when input is Monday', () => {
    const monday = new Date('2026-01-12T10:00:00');
    const result = getStartOfWeek(monday);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(12);
  });

  it('returns previous Monday when input is Sunday', () => {
    const sunday = new Date('2026-01-18T10:00:00');
    const result = getStartOfWeek(sunday);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(12);
  });

  it('returns previous Monday when input is Saturday', () => {
    const saturday = new Date('2026-01-17T10:00:00');
    const result = getStartOfWeek(saturday);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(12);
  });

  it('handles month boundary correctly', () => {
    const wednesdayFeb = new Date('2026-02-04T10:00:00');
    const result = getStartOfWeek(wednesdayFeb);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(2);
    expect(result.getMonth()).toBe(1);
  });

  it('handles year boundary correctly', () => {
    const wednesdayJan = new Date('2026-01-01T10:00:00');
    const result = getStartOfWeek(wednesdayJan);

    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(29);
    expect(result.getMonth()).toBe(11);
    expect(result.getFullYear()).toBe(2025);
  });
});

describe('getCurrentWeekRange', () => {
  it('returns a range spanning exactly 7 days', () => {
    const { start, end } = getCurrentWeekRange();

    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(diffDays).toBe(7);
  });

  it('start is always a Monday at midnight', () => {
    const { start } = getCurrentWeekRange();

    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('end is always the following Monday at midnight', () => {
    const { start, end } = getCurrentWeekRange();

    expect(end.getDay()).toBe(1);
    expect(end.getHours()).toBe(0);

    const expectedEnd = new Date(start);
    expectedEnd.setDate(start.getDate() + 7);
    expect(end.getTime()).toBe(expectedEnd.getTime());
  });
});
