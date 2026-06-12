const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export interface CooloffResetParseInput {
  text: string;
  now: Date;
}

export interface CooloffResetParseResult {
  notBeforeAt: Date;
  timezone: string;
  sourceText: string;
  reason: string;
}

interface TimeParts {
  hour: number;
  minute: number;
  timezone: string;
  sourceText: string;
  reasonPrefix: string;
}

const AM_PM_PATTERN = String.raw`((?:a|p)\.?m\.?)`;

function normalizeSourceText(value: string): string {
  return value.trim().replace(/[.,;:]+$/u, '');
}

function normalizeTimezone(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const upper = value.toUpperCase();
  return upper === 'GMT' ? 'UTC' : upper;
}

function toHour24(hourRaw: string, meridiemRaw: string | undefined): number | null {
  const hour = Number.parseInt(hourRaw, 10);

  if (meridiemRaw === undefined) {
    /* v8 ignore start -- upstream: defensive 24h bound retained for explicit reset parsing; parser-level null behavior is tested @preserve */
    if (hour > 23) return null;
    /* v8 ignore stop @preserve */
    return hour;
  }

  if (hour < 1 || hour > 12) return null;
  const meridiem = meridiemRaw.toLowerCase().replaceAll('.', '');
  if (meridiem === 'am') {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function buildNextUtcInstant(now: Date, hour: number, minute: number): Date | null {
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ));
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  /* v8 ignore start -- upstream: UTC same-clock next occurrence is never more than 24h away; guard retained for policy symmetry @preserve */
  if (candidate.getTime() - now.getTime() > MAX_FUTURE_MS) {
    return null;
  }
  /* v8 ignore stop @preserve */
  return candidate;
}

function parseMinute(minuteRaw: string | undefined): number {
  if (minuteRaw === undefined) return 0;
  return Number.parseInt(minuteRaw, 10);
}

function parseCodexTryAgain(text: string): TimeParts | null {
  const amPmMatch = new RegExp(String.raw`\btry again at\s+(\d{1,2})(?::(\d{2}))?\s*${AM_PM_PATTERN}\b`, 'iu')
    .exec(text);
  if (amPmMatch !== null) {
    const hour = toHour24(amPmMatch[1] as string, amPmMatch[3]);
    const minute = parseMinute(amPmMatch[2]);
    if (hour === null || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return null;
    }
    return {
      hour,
      minute,
      timezone: 'UTC',
      sourceText: normalizeSourceText(amPmMatch[0]),
      reasonPrefix: 'Codex usage limit reset time',
    };
  }

  const twentyFourHourMatch = /\btry again at\s+([01]?\d|2[0-3]):([0-5]\d)(?:\s*(UTC|GMT))?\b/iu.exec(text);
  if (twentyFourHourMatch === null) {
    return null;
  }

  return {
    hour: Number.parseInt(twentyFourHourMatch[1] as string, 10),
    minute: Number.parseInt(twentyFourHourMatch[2] as string, 10),
    timezone: normalizeTimezone(twentyFourHourMatch[3]) ?? 'UTC',
    sourceText: normalizeSourceText(twentyFourHourMatch[0]),
    reasonPrefix: 'Codex usage limit reset time',
  };
}

function parseExplicitUtcReset(text: string): TimeParts | null {
  const resetMatch = new RegExp(
    String.raw`\bresets?\s+(\d{1,2})(?::(\d{2}))?\s*(?:${AM_PM_PATTERN})?\s*(?:\((UTC|GMT)\)|(UTC|GMT)\b)`,
    'iu',
  ).exec(text);
  if (resetMatch === null) {
    return null;
  }

  const hour = toHour24(resetMatch[1] as string, resetMatch[3]);
  const minute = parseMinute(resetMatch[2]);
  if (hour === null || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute,
    timezone: normalizeTimezone((resetMatch[4] ?? resetMatch[5]) as string) as string,
    sourceText: normalizeSourceText(resetMatch[0]),
    reasonPrefix: 'Usage limit reset time',
  };
}

export function parseCooloffResetTime(input: CooloffResetParseInput): CooloffResetParseResult | null {
  const parsed = parseCodexTryAgain(input.text) ?? parseExplicitUtcReset(input.text);
  if (parsed === null) {
    return null;
  }

  const notBeforeAt = buildNextUtcInstant(input.now, parsed.hour, parsed.minute);
  /* v8 ignore start -- upstream: buildNextUtcInstant only returns null for the retained >24h policy guard @preserve */
  if (notBeforeAt === null) {
    return null;
  }
  /* v8 ignore stop @preserve */

  return {
    notBeforeAt,
    timezone: parsed.timezone,
    sourceText: parsed.sourceText,
    reason: `${parsed.reasonPrefix} parsed as ${notBeforeAt.toISOString()}`,
  };
}
