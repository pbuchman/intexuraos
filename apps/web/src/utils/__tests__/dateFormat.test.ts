import { describe, expect, it } from 'vitest';

import * as dateFormat from '../dateFormat.js';

describe('formatDateTimeCompact', () => {
  it('formats a compact timestamp without the year', () => {
    const formatDateTimeCompact = (
      dateFormat as {
        formatDateTimeCompact?: (isoDate: string) => string;
      }
    ).formatDateTimeCompact;

    expect(formatDateTimeCompact).toBeTypeOf('function');
    expect(formatDateTimeCompact?.('2026-03-25T16:45:00')).toBe('Mar 25, 4:45 PM');
  });
});
