// apps/mobile-notifications-service/src/domain/usecases/cetDayBounds.ts
import { IntexuraOSError } from '@intexuraos/common-core';

const TZ = 'Europe/Warsaw';

export interface DayBoundsSec {
  readonly fromSec: number;
  readonly toSec: number;
}

export function cetDayBounds(dateIso: string): DayBoundsSec {
  // Derive CET/CEST offset for the given local date by formatting a midday UTC
  // instant through Intl with timeZone=Europe/Warsaw and measuring the delta.
  const parts = dateIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    throw new IntexuraOSError('INVALID_REQUEST', `cetDayBounds: invalid date ${dateIso}`);
  }
  // Find the UTC instant whose Europe/Warsaw local date is (y, m, d) at 00:00.
  // Brute-force search both sides of UTC midnight (one of ±1h, ±2h will match).
  const candidate = Date.UTC(y, m - 1, d);
  for (const offsetHours of [0, -1, -2, 1, 2]) {
    const t = candidate + offsetHours * 60 * 60 * 1000;
    const localParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(t));
    const localYear = localParts.find((p) => p.type === 'year')?.value;
    const localMonth = localParts.find((p) => p.type === 'month')?.value;
    const localDay = localParts.find((p) => p.type === 'day')?.value;
    const localHour = localParts.find((p) => p.type === 'hour')?.value;
    const localMinute = localParts.find((p) => p.type === 'minute')?.value;
    if (
      localYear === String(y) &&
      localMonth === String(m).padStart(2, '0') &&
      localDay === String(d).padStart(2, '0') &&
      localHour === '00' &&
      localMinute === '00'
    ) {
      const fromSec = Math.floor(t / 1000);
      return { fromSec, toSec: fromSec + 24 * 60 * 60 };
    }
  }
  throw new IntexuraOSError('INTERNAL_ERROR', `cetDayBounds: could not resolve ${dateIso} in ${TZ}`);
}
