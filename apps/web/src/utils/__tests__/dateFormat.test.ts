import { describe, expect, it } from 'vitest';

import { formatDateTimeCompact } from '../dateFormat.js';

describe('formatDateTimeCompact', () => {
  it('formats a compact timestamp without the year', () => {
    expect(formatDateTimeCompact('2026-03-25T16:45:00')).toMatch(
      /^Mar 25, 4:45 [AP]M$/,
    );
  });
});
