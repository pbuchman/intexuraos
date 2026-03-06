import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../domain/utils/calendarMessageFormatting.js';

describe('formatDateTime', () => {
  it('formats start and end time', () => {
    const result = formatDateTime('2025-01-15T15:00:00', '2025-01-15T16:30:00', false);
    expect(result).not.toBeNull();
    expect(result).toContain('\u00b7'); // middle dot separator
    expect(result).toContain('\u2013'); // en-dash between times
  });

  it('formats start time only when end is null', () => {
    const result = formatDateTime('2025-01-15T14:00:00', null, false);
    expect(result).not.toBeNull();
    expect(result).toContain('\u00b7');
    expect(result).not.toContain('\u2013');
  });

  it('formats all-day event', () => {
    const result = formatDateTime('2025-01-15', undefined, true);
    expect(result).not.toBeNull();
    expect(result).toContain('(All day)');
  });

  it('returns null when start is undefined', () => {
    const result = formatDateTime(undefined, undefined, false);
    expect(result).toBeNull();
  });

  it('returns null for invalid date string', () => {
    const result = formatDateTime('not-a-date', undefined, false);
    expect(result).toBeNull();
  });

  it('returns null for invalid all-day date', () => {
    const result = formatDateTime('not-a-date', undefined, true);
    expect(result).toBeNull();
  });
});
