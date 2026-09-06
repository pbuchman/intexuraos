import type { IntexAgentToolNameV1 } from '@intexuraos/http-contracts';

export type SafeToolFactNameV1 =
  | 'contentLength'
  | 'titleLength'
  | 'summaryLength'
  | 'promptLength'
  | 'queryLength'
  | 'originalMessageLength'
  | 'locationLength'
  | 'descriptionLength'
  | 'messageLength'
  | 'textLength'
  | 'tagsCount'
  | 'sourceMessageIdsCount'
  | 'attendeesCount'
  | 'resultCount'
  | 'maxResults'
  | 'expectedVersion'
  | 'currentVersion'
  | 'hasUrl'
  | 'hasSourceUrl'
  | 'hasCalendarId'
  | 'hasExpectedEtag'
  | 'hasEventStart'
  | 'hasEventEnd'
  | 'eventIdMatchesCatalog'
  | 'hasItemId'
  | 'hasLinearIssueId'
  | 'startMatchesCatalog'
  | 'endMatchesCatalog'
  | 'durationMatchesCatalog'
  | 'changesMatchCatalog'
  | 'queryMatchesCatalog'
  | 'timeZoneMatchesCatalog'
  | 'mode'
  | 'workerType'
  | 'taskMode';

export type SafeToolFactValueV1 =
  | number
  | boolean
  | 'list'
  | 'count'
  | 'codex'
  | 'codex-xhigh'
  | 'openrouter-free'
  | 'planning'
  | 'execution';

export interface SafeToolFactV1 {
  name: SafeToolFactNameV1;
  value: SafeToolFactValueV1;
}

export interface MapSafeToolFactsInput {
  toolName: IntexAgentToolNameV1;
  source: 'arguments' | 'result';
  value: unknown;
  catalog?: Readonly<{
    eventId?: string;
    start?: unknown;
    end?: unknown;
    timeZone?: string;
    changes?: unknown;
    query?: string;
  }>;
}

/**
 * Builds a new, closed evidence object. It never copies source fields and therefore has
 * no fallback path capable of exposing an identifier, URL, prompt, argument, or result.
 */
export function mapSafeToolFacts(input: MapSafeToolFactsInput): SafeToolFactV1[] {
  const record = asRecord(input.value);
  if (record === null) return [];
  return input.source === 'arguments'
    ? mapArgumentFacts(input.toolName, record, input.catalog)
    : mapResultFacts(input.toolName, record);
}

function mapArgumentFacts(
  toolName: IntexAgentToolNameV1,
  value: Readonly<Record<string, unknown>>,
  catalog: MapSafeToolFactsInput['catalog']
): SafeToolFactV1[] {
  switch (toolName) {
    case 'create_note':
      return facts(
        lengthFact('contentLength', value['content']),
        lengthFact('titleLength', value['title']),
        arrayCountFact('tagsCount', value['tags']),
        arrayCountFact('sourceMessageIdsCount', value['sourceMessageIds'])
      );
    case 'create_calendar_event':
      return facts(
        lengthFact('summaryLength', value['summary']),
        lengthFact('locationLength', value['location']),
        lengthFact('descriptionLength', value['description']),
        arrayCountFact('attendeesCount', value['attendees']),
        exactMatchFact('startMatchesCatalog', value['start'], stringValue(catalog?.start)),
        exactMatchFact('endMatchesCatalog', value['end'], stringValue(catalog?.end)),
        exactMatchFact('timeZoneMatchesCatalog', value['timeZone'], catalog?.timeZone)
      );
    case 'update_calendar_event': {
      const changes = asRecord(value['changes']);
      const catalogChanges = asRecord(catalog?.changes);
      return facts(
        lengthFact('summaryLength', value['eventSummary']),
        arrayCountFact('attendeesCount', changes?.['attendeesToAdd'] ?? value['attendeesToAdd']),
        presenceFact('hasCalendarId', value['calendarId']),
        presenceFact('hasExpectedEtag', value['expectedEtag']),
        recordPresenceFact('hasEventStart', value['eventStart']),
        recordPresenceFact('hasEventEnd', value['eventEnd']),
        exactMatchFact('eventIdMatchesCatalog', value['eventId'], catalog?.eventId),
        canonicalMatchFact(
          'startMatchesCatalog',
          changes?.['start'],
          catalogChanges?.['start']
        ),
        canonicalMatchFact('endMatchesCatalog', changes?.['end'], catalogChanges?.['end']),
        durationMatchFact(
          changes?.['start'],
          changes?.['end'],
          catalogChanges?.['start'],
          catalogChanges?.['end']
        ),
        canonicalMatchFact('changesMatchCatalog', value['changes'], catalog?.changes)
      );
    }
    case 'query_calendar_events':
      return facts(
        lengthFact('queryLength', value['query']),
        integerFact('maxResults', value['maxResults']),
        presenceFact('hasCalendarId', value['calendarId']),
        exactMatchFact('startMatchesCatalog', value['timeMin'], stringValue(catalog?.start)),
        exactMatchFact('endMatchesCatalog', value['timeMax'], stringValue(catalog?.end)),
        exactMatchFact('queryMatchesCatalog', value['query'], catalog?.query),
        enumFact('mode', value['mode'], ['list', 'count'])
      );
    case 'create_research':
      return facts(
        lengthFact('titleLength', value['title']),
        lengthFact('promptLength', value['prompt']),
        lengthFact('originalMessageLength', value['originalMessage']),
        arrayCountFact('sourceMessageIdsCount', value['sourceMessageIds'])
      );
    case 'create_link':
      return facts(
        lengthFact('titleLength', value['title']),
        lengthFact('descriptionLength', value['description']),
        arrayCountFact('tagsCount', value['tags']),
        arrayCountFact('sourceMessageIdsCount', value['sourceMessageIds']),
        presenceFact('hasUrl', value['url'])
      );
    case 'create_code_task':
      return facts(
        lengthFact('promptLength', value['prompt']),
        presenceFact('hasLinearIssueId', value['linearIssueId']),
        enumFact('workerType', value['workerType'], ['codex', 'codex-xhigh', 'openrouter-free']),
        enumFact('taskMode', value['taskMode'], ['planning', 'execution'])
      );
    case 'save_external':
      return facts(
        lengthFact('messageLength', value['message']),
        presenceFact('hasSourceUrl', value['sourceUrl'])
      );
    case 'get_user_preferences':
      return [];
    case 'add_user_preference':
      return facts(
        lengthFact('textLength', value['text']),
        integerFact('expectedVersion', value['expectedVersion'])
      );
    case 'update_user_preference':
      return facts(
        lengthFact('textLength', value['text']),
        integerFact('expectedVersion', value['expectedVersion']),
        presenceFact('hasItemId', value['itemId'])
      );
    case 'delete_user_preference':
      return facts(
        integerFact('expectedVersion', value['expectedVersion']),
        presenceFact('hasItemId', value['itemId'])
      );
  }
}

function mapResultFacts(
  toolName: IntexAgentToolNameV1,
  value: Readonly<Record<string, unknown>>
): SafeToolFactV1[] {
  switch (toolName) {
    case 'create_note':
    case 'create_research':
    case 'save_external':
      return facts(lengthFact('messageLength', value['message']));
    case 'create_calendar_event':
      return facts(lengthFact('summaryLength', value['summary']));
    case 'update_calendar_event':
      return facts(
        lengthFact('summaryLength', value['summary']),
        arrayCountFact('attendeesCount', value['attendeesAdded'])
      );
    case 'query_calendar_events':
      return facts(
        integerFact('resultCount', value['count']),
        enumFact('mode', value['mode'], ['list', 'count'])
      );
    case 'create_link':
      return facts(
        lengthFact('titleLength', value['title']),
        presenceFact('hasUrl', value['resourceUrl'])
      );
    case 'create_code_task':
      return [];
    case 'get_user_preferences':
      return facts(
        arrayCountFact('resultCount', value['items']),
        integerFact('currentVersion', value['currentVersion'])
      );
    case 'add_user_preference':
    case 'update_user_preference':
    case 'delete_user_preference':
      return facts(integerFact('currentVersion', value['currentVersion']));
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function facts(...items: (SafeToolFactV1 | null)[]): SafeToolFactV1[] {
  return items.filter((item): item is SafeToolFactV1 => item !== null).slice(0, 16);
}

function lengthFact(name: SafeToolFactNameV1, value: unknown): SafeToolFactV1 | null {
  return typeof value === 'string' ? { name, value: Array.from(value).length } : null;
}

function arrayCountFact(name: SafeToolFactNameV1, value: unknown): SafeToolFactV1 | null {
  return Array.isArray(value) ? { name, value: value.length } : null;
}

function integerFact(name: SafeToolFactNameV1, value: unknown): SafeToolFactV1 | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? { name, value }
    : null;
}

function presenceFact(name: SafeToolFactNameV1, value: unknown): SafeToolFactV1 | null {
  return typeof value === 'string' ? { name, value: value.length > 0 } : null;
}

function recordPresenceFact(name: SafeToolFactNameV1, value: unknown): SafeToolFactV1 | null {
  if (value === undefined) return null;
  return { name, value: asRecord(value) !== null };
}

function exactMatchFact(
  name: SafeToolFactNameV1,
  value: unknown,
  expected: string | undefined
): SafeToolFactV1 | null {
  return typeof value === 'string' && expected !== undefined
    ? { name, value: value === expected }
    : null;
}

function canonicalMatchFact(
  name: SafeToolFactNameV1,
  value: unknown,
  expected: unknown
): SafeToolFactV1 | null {
  if (expected === undefined) return null;
  const actualCanonical = canonicalJson(value);
  const expectedCanonical = canonicalJson(expected);
  return {
    name,
    value:
      actualCanonical !== null &&
      expectedCanonical !== null &&
      actualCanonical === expectedCanonical,
  };
}

function durationMatchFact(
  start: unknown,
  end: unknown,
  expectedStart: unknown,
  expectedEnd: unknown
): SafeToolFactV1 | null {
  if (expectedStart === undefined || expectedEnd === undefined) return null;
  const actualDuration = calendarDurationMs(start, end);
  const expectedDuration = calendarDurationMs(expectedStart, expectedEnd);
  return {
    name: 'durationMatchesCatalog',
    value:
      actualDuration !== null &&
      expectedDuration !== null &&
      actualDuration === expectedDuration,
  };
}

function calendarDurationMs(start: unknown, end: unknown): number | null {
  const startInstant = calendarInstant(start);
  const endInstant = calendarInstant(end);
  if (
    startInstant === null ||
    endInstant?.kind !== startInstant.kind ||
    endInstant.ms <= startInstant.ms
  )
    return null;
  return endInstant.ms - startInstant.ms;
}

function calendarInstant(value: unknown): Readonly<{ kind: 'date' | 'dateTime'; ms: number }> | null {
  const record = asRecord(value);
  if (record === null) return null;
  const date = record['date'];
  const dateTime = record['dateTime'];
  if ((typeof date === 'string') === (typeof dateTime === 'string')) return null;
  const kind = typeof date === 'string' ? 'date' : 'dateTime';
  const raw = typeof date === 'string' ? `${date}T00:00:00.000Z` : String(dateTime);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? { kind, ms } : null;
}

function canonicalJson(value: unknown): string | null {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    const items = value.map(canonicalJson);
    return items.some((item) => item === null) ? null : `[${items.join(',')}]`;
  }
  const record = asRecord(value);
  if (record === null) return null;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const nested = canonicalJson(record[key]);
    if (nested === null) return null;
    entries.push(`${JSON.stringify(key)}:${nested}`);
  }
  return `{${entries.join(',')}}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function enumFact(
  name: SafeToolFactNameV1,
  value: unknown,
  allowed: readonly SafeToolFactValueV1[]
): SafeToolFactV1 | null {
  return allowed.includes(value as SafeToolFactValueV1)
    ? { name, value: value as SafeToolFactValueV1 }
    : null;
}
