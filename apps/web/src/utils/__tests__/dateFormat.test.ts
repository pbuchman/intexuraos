import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatDateTimeAccessible,
  formatDateTimeCompact,
} from '../dateFormat.js';

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

  it('formats timestamps in the persisted IANA time zone', () => {
    expect(formatDateTime('2026-07-21T10:00:00.000Z', 'America/New_York')).toContain('06:00 AM');
    expect(formatDateTimeCompact('2026-07-21T10:00:00.000Z', 'Europe/Warsaw')).toBe(
      'Jul 21, 12:00 PM'
    );
  });
});

describe('formatDateTimeAccessible', () => {
  it('uses a full localized date and names the persisted IANA timezone', () => {
    expect(
      formatDateTimeAccessible('2026-07-21T10:00:00.000Z', 'Europe/Warsaw')
    ).toMatch(/July 21, 2026.*Europe\/Warsaw/);
  });
});
