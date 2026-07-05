import { err, ok, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';

interface ScheduleCadenceInput {
  localTime: string;
  timeZone: string;
}

interface NextScheduleRunInput extends ScheduleCadenceInput {
  now: string;
  lastRunLocalDate?: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseLocalTime(localTime: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(localTime);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute % 15 !== 0) {
    return null;
  }
  return { hour, minute };
}

function parseIsoDate(localDate: string): { year: number; month: number; day: number } {
  const [yearText = '', monthText = '', dayText = ''] = localDate.split('-');
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
}

function getZonedParts(instantIso: string, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(instantIso));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  /* v8 ignore start -- upstream: Intl.DateTimeFormat requests all returned fields; nullish fallbacks are defensive for runtime/ICU corruption @preserve */
  return {
    year: Number(values['year'] ?? '0'),
    month: Number(values['month'] ?? '0'),
    day: Number(values['day'] ?? '0'),
    hour: Number(values['hour'] ?? '0'),
    minute: Number(values['minute'] ?? '0'),
  };
  /* v8 ignore stop @preserve */
}

function getUtcIsoForLocalDateTime(localDate: string, localTime: string, timeZone: string): string {
  const dateParts = parseIsoDate(localDate);
  const timeParts = parseLocalTime(localTime);
  if (timeParts === null) {
    throw new Error(`Invalid local time: ${localTime}`);
  }

  let candidateMs = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0,
    0
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = getZonedParts(new Date(candidateMs).toISOString(), timeZone);
    const desiredMinutes = Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      0,
      0
    );
    const actualMinutes = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      0,
      0
    );
    const diffMs = desiredMinutes - actualMinutes;
    if (diffMs === 0) {
      return new Date(candidateMs).toISOString();
    }
    candidateMs += diffMs;
  }

  return new Date(candidateMs).toISOString();
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validateScheduleCadence(
  input: ScheduleCadenceInput
): Result<void, CalendarError> {
  if (parseLocalTime(input.localTime) === null) {
    return err({
      code: 'INVALID_REQUEST',
      message: 'Schedule local time must be HH:mm on a 15-minute boundary.',
    });
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(new Date());
  } catch {
    return err({
      code: 'INVALID_REQUEST',
      message: 'Schedule timezone must be a valid IANA timezone.',
    });
  }

  return ok(undefined);
}

export function getLocalDateInTimeZone(instantIso: string, timeZone: string): string {
  const parts = getZonedParts(instantIso, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function calculateNextScheduleRunAt(input: NextScheduleRunInput): string {
  const today = getLocalDateInTimeZone(input.now, input.timeZone);
  const todayRun = getUtcIsoForLocalDateTime(today, input.localTime, input.timeZone);
  if (todayRun > input.now && input.lastRunLocalDate !== today) {
    return todayRun;
  }
  return getUtcIsoForLocalDateTime(addDays(today, 1), input.localTime, input.timeZone);
}

export function calculateNextDailyRunAfterLocalDate(
  localDate: string,
  localTime: string,
  timeZone: string
): string {
  return getUtcIsoForLocalDateTime(addDays(localDate, 1), localTime, timeZone);
}
