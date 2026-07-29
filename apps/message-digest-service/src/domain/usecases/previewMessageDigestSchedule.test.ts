import { describe, expect, it } from 'vitest';
import { previewMessageDigestSchedule } from './previewMessageDigestSchedule.js';

describe('previewMessageDigestSchedule', () => {
  it('returns backend-calculated calendar boundaries without persistence', () => {
    expect(
      previewMessageDigestSchedule({
        schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
        evaluatedAt: '2026-07-27T12:00:00.000Z',
      })
    ).toEqual({
      ok: true,
      preview: {
        evaluatedAt: '2026-07-27T12:00:00.000Z',
        precedingBoundary: '2026-07-27T07:00:00.000Z',
        nextBoundary: '2026-07-28T07:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      },
    });
  });

  it('returns one public invalid-schedule error', () => {
    expect(
      previewMessageDigestSchedule({
        schedule: { kind: 'daily', localTime: '25:00', timeZone: 'Europe/Warsaw' },
        evaluatedAt: '2026-07-27T12:00:00.000Z',
      })
    ).toEqual({ ok: false, code: 'INVALID_SCHEDULE' });
  });
});
