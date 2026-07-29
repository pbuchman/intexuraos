import { err, ok, type Result } from '@intexuraos/common-core';

export interface DailyMessageDigestSchedule {
  kind: 'daily';
  localTime: string;
  timeZone: string;
}

export interface WeekdaysMessageDigestSchedule {
  kind: 'weekdays';
  localTime: string;
  timeZone: string;
}

export const MESSAGE_DIGEST_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type MessageDigestWeekday = (typeof MESSAGE_DIGEST_WEEKDAYS)[number];

export interface WeeklyMessageDigestSchedule {
  kind: 'weekly';
  weekday: MessageDigestWeekday;
  localTime: string;
  timeZone: string;
}

export type MessageDigestSchedule =
  | DailyMessageDigestSchedule
  | WeekdaysMessageDigestSchedule
  | WeeklyMessageDigestSchedule;

export interface MessageDigestSchedulePreview {
  evaluatedAt: string;
  precedingBoundary: string;
  nextBoundary: string;
  timeZone: string;
}

export type DailyMessageDigestSchedulePreview = MessageDigestSchedulePreview;

export interface ManualMessageDigestBoundary {
  manualBoundary: string;
  nextBoundary: string;
}

export interface MessageDigestScheduleError {
  code:
    | 'INVALID_SCHEDULE_KIND'
    | 'INVALID_WEEKDAY'
    | 'INVALID_LOCAL_TIME'
    | 'INVALID_TIME_ZONE'
    | 'INVALID_INSTANT'
    | 'INVALID_LOCAL_DATE';
  message: string;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_TIME_PATTERN = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u;
const LOCAL_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

export function getMessageDigestLocalDateRange(input: {
  timeZone: string;
  fromDate: string;
  toDate: string;
}): Result<
  { fromInclusive: string; toExclusive: string },
  MessageDigestScheduleError
> {
  if (!isValidTimeZone(input.timeZone)) {
    return err({ code: 'INVALID_TIME_ZONE', message: 'Invalid daily time zone' });
  }
  const fromDate = parseLocalDate(input.fromDate);
  const toDate = parseLocalDate(input.toDate);
  if (
    fromDate === null ||
    toDate === null ||
    localDateOrdinal(fromDate) > localDateOrdinal(toDate)
  ) {
    return err({ code: 'INVALID_LOCAL_DATE', message: 'Invalid local date range' });
  }
  const fromInclusive = resolveLocalBoundary(
    fromDate,
    { hour: 0, minute: 0 },
    input.timeZone
  );
  const toExclusive = resolveLocalBoundary(
    addLocalDays(toDate, 1),
    { hour: 0, minute: 0 },
    input.timeZone
  );
  return ok({
    fromInclusive: new Date(fromInclusive).toISOString(),
    toExclusive: new Date(toExclusive).toISOString(),
  });
}

export function previewDailyMessageDigestSchedule(input: {
  schedule: DailyMessageDigestSchedule;
  evaluatedAt: string;
}): Result<DailyMessageDigestSchedulePreview, MessageDigestScheduleError> {
  return previewMessageDigestSchedule(input);
}

export function previewMessageDigestSchedule(input: {
  schedule: MessageDigestSchedule;
  evaluatedAt: string;
}): Result<MessageDigestSchedulePreview, MessageDigestScheduleError> {
  const preceding = getMessageDigestBoundaryAtOrBefore(input.schedule, input.evaluatedAt);
  if (!preceding.ok) return preceding;
  const next = getNextMessageDigestBoundary(input.schedule, input.evaluatedAt);
  if (!next.ok) return next;
  return ok({
    evaluatedAt: new Date(input.evaluatedAt).toISOString(),
    precedingBoundary: preceding.value,
    nextBoundary: next.value,
    timeZone: input.schedule.timeZone,
  });
}

export function getDailyMessageDigestBoundaryAtOrBefore(
  schedule: DailyMessageDigestSchedule,
  instant: string
): Result<string, MessageDigestScheduleError> {
  return getMessageDigestBoundaryAtOrBefore(schedule, instant);
}

export function getMessageDigestBoundaryAtOrBefore(
  schedule: MessageDigestSchedule,
  instant: string
): Result<string, MessageDigestScheduleError> {
  const validated = validateInput(schedule, instant);
  if (!validated.ok) return validated;
  const { instantMs, localTime } = validated.value;
  const currentDate = localDateAt(instantMs, schedule.timeZone);
  for (let daysBack = 0; daysBack <= 7; daysBack += 1) {
    const date = addLocalDays(currentDate, -daysBack);
    if (!scheduleIncludesDate(schedule, date)) continue;
    const boundaryMs = resolveLocalBoundary(date, localTime, schedule.timeZone);
    if (boundaryMs <= instantMs) return ok(new Date(boundaryMs).toISOString());
  }
  throw new Error('Unable to resolve preceding Message Digest boundary');
}

export function getNextDailyMessageDigestBoundary(
  schedule: DailyMessageDigestSchedule,
  instant: string
): Result<string, MessageDigestScheduleError> {
  return getNextMessageDigestBoundary(schedule, instant);
}

export function getNextMessageDigestBoundary(
  schedule: MessageDigestSchedule,
  instant: string
): Result<string, MessageDigestScheduleError> {
  const validated = validateInput(schedule, instant);
  if (!validated.ok) return validated;
  const { instantMs, localTime } = validated.value;
  const currentDate = localDateAt(instantMs, schedule.timeZone);
  for (let daysForward = 0; daysForward <= 7; daysForward += 1) {
    const date = addLocalDays(currentDate, daysForward);
    if (!scheduleIncludesDate(schedule, date)) continue;
    const boundaryMs = resolveLocalBoundary(date, localTime, schedule.timeZone);
    if (boundaryMs > instantMs) return ok(new Date(boundaryMs).toISOString());
  }
  throw new Error('Unable to resolve next Message Digest boundary');
}

export function getManualMessageDigestBoundary(
  schedule: MessageDigestSchedule,
  invokedAt: string
): Result<ManualMessageDigestBoundary, MessageDigestScheduleError> {
  const next = getNextMessageDigestBoundary(schedule, invokedAt);
  if (!next.ok) return next;
  return ok({
    manualBoundary: new Date(invokedAt).toISOString(),
    nextBoundary: next.value,
  });
}

function validateInput(
  schedule: MessageDigestSchedule,
  instant: string
): Result<
  { instantMs: number; localTime: { hour: number; minute: number } },
  MessageDigestScheduleError
> {
  if (!isScheduleKind(schedule.kind)) {
    return err({ code: 'INVALID_SCHEDULE_KIND', message: 'Invalid schedule kind' });
  }
  if (schedule.kind === 'weekly' && !isMessageDigestWeekday(schedule.weekday)) {
    return err({ code: 'INVALID_WEEKDAY', message: 'Invalid weekly schedule weekday' });
  }
  const match = LOCAL_TIME_PATTERN.exec(schedule.localTime);
  if (match?.groups === undefined) {
    return err({ code: 'INVALID_LOCAL_TIME', message: 'Invalid daily local time' });
  }
  if (!isValidTimeZone(schedule.timeZone)) {
    return err({ code: 'INVALID_TIME_ZONE', message: 'Invalid daily time zone' });
  }
  const instantMs = Date.parse(instant);
  if (!Number.isFinite(instantMs)) {
    return err({ code: 'INVALID_INSTANT', message: 'Invalid schedule instant' });
  }
  return ok({
    instantMs,
    localTime: { hour: Number(match.groups['hour']), minute: Number(match.groups['minute']) },
  });
}

function isScheduleKind(value: unknown): value is MessageDigestSchedule['kind'] {
  return value === 'daily' || value === 'weekdays' || value === 'weekly';
}

function isMessageDigestWeekday(value: unknown): value is MessageDigestWeekday {
  return MESSAGE_DIGEST_WEEKDAYS.some((weekday) => weekday === value);
}

function scheduleIncludesDate(schedule: MessageDigestSchedule, date: LocalDate): boolean {
  if (schedule.kind === 'daily') return true;
  const weekdayIndex = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  if (schedule.kind === 'weekdays') return weekdayIndex >= 1 && weekdayIndex <= 5;
  return MESSAGE_DIGEST_WEEKDAYS[weekdayIndex === 0 ? 6 : weekdayIndex - 1] === schedule.weekday;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone.trim() !== '';
  } catch {
    return false;
  }
}

function localDateAt(instantMs: number, timeZone: string): LocalDate {
  const local = localDateTimeAt(instantMs, timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

function localDateTimeAt(instantMs: number, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  ) as Record<keyof LocalDateTime, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function resolveLocalBoundary(
  date: LocalDate,
  time: { hour: number; minute: number },
  timeZone: string
): number {
  const wallTimeMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const offsets = new Set<number>();
  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 6) {
    const instantMs = wallTimeMs + deltaHours * 60 * 60 * 1000;
    const local = localDateTimeAt(instantMs, timeZone);
    offsets.add(
      Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
        instantMs
    );
  }

  const candidates = Array.from(offsets, (offset) => wallTimeMs - offset).sort(
    (left, right) => left - right
  );
  const exact = candidates.filter((candidate) => {
    const local = localDateTimeAt(candidate, timeZone);
    return (
      local.year === date.year &&
      local.month === date.month &&
      local.day === date.day &&
      local.hour === time.hour &&
      local.minute === time.minute
    );
  });
  if (exact[0] !== undefined) return exact[0];

  const projected = candidates
    .map((candidate) => {
      const local = localDateTimeAt(candidate, timeZone);
      const localWallTime = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second
      );
      return { candidate, localWallTime };
    });
  const firstAfterGap = findFirstInstantAfterLocalGap(projected, date, wallTimeMs, timeZone);
  if (firstAfterGap !== null) return firstAfterGap;

  const compatible = projected
    .filter(({ localWallTime }) => localWallTime > wallTimeMs)
    .sort((left, right) =>
      left.localWallTime - right.localWallTime || left.candidate - right.candidate
    )[0];
  if (compatible === undefined) {
    throw new Error('Unable to resolve daily Message Digest boundary');
  }
  return compatible.candidate;
}

function findFirstInstantAfterLocalGap(
  projected: readonly { candidate: number; localWallTime: number }[],
  date: LocalDate,
  requestedWallTime: number,
  timeZone: string
): number | null {
  const ordered = [...projected].sort((left, right) => left.candidate - right.candidate);
  for (let index = 1; index < ordered.length; index += 1) {
    const [before, after] = ordered.slice(index - 1, index + 1) as [
      (typeof ordered)[number],
      (typeof ordered)[number],
    ];
    if (
      before.localWallTime >= requestedWallTime ||
      after.localWallTime <= requestedWallTime
    ) {
      continue;
    }
    let lower = before.candidate;
    let upper = after.candidate;
    while (upper - lower > 1) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (isAfterRequestedWallTime(middle, date, requestedWallTime, timeZone)) {
        upper = middle;
      } else {
        lower = middle;
      }
    }
    return upper;
  }
  return null;
}

function isAfterRequestedWallTime(
  instantMs: number,
  date: LocalDate,
  requestedWallTime: number,
  timeZone: string
): boolean {
  const local = localDateTimeAt(instantMs, timeZone);
  return (
    local.year === date.year &&
    local.month === date.month &&
    local.day === date.day &&
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) >
      requestedWallTime
  );
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseLocalDate(value: string): LocalDate | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match?.groups === undefined) return null;
  const date = {
    year: Number(match.groups['year']),
    month: Number(match.groups['month']),
    day: Number(match.groups['day']),
  };
  const normalized = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return normalized.getUTCFullYear() === date.year &&
    normalized.getUTCMonth() + 1 === date.month &&
    normalized.getUTCDate() === date.day
    ? date
    : null;
}

function localDateOrdinal(date: LocalDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}
