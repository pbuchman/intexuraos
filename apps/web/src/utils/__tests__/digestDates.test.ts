import { describe, it, expect } from 'vitest';
import { firstDayOfMonth, lastDayOfMonth, shiftMonth, currentMonthIso, monthLabelPl } from '../digestDates.js';

describe('digestDates month helpers', () => {
  it('firstDayOfMonth / lastDayOfMonth handle leap February', () => {
    expect(firstDayOfMonth('2024-02')).toBe('2024-02-01');
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
  });

  it('lastDayOfMonth handles 30/31 day months', () => {
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
    expect(lastDayOfMonth('2026-07')).toBe('2026-07-31');
  });

  it('shiftMonth wraps years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-04', 0)).toBe('2026-04');
  });

  it('currentMonthIso returns YYYY-MM from today', () => {
    expect(currentMonthIso()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('monthLabelPl returns Polish month name and year', () => {
    expect(monthLabelPl('2026-04')).toMatch(/kwieci(eń|en)/i);
    expect(monthLabelPl('2026-04')).toContain('2026');
  });
});
