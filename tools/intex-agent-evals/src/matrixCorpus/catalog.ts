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
  if (turnCount !== 59 || scenarios.some((scenario) => scenario.turns.length > 20)) {
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
    turnCount: 59,
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
          outcome: {
            kind: 'success',
            result: mockResult(scenario.id, required.toolName, ordinal),
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
      return {
        toolName,
        status: 'completed',
        eventId: `mock_event_${suffix}`,
        summary:
          scenarioId === 'intex-eval-008'
            ? 'INTEX-EVAL-008 project review INTEX-EVAL-008-F01'
            : `Synthetic event for ${scenarioId}`,
        attendeesAdded: ['synthetic-attendee@example.com'],
      };
    case 'query_calendar_events':
      if (scenarioId === 'intex-eval-008') {
        return {
          toolName,
          status: 'completed',
          mode: 'list',
          count: 1,
          truncated: false,
          events: [
            {
              eventId: `mock_event_${suffix}`,
              etag: `"mock_event_${suffix}_v1"`,
              summary: 'INTEX-EVAL-008 project review INTEX-EVAL-008-F01',
              start: { dateTime: '2026-07-23T15:00:00+02:00' },
              end: { dateTime: '2026-07-23T16:00:00+02:00' },
              calendarId: 'primary',
            },
          ],
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
