import { describe, expect, it } from 'vitest';

import { formatDateTimeCompact } from '../dateFormat.js';

describe('formatDateTimeCompact', () => {
  it('formats a compact timestamp without the year', () => {
    expect(formatDateTimeCompact('2026-03-25T16:45:00')).toMatch(
      /^Mar 25, 4:45 [AP]M$/,
    );
  });

  it('formats midnight correctly', () => {
    expect(formatDateTimeCompact('2026-03-25T00:00:00')).toMatch(
      /^Mar 25, 12:00 [AP]M$/,
    );
  });

  it('formats single-digit day without zero-padding', () => {
    expect(formatDateTimeCompact('2026-03-05T14:30:00')).toMatch(
      /^Mar 5, 2:30 [AP]M$/,
    );
  });

  it('pads single-digit minutes', () => {
    expect(formatDateTimeCompact('2026-03-25T09:05:00')).toMatch(
      /^Mar 25, 9:05 [AP]M$/,
    );
  });
});
