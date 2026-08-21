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
  | 'hasItemId'
  | 'hasLinearIssueId'
  | 'startMatchesCatalog'
  | 'endMatchesCatalog'
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
    start?: string;
    end?: string;
    timeZone?: string;
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
        exactMatchFact('startMatchesCatalog', value['start'], catalog?.start),
        exactMatchFact('endMatchesCatalog', value['end'], catalog?.end),
        exactMatchFact('timeZoneMatchesCatalog', value['timeZone'], catalog?.timeZone)
      );
    case 'update_calendar_event':
      return facts(
        lengthFact('summaryLength', value['eventSummary']),
        arrayCountFact('attendeesCount', value['attendeesToAdd']),
        presenceFact('hasCalendarId', value['calendarId']),
        presenceFact('hasExpectedEtag', value['expectedEtag']),
        recordPresenceFact('hasEventStart', value['eventStart']),
        recordPresenceFact('hasEventEnd', value['eventEnd'])
      );
    case 'query_calendar_events':
      return facts(
        lengthFact('queryLength', value['query']),
        integerFact('maxResults', value['maxResults']),
        presenceFact('hasCalendarId', value['calendarId']),
        exactMatchFact('startMatchesCatalog', value['timeMin'], catalog?.start),
        exactMatchFact('endMatchesCatalog', value['timeMax'], catalog?.end),
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

function enumFact(
  name: SafeToolFactNameV1,
  value: unknown,
  allowed: readonly SafeToolFactValueV1[]
): SafeToolFactV1 | null {
  return allowed.includes(value as SafeToolFactValueV1)
    ? { name, value: value as SafeToolFactValueV1 }
    : null;
}
