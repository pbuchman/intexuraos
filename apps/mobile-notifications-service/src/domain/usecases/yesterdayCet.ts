import { IntexuraOSError } from '@intexuraos/common-core';

const TZ = 'Europe/Warsaw';

export function yesterdayCet(now: Date = new Date()): string {
  const cetTodayString = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  // cetTodayString is YYYY-MM-DD already
  const [y, m, d] = cetTodayString.split('-').map((s) => parseInt(s, 10));
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes destructured array elements possibly undefined; split('-') always returns 3 parts for valid en-CA date string @preserve */
  if (y === undefined || m === undefined || d === undefined) throw new IntexuraOSError('INTERNAL_ERROR', 'unreachable');
  /* v8 ignore stop @preserve */
  const utcMidnight = Date.UTC(y, m - 1, d);
  const yesterday = new Date(utcMidnight - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
}
