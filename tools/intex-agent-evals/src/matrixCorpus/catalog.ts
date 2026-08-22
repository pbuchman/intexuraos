import { createHash } from 'node:crypto';
import {
  MATRIX_CORPUS_DEFAULT_AGENT_MODEL,
  MATRIX_CORPUS_EVALUATOR_MODEL,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  matrixCorpusExpectedToolScheduleV1Schema,
  strictToolMockProfileV1Schema,
  type IntexAgentToolNameV1,
  type MatrixCorpusAgentModel,
  type StrictMockResultV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { loadScenarioCatalog } from '../scenarioCatalog.js';
import type { IntexEvalScenario } from '../scenarioSchema.js';
import type { CanonicalMatrixCorpus, CanonicalMatrixCorpusScenario } from './types.js';

export const MATRIX_CORPUS_AGENT_MODEL = MATRIX_CORPUS_DEFAULT_AGENT_MODEL;
export const MATRIX_CORPUS_JUDGE_MODEL = MATRIX_CORPUS_EVALUATOR_MODEL;

const EXPECTED_IDS = Array.from(
  { length: 20 },
  (_, index) => `intex-eval-${String(index + 1).padStart(3, '0')}`
);

export async function loadCanonicalMatrixCorpus(
  scenariosDirectory: string,
  agentModel: MatrixCorpusAgentModel = MATRIX_CORPUS_AGENT_MODEL
): Promise<CanonicalMatrixCorpus> {
  const scenarios = await loadScenarioCatalog(scenariosDirectory);
  const observedIds = scenarios.map(({ id }) => id);
  if (JSON.stringify(observedIds) !== JSON.stringify(EXPECTED_IDS)) {
    throw new Error('matrix_corpus_catalog_identity_mismatch');
  }
  const turnCount = scenarios.reduce((total, scenario) => total + scenario.turns.length, 0);
  if (turnCount !== 60 || scenarios.some((scenario) => scenario.turns.length > 20)) {
    throw new Error('matrix_corpus_catalog_cardinality_mismatch');
  }
  if (scenarios.some((scenario) => scenario.title.length > 128)) {
    throw new Error('matrix_corpus_catalog_label_too_large');
  }

  const entries = scenarios.map((scenario, index) => buildEntry(scenario, index + 1));
  const catalogDigest = sha256(
    canonicalize({
      version: 1,
      agentModel,
      evaluatorModel: MATRIX_CORPUS_JUDGE_MODEL,
      scenarios: entries.map((entry) => ({
        scenarioNumber: entry.scenarioNumber,
        scenarioDigest: entry.scenarioDigest,
        mockProfileDigest: entry.mockProfileDigest,
      })),
    })
  );

  return Object.freeze({
    agentModel,
    evaluatorModel: MATRIX_CORPUS_JUDGE_MODEL,
    scenarioCount: 20,
    turnCount: 60,
    catalogDigest,
    scenarios: Object.freeze(entries),
  });
}

function buildEntry(
  scenario: IntexEvalScenario,
  scenarioNumber: number
): CanonicalMatrixCorpusScenario {
  const mockProfile = buildMockProfile(scenario);
  const expectedToolSchedule = matrixCorpusExpectedToolScheduleV1Schema.parse(
    mockProfile.calls.map(({ turnIndex, toolName, ordinal }) => ({
      turnIndex,
      toolName,
      ordinal,
    }))
  );
  return Object.freeze({
    scenario,
    scenarioNumber,
    scenarioLabel: scenario.title,
    scenarioDigest: sha256(canonicalize(scenario)),
    mockProfile,
    mockProfileDigest: sha256(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile)),
    expectedToolSchedule,
  });
}

function buildMockProfile(scenario: IntexEvalScenario): StrictToolMockProfileV1 {
  const calls: StrictToolMockProfileV1['calls'] = [];
  const forbiddenSelections: StrictToolMockProfileV1['forbiddenSelections'] = [];

  for (const expectation of scenario.expected.turns) {
    for (const required of expectation.requiredToolCalls) {
      for (let ordinal = 1; ordinal <= required.count; ordinal += 1) {
        calls.push({
          turnIndex: expectation.turnIndex,
          toolName: required.toolName,
          ordinal,
          ...(scenario.id === 'intex-eval-008' && required.toolName === 'query_calendar_events'
            ? { argumentCatalog: scenario008QueryArgumentCatalog(expectation.turnIndex) }
            : {}),
          outcome: {
            kind: 'success',
            result: mockResult(scenario.id, expectation.turnIndex, required.toolName, ordinal),
          },
        });
      }
    }
    for (const toolName of expectation.forbiddenToolCalls) {
      forbiddenSelections.push({ turnIndex: expectation.turnIndex, toolName });
    }
  }

  return strictToolMockProfileV1Schema.parse({
    version: 1,
    calls,
    forbiddenSelections,
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  });
}

function mockResult(
  scenarioId: string,
  turnIndex: number,
  toolName: IntexAgentToolNameV1,
  ordinal: number
): StrictMockResultV1 {
  const suffix = `${scenarioId.replaceAll('-', '_')}_${String(ordinal)}`;
  switch (toolName) {
    case 'create_note':
      return { toolName, status: 'completed', message: `Saved synthetic note for ${scenarioId}.` };
    case 'create_calendar_event':
      return {
        toolName,
        status: 'completed',
        eventId: `mock_event_${suffix}`,
        summary: `Synthetic event for ${scenarioId}`,
      };
    case 'update_calendar_event':
      if (scenarioId === 'intex-eval-008') {
        const event = scenario008CalendarEvents()[ordinal - 1];
        if (event === undefined) throw new Error('matrix_corpus_scenario_008_update_ordinal');
        return {
          toolName,
          status: 'completed',
          eventId: event.eventId,
          summary: event.summary,
          changes: scenario008CalendarUpdateChanges(ordinal),
        };
      }
      return {
        toolName,
        status: 'completed',
        eventId: `mock_event_${suffix}`,
        summary: `Synthetic event for ${scenarioId}`,
        attendeesAdded: ['synthetic-attendee@example.com'],
      };
    case 'query_calendar_events':
      if (scenarioId === 'intex-eval-008') {
        const events =
          turnIndex === 0 ? scenario008WeeklyCalendarEvents() : scenario008CalendarEvents();
        return {
          toolName,
          status: 'completed',
          mode: 'list',
          count: events.length,
          truncated: false,
          events,
        };
      }
      return { toolName, status: 'completed', mode: 'list', count: 0, events: [] };
    case 'create_research':
      return {
        toolName,
        status: 'completed',
        message: `Started synthetic research for ${scenarioId}.`,
      };
    case 'create_link':
      return {
        toolName,
        status: 'completed',
        bookmarkId: `mock_bookmark_${suffix}`,
        resourceUrl: `https://mock.invalid/bookmark/${suffix}`,
        title: `Synthetic bookmark for ${scenarioId}`,
      };
    case 'create_code_task':
      return { toolName, status: 'completed', codeTaskId: `mock_code_task_${suffix}` };
    case 'save_external':
      return { toolName, status: 'completed', message: `Saved synthetic item for ${scenarioId}.` };
    case 'get_user_preferences':
      return { toolName, status: 'completed', currentVersion: 0, items: [] };
    case 'add_user_preference':
      return {
        toolName,
        status: 'completed',
        currentVersion: 1,
        changedItemId: `mock_pref_${suffix}`,
      };
    case 'update_user_preference':
      return {
        toolName,
        status: 'completed',
        currentVersion: 1,
        changedItemId: `mock_pref_${suffix}`,
      };
    case 'delete_user_preference':
      return {
        toolName,
        status: 'completed',
        currentVersion: 1,
        changedItemId: `mock_pref_${suffix}`,
      };
  }
}

type CalendarListMockResult = Extract<
  StrictMockResultV1,
  { toolName: 'query_calendar_events'; mode: 'list' }
>;

function scenario008CalendarEvents(): CalendarListMockResult['events'] {
  return [
    { day: 13, title: 'Google Photos od 04.2019' },
    { day: 14, title: 'Wyczyścić Photos 2018' },
    { day: 15, title: 'Wyczyścić Photos 2017' },
    { day: 16, title: 'Wyczyścić Photos 2016' },
  ].map(({ day, title }, index) => {
    const ordinal = index + 1;
    const eventId = `mock_event_INTEX-EVAL-008_INTEX-EVAL-008-F01_photos_${String(ordinal)}`;
    return {
      eventId,
      etag: `"${eventId}_v1"`,
      summary: title,
      description: 'Synthetic fixture INTEX-EVAL-008 INTEX-EVAL-008-F01',
      start: { date: `2026-08-${String(day).padStart(2, '0')}` },
      end: { date: `2026-08-${String(day + 1).padStart(2, '0')}` },
      calendarId: 'primary',
    };
  });
}

function scenario008WeeklyCalendarEvents(): CalendarListMockResult['events'] {
  const markers = 'INTEX-EVAL-008 INTEX-EVAL-008-F01';
  return [
    {
      eventId: 'mock_event_intex_eval_008_physio',
      etag: '"mock_event_intex_eval_008_physio_v1"',
      summary: 'Synthetic Fizjoterapia myśliwska',
      description: `Synthetic fixture ${markers}`,
      start: { dateTime: '2026-08-10T19:00:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-10T21:00:00+02:00', timeZone: 'Europe/Warsaw' },
      calendarId: 'primary',
    },
    {
      eventId: 'mock_event_intex_eval_008_haircut_1',
      etag: '"mock_event_intex_eval_008_haircut_1_v1"',
      summary: 'Synthetic Pracownia fryzur Pan & Pani',
      description: `Synthetic fixture ${markers}`,
      start: { dateTime: '2026-08-11T17:30:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-11T18:00:00+02:00', timeZone: 'Europe/Warsaw' },
      calendarId: 'primary',
    },
    {
      eventId: 'mock_event_intex_eval_008_haircut_2',
      etag: '"mock_event_intex_eval_008_haircut_2_v1"',
      summary: 'Synthetic Strzyżenie męskie',
      description: `Synthetic fixture ${markers}`,
      start: { dateTime: '2026-08-11T17:30:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-11T18:00:00+02:00', timeZone: 'Europe/Warsaw' },
      location: 'Przemiarki 23/7, Kraków',
      calendarId: 'primary',
    },
    {
      eventId: 'mock_event_intex_eval_008_squash',
      etag: '"mock_event_intex_eval_008_squash_v1"',
      summary: 'Synthetic Playmore Squash',
      description: `Synthetic fixture ${markers}`,
      start: { dateTime: '2026-08-11T19:00:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-11T21:00:00+02:00', timeZone: 'Europe/Warsaw' },
      location: 'Paolo Squash Club, Księcia Józefa 54a',
      calendarId: 'primary',
    },
    ...scenario008CalendarEvents().slice(0, 2),
    {
      eventId: 'mock_event_intex_eval_008_tournament',
      etag: '"mock_event_intex_eval_008_tournament_v1"',
      summary: 'Synthetic turniej OPEN B++ Tarnów',
      description: `Synthetic fixture ${markers}`,
      start: { dateTime: '2026-08-14T18:00:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-14T21:00:00+02:00', timeZone: 'Europe/Warsaw' },
      calendarId: 'primary',
    },
    ...scenario008CalendarEvents().slice(2),
  ];
}

function scenario008CalendarUpdateChanges(ordinal: number): {
  start: { date: string };
  end: { date: string };
} {
  const day = 21 + ordinal;
  return {
    start: { date: `2026-08-${String(day).padStart(2, '0')}` },
    end: { date: `2026-08-${String(day + 1).padStart(2, '0')}` },
  };
}

function scenario008QueryArgumentCatalog(turnIndex: number): {
  toolName: 'query_calendar_events';
  timeMin: string;
  timeMax: string;
  query: string;
} {
  return turnIndex === 0
    ? {
        toolName: 'query_calendar_events',
        timeMin: '2026-08-10T00:00:00+02:00',
        timeMax: '2026-08-17T00:00:00+02:00',
        query: 'INTEX-EVAL-008 INTEX-EVAL-008-F01',
      }
    : {
        toolName: 'query_calendar_events',
        timeMin: '2026-08-13T00:00:00+02:00',
        timeMax: '2026-08-17T00:00:00+02:00',
        query: 'Photos INTEX-EVAL-008 INTEX-EVAL-008-F01',
      };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('matrix_corpus_catalog_non_json_value');
}
