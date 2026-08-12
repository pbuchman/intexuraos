import type { IntexAgentReplyLanguage } from './capabilities.js';

export type CalendarEventDraftFieldStatus =
  | 'user_confirmed'
  | 'proposed_default'
  | 'runtime_default'
  | 'missing'
  | 'ambiguous';

export type CalendarEventDraftFieldSource =
  | 'user_message'
  | 'safe_default'
  | 'runtime'
  | 'none';

export interface CalendarEventDraftField {
  value?: string;
  status: CalendarEventDraftFieldStatus;
  source: CalendarEventDraftFieldSource;
}

export interface CalendarEventDraftV1 {
  version: 1;
  toolArgs: Record<string, unknown>;
  fields: Readonly<{
    summary: CalendarEventDraftField;
    start: CalendarEventDraftField;
    end: CalendarEventDraftField;
    timeZone: CalendarEventDraftField;
  }>;
  omittedFields: readonly string[];
}

export type CalendarEventReadinessResult =
  | Readonly<{ status: 'ready'; toolArgs: Record<string, unknown> }>
  | Readonly<{
      status: 'needs_clarification';
      reply: string;
      missingFields: string[];
      draft?: CalendarEventDraftV1;
    }>;

interface CalendarEventReadinessInput {
  toolArgs: Record<string, unknown>;
  evidenceTexts: readonly string[];
  hasExplicitStart: boolean;
  hasExplicitEnd: boolean;
  runtimeTimeZone: string;
  replyLanguage: IntexAgentReplyLanguage;
}

interface ResolvedCalendarTimeZone {
  value: string | null;
  status: Extract<CalendarEventDraftFieldStatus, 'user_confirmed' | 'runtime_default' | 'missing'>;
}

const CALENDAR_META_SUMMARY_PATTERN =
  /(?:przeanalizowałem|przeanalizowalem|przygotowałem\s+propozycję|przygotowalem\s+propozycje|brakuje\s+informacji|potrzebuję\s+(?:krótkiego\s+)?doprecyzowania|potrzebuje\s+(?:krotkiego\s+)?doprecyzowania|zanim\s+dodam|i\s+analy[sz]ed|i\s+prepared\s+(?:a\s+)?proposal|information\s+is\s+missing|need\s+(?:a\s+)?clarification|before\s+i\s+(?:add|create))/iu;

const GENERIC_SUMMARIES = new Set([
  'this',
  'that',
  'it',
  'event',
  'calendar event',
  'meeting',
  'wydarzenie',
  'spotkanie',
  'to',
]);

const SUMMARY_STOP_WORDS = new Set([
  'and',
  'dla',
  'for',
  'oraz',
  'the',
  'with',
]);

export function assessCalendarEventReadiness(
  input: CalendarEventReadinessInput
): CalendarEventReadinessResult {
  const normalizedArgs = normalizeOptionalCalendarArgs(input.toolArgs, input.evidenceTexts);
  const summary = resolveGroundedCalendarSummary(normalizedArgs['summary'], input.evidenceTexts);
  const start = stringValue(normalizedArgs['start']);
  const end = stringValue(normalizedArgs['end']);
  const timeZoneResolution = resolveCalendarTimeZone(
    normalizedArgs['timeZone'],
    input.runtimeTimeZone,
    input.evidenceTexts
  );
  const timeZone = timeZoneResolution.value;
  const omittedFields = resolveOmittedFields(normalizedArgs);

  if (summary === null) {
    const draft = buildDraft({
      normalizedArgs,
      start,
      end,
      timeZone,
      omittedFields,
      summary: null,
      summaryStatus: 'missing',
      startStatus: input.hasExplicitStart ? 'user_confirmed' : 'missing',
      endStatus: input.hasExplicitEnd ? 'user_confirmed' : 'missing',
      timeZoneStatus: timeZoneResolution.status,
    });
    return {
      status: 'needs_clarification',
      reply:
        input.replyLanguage === 'pl'
          ? 'Jak ma brzmieć krótki tytuł tego wydarzenia?'
          : 'What short title should I use for this event?',
      missingFields: ['summary'],
      draft,
    };
  }

  if (!input.hasExplicitStart || start === null) {
    const draft = buildDraft({
      normalizedArgs,
      start: null,
      end: null,
      timeZone,
      omittedFields,
      summary,
      summaryStatus: 'user_confirmed',
      startStatus: 'missing',
      endStatus: 'missing',
      timeZoneStatus: timeZoneResolution.status,
    });
    return {
      status: 'needs_clarification',
      reply:
        input.replyLanguage === 'pl'
          ? `O której ma się rozpocząć wydarzenie „${summary}”? Gdy podasz początek, mogę zaproponować bezpieczny czas trwania.`
          : `What time should “${summary}” start? Once I know the start, I can propose a safe duration.`,
      missingFields: ['start'],
      draft,
    };
  }

  if (!input.hasExplicitEnd) {
    const proposedEnd = addMinutesPreservingOffset(start, 60);
    if (proposedEnd === null) {
      return {
        status: 'needs_clarification',
        reply:
          input.replyLanguage === 'pl'
            ? `Do której ma trwać wydarzenie „${summary}”?`
            : `When should “${summary}” end?`,
        missingFields: ['end'],
      };
    }
    const draftArgs: Record<string, unknown> = {
      ...normalizedArgs,
      summary,
      start,
      end: proposedEnd,
      ...(timeZone === null ? {} : { timeZone }),
    };
    const draft = buildDraft({
      normalizedArgs: draftArgs,
      start,
      end: proposedEnd,
      timeZone,
      omittedFields,
      summary,
      summaryStatus: 'user_confirmed',
      startStatus: 'user_confirmed',
      endStatus: 'proposed_default',
      timeZoneStatus: timeZoneResolution.status,
    });
    return {
      status: 'needs_clarification',
      reply: buildDefaultDurationQuestion(summary, start, proposedEnd, omittedFields, input.replyLanguage),
      missingFields: ['end'],
      draft,
    };
  }

  if (end === null) {
    return {
      status: 'needs_clarification',
      reply:
        input.replyLanguage === 'pl'
          ? `Do której ma trwać wydarzenie „${summary}”?`
          : `When should “${summary}” end?`,
      missingFields: ['end'],
    };
  }

  return {
    status: 'ready',
    toolArgs: {
      ...normalizedArgs,
      summary,
      start,
      end,
      ...(timeZone === null ? {} : { timeZone }),
    },
  };
}

export function isCalendarDraftAcceptance(message: string): boolean {
  return /^(?:tak|yes|yep|ok(?:ay)?|pasuje|zgoda|może\s+być|moze\s+byc|przyjmij|accept|works(?:\s+for\s+me)?|sounds\s+good)[.!]?$/iu.test(
    message.normalize('NFKC').trim()
  );
}

export function parseAcceptedCalendarEventDraft(value: unknown): CalendarEventDraftV1 | null {
  if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['toolArgs'])) return null;
  if (!isRecord(value['fields']) || !Array.isArray(value['omittedFields'])) return null;
  const summary = stringValue(value['toolArgs']['summary']);
  const start = stringValue(value['toolArgs']['start']);
  const end = stringValue(value['toolArgs']['end']);
  if (summary === null || start === null || end === null) return null;

  const fields = value['fields'];
  const parsedSummary = parseDraftField(fields['summary']);
  const parsedStart = parseDraftField(fields['start']);
  const parsedEnd = parseDraftField(fields['end']);
  const parsedTimeZone = parseDraftField(fields['timeZone']);
  const toolTimeZone = stringValue(value['toolArgs']['timeZone']);
  if (
    parsedSummary === null ||
    parsedStart === null ||
    parsedEnd === null ||
    parsedTimeZone === null ||
    parsedSummary.status !== 'user_confirmed' ||
    parsedSummary.source !== 'user_message' ||
    parsedSummary.value !== summary ||
    parsedStart.status !== 'user_confirmed' ||
    parsedStart.source !== 'user_message' ||
    parsedStart.value !== start ||
    parsedEnd.status !== 'proposed_default' ||
    parsedEnd.source !== 'safe_default' ||
    parsedEnd.value !== end ||
    !isMatchingDraftTimeZone(parsedTimeZone, toolTimeZone) ||
    value['omittedFields'].some((field) => typeof field !== 'string')
  ) {
    return null;
  }
  const omittedFields = value['omittedFields'] as string[];

  return {
    version: 1,
    toolArgs: { ...value['toolArgs'] },
    fields: {
      summary: parsedSummary,
      start: parsedStart,
      end: parsedEnd,
      timeZone: parsedTimeZone,
    },
    omittedFields,
  };
}

function normalizeOptionalCalendarArgs(
  toolArgs: Record<string, unknown>,
  evidenceTexts: readonly string[]
): Record<string, unknown> {
  const {
    location: suppliedLocation,
    description: suppliedDescription,
    attendees: suppliedAttendees,
    ...normalized
  } = toolArgs;
  const evidence = evidenceTexts.join('\n').normalize('NFKC').toLocaleLowerCase('en-US');
  const location = stringValue(suppliedLocation);
  if (
    location !== null &&
    evidence.includes(location.normalize('NFKC').toLocaleLowerCase('en-US'))
  ) {
    normalized['location'] = location;
  }
  const description = stringValue(suppliedDescription);
  if (
    description !== null &&
    evidence.includes(description.normalize('NFKC').toLocaleLowerCase('en-US'))
  ) {
    normalized['description'] = description;
  }
  if (Array.isArray(suppliedAttendees)) {
    const grounded = suppliedAttendees.filter(
      (attendee): attendee is string =>
        typeof attendee === 'string' &&
        attendee.trim() !== '' &&
        evidence.includes(attendee.normalize('NFKC').toLocaleLowerCase('en-US'))
    );
    if (grounded.length > 0) normalized['attendees'] = grounded;
  }
  return normalized;
}

function resolveGroundedCalendarSummary(
  rawSummary: unknown,
  evidenceTexts: readonly string[]
): string | null {
  const summary = stringValue(rawSummary);
  if (summary !== null && isConciseSummary(summary) && isSummaryGrounded(summary, evidenceTexts)) {
    return summary;
  }

  for (const evidence of evidenceTexts) {
    const extracted = extractCalendarSummary(evidence);
    if (extracted !== null) return extracted;
  }

  if (summary !== null) {
    const polishTournament =
      /\bszczegół[yó]\s+turnieju\s+(.+?)\s+i\s+przygotowa/iu.exec(summary.normalize('NFKC'))?.[1];
    if (polishTournament !== undefined) {
      const candidate = `Turniej ${polishTournament.trim()}`;
      if (isConciseSummary(candidate) && isSummaryGrounded(candidate, evidenceTexts)) return candidate;
    }
  }
  return null;
}

function extractCalendarSummary(text: string): string | null {
  const normalized = text.normalize('NFKC').trim();
  const withoutAction = normalized.replace(
    /^(?:please\s+)?(?:add|schedule|create|put|dodaj|zaplanuj|utwórz|utworz)\s+/iu,
    ''
  );
  const candidate = withoutAction
    .replace(/^(?:(?:a|an|the)\s+)?(?:calendar\s+)?event(?:\s+(?:for|called))?\s*/iu, '')
    .replace(/^(?:wydarzenie\s+(?:w\s+kalendarzu|kalendarzowe))\s*:?\s*/iu, '')
    .split(
      /(?=\s+(?:on\s+\d{4}-\d{2}-\d{2}|on\s+the\s+\d|next\s+|tomorrow\b|today\b|jutro\b|dzisiaj\b|dziś\b|at\s+(?:\d|noon|midnight)|for\s+(?:one|two|three|\d)|\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|wrzesnia|października|pazdziernika|listopada|grudnia)|o\s+\d{1,2}(?::\d{2})?|do\s+(?:mojego\s+)?kalendarza|to\s+my\s+calendar))/iu
    )[0]
    ?.replace(/[,:;.!?]+$/u, '')
    .trim();
  if (candidate === undefined || !isConciseSummary(candidate)) return null;
  return candidate;
}

function isConciseSummary(summary: string): boolean {
  const normalized = summary.trim().replace(/\s+/gu, ' ');
  return (
    normalized.length >= 2 &&
    normalized.length <= 160 &&
    !CALENDAR_META_SUMMARY_PATTERN.test(normalized) &&
    !GENERIC_SUMMARIES.has(normalized.toLocaleLowerCase('en-US'))
  );
}

function isSummaryGrounded(summary: string, evidenceTexts: readonly string[]): boolean {
  const evidenceTokens = new Set(tokenize(evidenceTexts.join(' ')));
  const summaryTokens = tokenize(summary).filter((token) => !SUMMARY_STOP_WORDS.has(token));
  return summaryTokens.length > 0 && summaryTokens.every(
    (token) =>
      evidenceTokens.has(token) ||
      [...evidenceTokens].some(
        (evidenceToken) =>
          token.length >= 4 &&
          evidenceToken.length >= 4 &&
          token.slice(0, 4) === evidenceToken.slice(0, 4)
      )
  );
}

function tokenize(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}+]{3,}/gu) ?? [];
}

function buildDraft(input: Readonly<{
  normalizedArgs: Record<string, unknown>;
  summary: string | null;
  start: string | null;
  end: string | null;
  timeZone: string | null;
  omittedFields: string[];
  summaryStatus: CalendarEventDraftFieldStatus;
  startStatus: CalendarEventDraftFieldStatus;
  endStatus: CalendarEventDraftFieldStatus;
  timeZoneStatus: Extract<
    CalendarEventDraftFieldStatus,
    'user_confirmed' | 'runtime_default' | 'missing'
  >;
}>): CalendarEventDraftV1 {
  const toolArgs = { ...input.normalizedArgs };
  if (input.summary === null) delete toolArgs['summary'];
  else toolArgs['summary'] = input.summary;
  if (input.start === null) delete toolArgs['start'];
  else toolArgs['start'] = input.start;
  if (input.end === null) delete toolArgs['end'];
  else toolArgs['end'] = input.end;
  if (input.timeZone === null) delete toolArgs['timeZone'];
  else toolArgs['timeZone'] = input.timeZone;

  return {
    version: 1,
    toolArgs,
    fields: {
      summary: draftField(input.summary, input.summaryStatus),
      start: draftField(input.start, input.startStatus),
      end: draftField(input.end, input.endStatus),
      timeZone: draftField(input.timeZone, input.timeZoneStatus),
    },
    omittedFields: input.omittedFields,
  };
}

function draftField(
  value: string | null,
  status: CalendarEventDraftFieldStatus
): CalendarEventDraftField {
  const source: CalendarEventDraftFieldSource =
    status === 'proposed_default'
      ? 'safe_default'
      : status === 'runtime_default'
        ? 'runtime'
        : status === 'user_confirmed'
          ? 'user_message'
          : 'none';
  return {
    ...(value === null ? {} : { value }),
    status,
    source,
  };
}

function parseDraftField(value: unknown): CalendarEventDraftField | null {
  if (!isRecord(value)) return null;
  const status = value['status'];
  const source = value['source'];
  const fieldValue = value['value'];
  if (
    !isFieldStatus(status) ||
    !isFieldSource(source) ||
    (fieldValue !== undefined && typeof fieldValue !== 'string')
  ) {
    return null;
  }
  return {
    ...(typeof fieldValue === 'string' ? { value: fieldValue } : {}),
    status,
    source,
  };
}

function isFieldStatus(value: unknown): value is CalendarEventDraftFieldStatus {
  return (
    value === 'user_confirmed' ||
    value === 'proposed_default' ||
    value === 'runtime_default' ||
    value === 'missing' ||
    value === 'ambiguous'
  );
}

function isFieldSource(value: unknown): value is CalendarEventDraftFieldSource {
  return (
    value === 'user_message' ||
    value === 'safe_default' ||
    value === 'runtime' ||
    value === 'none'
  );
}

function resolveCalendarTimeZone(
  rawTimeZone: unknown,
  runtimeTimeZone: string,
  evidenceTexts: readonly string[]
): ResolvedCalendarTimeZone {
  const runtime = runtimeTimeZone.trim();
  const supplied = stringValue(rawTimeZone);
  if (
    supplied !== null &&
    evidenceTexts
      .join('\n')
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .includes(supplied.normalize('NFKC').toLocaleLowerCase('en-US'))
  ) {
    return { value: supplied, status: 'user_confirmed' };
  }
  return runtime !== ''
    ? { value: runtime, status: 'runtime_default' }
    : { value: null, status: 'missing' };
}

function isMatchingDraftTimeZone(
  field: CalendarEventDraftField,
  toolTimeZone: string | null
): boolean {
  if (toolTimeZone === null) {
    return field.value === undefined && field.status === 'missing' && field.source === 'none';
  }
  return (
    field.value === toolTimeZone &&
    ((field.status === 'user_confirmed' && field.source === 'user_message') ||
      (field.status === 'runtime_default' && field.source === 'runtime'))
  );
}

function resolveOmittedFields(args: Record<string, unknown>): string[] {
  return ['location', 'description', 'attendees'].filter((field) => args[field] === undefined);
}

function buildDefaultDurationQuestion(
  summary: string,
  start: string,
  end: string,
  omittedFields: readonly string[],
  language: IntexAgentReplyLanguage
): string {
  const startLabel = formatDraftDateTime(start, language);
  const endTime = extractClock(end);
  const locationSentence = omittedFields.includes('location')
    ? language === 'pl'
      ? ' Lokalizację mogę pominąć.'
      : ' I can omit the location.'
    : '';
  return language === 'pl'
    ? `Widzę: „${summary}”, ${startLabel}.${locationSentence} Nie znam czasu zakończenia — mogę przyjąć 60 minut, czyli do ${endTime}. Pasuje?`
    : `I have “${summary}”, ${startLabel}.${locationSentence} I do not know the end time — I can assume 60 minutes, until ${endTime}. Does that work?`;
}

function formatDraftDateTime(value: string, language: IntexAgentReplyLanguage): string {
  const year = value.slice(0, 4);
  const month = value.slice(5, 7);
  const day = value.slice(8, 10);
  const hour = value.slice(11, 13);
  const minute = value.slice(14, 16);
  return language === 'pl'
    ? `${day}.${month}.${year}, start ${hour}:${minute}`
    : `${year}-${month}-${day} at ${hour}:${minute}`;
}

function extractClock(value: string): string {
  return value.slice(11, 16);
}

function addMinutesPreservingOffset(value: string, minutes: number): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/u.exec(
      value
    );
  if (match === null) return null;
  const [, year, month, day, hour, minute, second = '00', suffix] = match;
  const base = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const shifted = new Date(base + minutes * 60_000).toISOString().slice(0, 19);
  return `${shifted}${suffix ?? ''}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
