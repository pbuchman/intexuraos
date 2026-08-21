import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadScenarioCatalog } from '../scenarioCatalog.js';
import type { IntexEvalScenario, TurnExpectation } from '../scenarioSchema.js';
import { INTEX_AGENT_TOOL_NAMES, type IntexAgentToolName } from '../types.js';

const trackedScenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

const EXPECTED_SCENARIO_IDS = [
  'intex-eval-001',
  'intex-eval-002',
  'intex-eval-003',
  'intex-eval-004',
  'intex-eval-005',
  'intex-eval-006',
  'intex-eval-007',
  'intex-eval-008',
  'intex-eval-009',
  'intex-eval-010',
  'intex-eval-011',
  'intex-eval-012',
  'intex-eval-013',
  'intex-eval-014',
  'intex-eval-015',
  'intex-eval-016',
  'intex-eval-017',
  'intex-eval-018',
  'intex-eval-019',
  'intex-eval-020',
] as const;

const MUTATING_TOOL_NAMES = new Set<IntexAgentToolName>([
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

interface MarkerEvidenceCase {
  readonly scenarioId: string;
  readonly requestTurnIndex: number;
  readonly executionTurnIndex: number;
  readonly markers: readonly string[];
  readonly sourceTurnIndexes: readonly number[];
}

const SCENARIO_020_MARKERS = [
  'INTEX-EVAL-020',
  ...Array.from(
    { length: 18 },
    (_, index) => `INTEX-EVAL-020-F${String(index + 1).padStart(2, '0')}`
  ),
] as const;

const MARKER_EVIDENCE_CASES = [
  markerCase('intex-eval-001', 0, 1, ['INTEX-EVAL-001', 'INTEX-EVAL-001-F01']),
  markerCase('intex-eval-002', 0, 1, [
    'INTEX-EVAL-002',
    'INTEX-EVAL-002-F01',
    'INTEX-EVAL-002-F02',
  ]),
  markerCase('intex-eval-003', 1, 2, ['INTEX-EVAL-003', 'INTEX-EVAL-003-F01'], [0, 1]),
  markerCase('intex-eval-004', 1, 2, ['INTEX-EVAL-004', 'INTEX-EVAL-004-F01']),
  markerCase('intex-eval-006', 0, 1, ['INTEX-EVAL-006', 'INTEX-EVAL-006-F01']),
  markerCase('intex-eval-006', 2, 3, ['INTEX-EVAL-006', 'INTEX-EVAL-006-F02']),
  markerCase('intex-eval-007', 0, 1, ['INTEX-EVAL-007', 'INTEX-EVAL-007-F01']),
  markerCase('intex-eval-008', 1, 2, ['INTEX-EVAL-008', 'INTEX-EVAL-008-F01'], [0, 1]),
  markerCase('intex-eval-010', 0, 1, ['INTEX-EVAL-010', 'INTEX-EVAL-010-F01']),
  markerCase('intex-eval-012', 0, 1, [
    'INTEX-EVAL-012',
    'INTEX-EVAL-012-F01',
    'INTEX-EVAL-012-F02',
  ]),
  markerCase('intex-eval-013', 0, 1, ['INTEX-EVAL-013', 'INTEX-EVAL-013-F01']),
  markerCase('intex-eval-014', 0, 1, ['INTEX-EVAL-014', 'INTEX-EVAL-014-F01']),
  markerCase('intex-eval-015', 0, 1, ['INTEX-EVAL-015', 'INTEX-EVAL-015-F01']),
  markerCase('intex-eval-017', 0, 1, ['INTEX-EVAL-017', 'INTEX-EVAL-017-F01']),
  markerCase('intex-eval-018', 0, 1, [
    'INTEX-EVAL-018',
    'INTEX-EVAL-018-F01',
    'INTEX-EVAL-018-F02',
  ]),
  markerCase('intex-eval-019', 0, 1, ['INTEX-EVAL-019', 'INTEX-EVAL-019-F01']),
  markerCase(
    'intex-eval-020',
    18,
    19,
    SCENARIO_020_MARKERS,
    Array.from({ length: 19 }, (_, index) => index)
  ),
] as const;

const SYNTHETIC_MARKER_PATTERN = /(?<![A-Z0-9-])INTEX-EVAL-[0-9]{3}(?:-F[0-9]{2})?(?![A-Z0-9-])/giu;
const SESSION_LIFECYCLE_NARRATION_PATTERN =
  /\b(?:(?:new|another|previous) (?:Intex Agent )?session|session (?:has |was )?(?:started|closed|superseded)|session (?:start|closure|supersession|lifecycle))\b/iu;

const COMPLETE_REDACTED_CONFIRMATION_EVIDENCE =
  'The redacted values are complete expected evidence for the judge and are not missing information.';

const REDACTED_CONFIRMATION_CASES = [
  {
    scenarioId: 'intex-eval-002',
    turnIndex: 0,
    labels: ['Title: [redacted]', 'Start: [redacted]', 'End: [redacted]', 'Location: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-003',
    turnIndex: 1,
    labels: ['Title: [redacted]', 'Start: [redacted]', 'End: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-006',
    turnIndex: 0,
    labels: ['Title: [redacted]', 'Content: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-006',
    turnIndex: 2,
    labels: ['Title: [redacted]', 'Content: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-008',
    turnIndex: 1,
    labels: ['Title: [redacted]', 'Start: [redacted]', 'End: [redacted]', 'Attendees: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-010',
    turnIndex: 0,
    labels: ['Content: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-012',
    turnIndex: 0,
    labels: ['Title: [redacted]', 'Prompt: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-014',
    turnIndex: 0,
    labels: ['Prompt: [redacted]', 'Mode: [redacted]', 'Worker: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-018',
    turnIndex: 0,
    labels: ['Entry: [redacted]', 'After: [redacted]'],
  },
  {
    scenarioId: 'intex-eval-020',
    turnIndex: 18,
    labels: ['Title: [redacted]', 'Content: [redacted]'],
  },
] as const;

const SCENARIO_020_ISOLATED_REPLY_CRITERIA = [
  'A brief generic acknowledgement that the context is retained only in the current session is sufficient and preferred.',
  'Must not claim a durable save, ask for confirmation, or restate, enumerate, count, or infer any fragment details.',
] as const;

const OBSERVABLE_NOTE_CONFIRMATION_CRITERIA = [
  'Correctly identifies a note-save request and asks for explicit confirmation in an appropriate, concise tone.',
  'Expected complete sanitized confirmation evidence: `Title: [redacted]` and `Content: [redacted]`.',
  COMPLETE_REDACTED_CONFIRMATION_EVIDENCE,
  'Does not claim the note already exists or expose raw argument content in the sanitized reply.',
] as const;

const OBSERVABLE_NOTE_CONFIRMATION_WITH_OPTIONAL_TITLE_CRITERIA = [
  'Expected complete sanitized confirmation evidence: Content: [redacted]; an additional Title: [redacted] line is optional.',
  COMPLETE_REDACTED_CONFIRMATION_EVIDENCE,
] as const;

const SCENARIO_010_COMPLETION_CRITERIA = [
  'The closed technical fact that `create_note` completed is authoritative execution evidence; `Saved the note.` or an explicit equivalent clearly and completely communicates the successful result.',
  'The completion reply need not repeat the audio/transcript source.',
  'Does not ask the user to repeat the transcript or reconfirm the same action.',
] as const;

const OBSERVABLE_EXTERNAL_SAVE_CONFIRMATION_CRITERIA = [
  'Correctly identifies an external-save request and asks for explicit confirmation in an appropriate tone.',
  'Expected complete sanitized external-save confirmation evidence: `Send this content to the external system?` and `Content: [redacted]`; `Source:` is not expected because this scenario has no URL.',
  COMPLETE_REDACTED_CONFIRMATION_EVIDENCE,
  'Does not claim the external save already completed or expose raw argument content in the sanitized reply.',
] as const;

const CONCISE_NOTE_COMPLETION_CRITERIA = [
  'Clearly communicates that the requested note was saved successfully.',
  'A concise completion-only reply is sufficient and should not restate details or invite another action.',
] as const;

const SCENARIO_011_EMPTY_CALENDAR_CRITERIA = [
  'Answers the read-only calendar request for tomorrow, July 17 2026.',
  'Clearly reports that no calendar events were found for tomorrow, July 17 2026.',
  'The closed mock returned zero calendar events; this is complete authoritative evidence for the judge and is not missing information.',
  'Does not ask for mutation confirmation or claim to create, update, or delete an event.',
] as const;

function markerCase(
  scenarioId: string,
  requestTurnIndex: number,
  executionTurnIndex: number,
  markers: readonly string[],
  sourceTurnIndexes: readonly number[] = [requestTurnIndex]
): MarkerEvidenceCase {
  return { scenarioId, requestTurnIndex, executionTurnIndex, markers, sourceTurnIndexes };
}

function findScenario(scenarios: readonly IntexEvalScenario[], id: string): IntexEvalScenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Missing tracked scenario ${id}`);
  return scenario;
}

function messageText(scenario: IntexEvalScenario, turnIndex: number): string {
  const turn = scenario.turns[turnIndex];
  if (turn?.kind !== 'message') {
    throw new Error(`Expected message turn ${String(turnIndex)} in ${scenario.id}`);
  }
  return turn.text;
}

function markersIn(text: string): string[] {
  return [
    ...new Set([...text.matchAll(SYNTHETIC_MARKER_PATTERN)].map((match) => match[0].toUpperCase())),
  ].sort();
}

function markerEvidenceKey(
  scenarioId: string,
  requestTurnIndex: number,
  executionTurnIndex: number,
  toolName: IntexAgentToolName
): string {
  return `${scenarioId}:${String(requestTurnIndex)}:${String(executionTurnIndex)}:${toolName}`;
}

function expectedForbiddenTools(expectation: TurnExpectation): IntexAgentToolName[] {
  const required = new Set(expectation.requiredToolCalls.map((call) => call.toolName));
  return INTEX_AGENT_TOOL_NAMES.filter((toolName) => !required.has(toolName));
}

function hasEqualsPayloadAssertion(
  expectation: TurnExpectation,
  eventType: string,
  path: string,
  value: string | number
): boolean {
  return expectation.timeline.payloadAssertions.some(
    (payloadAssertion) =>
      payloadAssertion.eventType === eventType &&
      payloadAssertion.assertions.some(
        (assertion) =>
          assertion.path === path && assertion.operator === 'equals' && assertion.value === value
      )
  );
}

function markerDigest(markers: readonly string[]): string {
  return createHash('sha256')
    .update(`intex-eval-marker-set:v1\0${[...new Set(markers)].sort().join('\n')}`, 'utf8')
    .digest('hex');
}

function findRequiredToolCall(
  scenario: IntexEvalScenario,
  toolName: IntexAgentToolName
): TurnExpectation['requiredToolCalls'][number] {
  const toolCall = scenario.expected.turns
    .flatMap((turn) => turn.requiredToolCalls)
    .find((callExpectation) => callExpectation.toolName === toolName);
  if (toolCall === undefined) throw new Error(`Missing ${toolName} call in ${scenario.id}`);
  return toolCall;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    );
  }
  return value;
}

function fullCatalogDigest(scenarios: readonly IntexEvalScenario[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(scenarios)))
    .digest('hex');
}

function semanticCriteriaFor(scenario: IntexEvalScenario, turnIndex: number): string {
  return (
    scenario.expected.turns[turnIndex]?.replies
      .flatMap((reply) => reply.semanticCriteria)
      .join(' ') ?? ''
  );
}

describe('tracked scenario catalog', () => {
  let scenarios: IntexEvalScenario[];

  beforeAll(async () => {
    scenarios = await loadScenarioCatalog(trackedScenariosDirectory);
  });

  it('matches the expected version 1 ID, turn-count, and positive-tool summary', () => {
    expect(
      scenarios.map((scenario) => ({
        id: scenario.id,
        turnCount: scenario.turns.length,
        positiveTools: [
          ...new Set(
            scenario.expected.turns.flatMap((turn) =>
              turn.requiredToolCalls.map((call) => call.toolName)
            )
          ),
        ],
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "id": "intex-eval-001",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-002",
          "positiveTools": [
            "create_calendar_event",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-003",
          "positiveTools": [
            "create_calendar_event",
          ],
          "turnCount": 3,
        },
        {
          "id": "intex-eval-004",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 3,
        },
        {
          "id": "intex-eval-005",
          "positiveTools": [],
          "turnCount": 1,
        },
        {
          "id": "intex-eval-006",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 4,
        },
        {
          "id": "intex-eval-007",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-008",
          "positiveTools": [
            "query_calendar_events",
            "update_calendar_event",
          ],
          "turnCount": 3,
        },
        {
          "id": "intex-eval-009",
          "positiveTools": [],
          "turnCount": 1,
        },
        {
          "id": "intex-eval-010",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-011",
          "positiveTools": [
            "query_calendar_events",
          ],
          "turnCount": 1,
        },
        {
          "id": "intex-eval-012",
          "positiveTools": [
            "create_research",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-013",
          "positiveTools": [
            "create_link",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-014",
          "positiveTools": [
            "create_code_task",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-015",
          "positiveTools": [
            "save_external",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-016",
          "positiveTools": [
            "get_user_preferences",
          ],
          "turnCount": 1,
        },
        {
          "id": "intex-eval-017",
          "positiveTools": [
            "add_user_preference",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-018",
          "positiveTools": [
            "update_user_preference",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-019",
          "positiveTools": [
            "delete_user_preference",
          ],
          "turnCount": 2,
        },
        {
          "id": "intex-eval-020",
          "positiveTools": [
            "create_note",
          ],
          "turnCount": 20,
        },
      ]
    `);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(EXPECTED_SCENARIO_IDS);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(20);
  });

  it('covers all current tools positively with complete per-turn and per-reply expectations', () => {
    const positivelyCoveredTools = new Set<IntexAgentToolName>();

    for (const scenario of scenarios) {
      expect(scenario.schemaVersion).toBe('1');
      expect(scenario.currentDateTime).toBe('2026-07-16T10:00:00+02:00');
      expect(scenario.timeZone).toBe('Europe/Warsaw');
      expect(scenario.expected.turns).toHaveLength(scenario.turns.length);

      const expectedTransitions: TurnExpectation['transition']['action'][] = Array.from(
        { length: scenario.turns.length },
        (_, index) => (index === 0 ? 'started' : 'continued')
      );
      if (scenario.id === 'intex-eval-004') expectedTransitions[1] = 'superseded_previous';
      expect(scenario.expected.turns.map((turn) => turn.transition.action)).toEqual(
        expectedTransitions
      );

      for (const [turnIndex, expectation] of scenario.expected.turns.entries()) {
        const inputTurn = scenario.turns[turnIndex];
        expect(expectation.turnIndex).toBe(turnIndex);
        expect(expectation.sessionAfterTurn.allowedStatuses).toEqual(['waiting_for_user']);
        expect(expectation.replies.length).toBeGreaterThan(0);
        expect(expectation.replies.map((reply) => reply.replyIndex)).toEqual(
          expectation.replies.map((_reply, replyIndex) => replyIndex)
        );
        for (const reply of expectation.replies) {
          expect(reply.semanticCriteria.length).toBeGreaterThan(0);
          for (const criterion of reply.semanticCriteria)
            expect(criterion.length).toBeGreaterThan(10);
        }

        expect([...expectation.forbiddenToolCalls].sort()).toEqual(
          [...expectedForbiddenTools(expectation)].sort()
        );
        expect(expectation.timeline.requiredEventTypes.length).toBeGreaterThan(0);
        expect(expectation.timeline.requiredEventTypes).toContain('assistant_message');
        if (expectation.transition.action === 'started') {
          expect(expectation.timeline.requiredEventTypes).toContain('session_started');
        }
        if (expectation.transition.action === 'superseded_previous') {
          expect(expectation.timeline.requiredEventTypes).toEqual(
            expect.arrayContaining(['session_closed', 'session_started'])
          );
        }
        if (!(scenario.id === 'intex-eval-009' && turnIndex === 0)) {
          expect(expectation.timeline.requiredEventTypes).toContain('user_message');
        }
        if (inputTurn?.kind === 'confirmation_button') {
          expect(expectation.timeline.requiredEventTypes).toContain('confirmation_resolved');
        }

        for (const toolCall of expectation.requiredToolCalls) {
          positivelyCoveredTools.add(toolCall.toolName);
          if (toolCall.toolName === 'get_user_preferences') {
            expect(toolCall.argumentAssertions).toEqual([]);
          } else {
            expect(toolCall.argumentAssertions.length).toBeGreaterThan(0);
          }
          expect(expectation.timeline.requiredEventTypes).toContain('tool_call_completed');
          expect(
            hasEqualsPayloadAssertion(
              expectation,
              'tool_call_completed',
              'toolName',
              toolCall.toolName
            )
          ).toBe(true);
        }
      }
    }

    expect([...positivelyCoveredTools]).toEqual(
      expect.arrayContaining([...INTEX_AGENT_TOOL_NAMES])
    );
    expect(positivelyCoveredTools.size).toBe(INTEX_AGENT_TOOL_NAMES.length);
  });

  it('confirmation-gates every mutating tool call and records accepted resolution evidence', () => {
    const gatedTools = new Set<IntexAgentToolName>();

    for (const scenario of scenarios) {
      for (const [turnIndex, expectation] of scenario.expected.turns.entries()) {
        const mutatingCalls = expectation.requiredToolCalls.filter((call) =>
          MUTATING_TOOL_NAMES.has(call.toolName)
        );
        if (mutatingCalls.length === 0) continue;

        const turn = scenario.turns[turnIndex];
        expect(turn).toMatchObject({ kind: 'confirmation_button', decision: 'accept' });
        if (turn?.kind !== 'confirmation_button') continue;

        const requestExpectation = scenario.expected.turns[turn.previousTurnIndex];
        if (mutatingCalls.some((call) => call.toolName === 'update_calendar_event')) {
          expect(requestExpectation?.requiredToolCalls).toEqual([
            expect.objectContaining({ toolName: 'query_calendar_events', count: 1 }),
          ]);
        } else {
          expect(requestExpectation?.requiredToolCalls).toEqual([]);
        }
        if (requestExpectation !== undefined) {
          expect(requestExpectation.forbiddenToolCalls).toEqual(
            expectedForbiddenTools(requestExpectation)
          );
        }
        expect(requestExpectation?.timeline.requiredEventTypes).toContain('confirmation_requested');

        for (const call of mutatingCalls) {
          gatedTools.add(call.toolName);
          expect(
            requestExpectation === undefined
              ? false
              : hasEqualsPayloadAssertion(
                  requestExpectation,
                  'confirmation_requested',
                  'toolName',
                  call.toolName
                )
          ).toBe(true);
          expect(
            hasEqualsPayloadAssertion(expectation, 'tool_call_completed', 'toolName', call.toolName)
          ).toBe(true);
        }

        expect(expectation.timeline.requiredEventTypes).toEqual(
          expect.arrayContaining([
            'user_message',
            'confirmation_resolved',
            'tool_call_completed',
            'assistant_message',
          ])
        );
        expect(
          hasEqualsPayloadAssertion(expectation, 'confirmation_resolved', 'resolution', 'accepted')
        ).toBe(true);
      }
    }

    expect(gatedTools).toEqual(MUTATING_TOOL_NAMES);
  });

  it('captures clarification, supersession, unsupported, and voice timeline evidence', () => {
    for (const scenarioId of ['intex-eval-003', 'intex-eval-004', 'intex-eval-008']) {
      const firstTurn = findScenario(scenarios, scenarioId).expected.turns[0];
      expect(firstTurn?.requiredToolCalls).toEqual([]);
      expect(firstTurn?.forbiddenToolCalls).toEqual([...INTEX_AGENT_TOOL_NAMES]);
      expect(firstTurn?.timeline.requiredEventTypes).toContain('clarification_requested');
      expect(firstTurn?.timeline.forbiddenEventTypes).toContain('tool_call_completed');
    }

    const supersedingTurn = findScenario(scenarios, 'intex-eval-004').expected.turns[1];
    expect(supersedingTurn?.transition).toEqual({
      action: 'superseded_previous',
      previousEndReason: 'superseded_by_user',
    });
    expect(supersedingTurn?.timeline.requiredEventTypes).toEqual(
      expect.arrayContaining(['session_closed', 'session_started', 'confirmation_requested'])
    );
    expect(
      supersedingTurn === undefined
        ? false
        : hasEqualsPayloadAssertion(
            supersedingTurn,
            'session_closed',
            'reason',
            'superseded_by_user'
          )
    ).toBe(true);

    const unsupportedTurn = findScenario(scenarios, 'intex-eval-005').expected.turns[0];
    expect(unsupportedTurn?.timeline.requiredEventTypes).toContain('unsupported_request');
    expect(unsupportedTurn?.requiredToolCalls).toEqual([]);

    const voiceScenario = findScenario(scenarios, 'intex-eval-010');
    expect(voiceScenario.turns[0]).toMatchObject({
      kind: 'message',
      sourceType: 'whatsapp_audio_transcript',
    });
    const voiceTurn = voiceScenario.expected.turns[0];
    expect(
      voiceTurn === undefined
        ? false
        : hasEqualsPayloadAssertion(
            voiceTurn,
            'user_message',
            'sourceType',
            'whatsapp_audio_transcript'
          )
    ).toBe(true);
  });

  it('keeps scenario 020 at exactly 18 no-save context turns, one request, and one confirmation', () => {
    const scenario = findScenario(scenarios, 'intex-eval-020');

    expect(scenario.turns).toHaveLength(20);
    for (let turnIndex = 0; turnIndex < 18; turnIndex += 1) {
      const turn = scenario.turns[turnIndex];
      expect(turn?.kind).toBe('message');
      if (turn?.kind === 'message') expect(turn.text).toMatch(/do not save yet/iu);
    }
    expect(scenario.turns[18]).toMatchObject({ kind: 'message' });
    expect(scenario.turns[19]).toEqual({
      kind: 'confirmation_button',
      previousTurnIndex: 18,
      decision: 'accept',
    });

    for (let turnIndex = 0; turnIndex <= 18; turnIndex += 1) {
      expect(scenario.expected.turns[turnIndex]?.requiredToolCalls).toEqual([]);
    }
    expect(scenario.expected.turns[18]?.timeline.requiredEventTypes).toContain(
      'confirmation_requested'
    );
    expect(scenario.expected.turns[19]?.requiredToolCalls).toEqual([
      expect.objectContaining({ toolName: 'create_note', count: 1 }),
    ]);
  });

  it('keeps lifecycle authority in transitions and timeline evidence rather than semantic criteria', () => {
    const sourceScenarios = scenarios.slice(0, 10);

    for (const scenario of sourceScenarios) {
      const initialTurn = scenario.expected.turns[0];
      expect(initialTurn?.transition.action).toBe('started');
      expect(initialTurn?.timeline.requiredEventTypes).toContain('session_started');
    }

    const supersedingTurn = findScenario(scenarios, 'intex-eval-004').expected.turns[1];
    expect(supersedingTurn?.transition).toEqual({
      action: 'superseded_previous',
      previousEndReason: 'superseded_by_user',
    });
    expect(supersedingTurn?.timeline.requiredEventTypes).toEqual(
      expect.arrayContaining(['session_closed', 'session_started'])
    );

    for (const scenario of scenarios) {
      for (const turn of scenario.expected.turns) {
        for (const reply of turn.replies) {
          for (const criterion of reply.semanticCriteria) {
            expect(criterion).not.toMatch(SESSION_LIFECYCLE_NARRATION_PATTERN);
          }
        }
      }
    }
  });

  it('keeps synthetic correlation markers out of every semantic criterion', () => {
    for (const scenario of scenarios) {
      for (const turn of scenario.expected.turns) {
        for (const reply of turn.replies) {
          for (const criterion of reply.semanticCriteria) {
            expect(markersIn(criterion)).toEqual([]);
          }
        }
      }
    }
  });

  it('requires a reviewable redacted scenario 002 preview without duplicating exact calendar values', () => {
    const scenario = findScenario(scenarios, 'intex-eval-002');
    const confirmationCriteria = semanticCriteriaFor(scenario, 0);
    const completionCriteria = semanticCriteriaFor(scenario, 1);
    const duplicatedExactValue =
      /(?:dentist appointment|Smile Clinic|August 18,? 2026|2:30 PM|2026-08-18T(?:14:30|15:15))/iu;

    expect(confirmationCriteria).toMatch(/calendar-event request/iu);
    expect(confirmationCriteria).toMatch(/reviewable sanitized preview/iu);
    expect(confirmationCriteria).toMatch(
      /observable redacted structured labels for Title, Start, and End/iu
    );
    expect(confirmationCriteria).toMatch(/explicit confirmation/iu);
    expect(markersIn(confirmationCriteria)).toEqual([]);
    expect(completionCriteria).toMatch(/calendar event was created successfully/iu);
    expect(confirmationCriteria).not.toMatch(duplicatedExactValue);
    expect(completionCriteria).not.toMatch(duplicatedExactValue);
  });

  it('treats literal redacted confirmation labels as complete judge evidence', () => {
    for (const testCase of REDACTED_CONFIRMATION_CASES) {
      const criteria = semanticCriteriaFor(
        findScenario(scenarios, testCase.scenarioId),
        testCase.turnIndex
      );

      for (const label of testCase.labels) expect(criteria).toContain(label);
      expect(criteria).toContain(COMPLETE_REDACTED_CONFIRMATION_EVIDENCE);
      expect(markersIn(criteria)).toEqual([]);
    }
  });

  it('keeps scenario 010 voice-source evidence deterministic and the isolated judge contract observable', () => {
    const criteria = semanticCriteriaFor(findScenario(scenarios, 'intex-eval-010'), 0);

    expect(criteria).toContain('Content: [redacted]');
    expect(criteria).toMatch(/additional `Title: \[redacted\]` line is optional/iu);
    expect(criteria).toContain(COMPLETE_REDACTED_CONFIRMATION_EVIDENCE);
    expect(criteria).toMatch(/reply need not mention the audio\/transcript source/iu);
    expect(markersIn(criteria)).toEqual([]);
  });

  it('makes scenario 004 superseding note confirmation complete from sanitized evidence', () => {
    const scenario = findScenario(scenarios, 'intex-eval-004');

    expect(scenario.expected.turns[1]?.replies[0]?.semanticCriteria).toEqual([
      'Correctly treats the new-session request as a note action rather than the abandoned calendar request and asks for confirmation.',
      ...OBSERVABLE_NOTE_CONFIRMATION_WITH_OPTIONAL_TITLE_CRITERIA,
      'The sanitized confirmation need not mention the abandoned calendar request; the closed technical transition and timeline facts are complete authoritative supersession evidence.',
      'Does not claim either action already completed or expose raw argument content in the sanitized reply.',
    ]);
  });

  it('makes scenario 010 deterministic note completion complete without repeating voice context', () => {
    const scenario = findScenario(scenarios, 'intex-eval-010');

    expect(scenario.expected.turns[1]?.replies[0]?.semanticCriteria).toEqual(
      SCENARIO_010_COMPLETION_CRITERIA
    );
  });

  it('makes scenario 015 external-save confirmation complete from sanitized evidence', () => {
    const scenario = findScenario(scenarios, 'intex-eval-015');

    expect(scenario.expected.turns[0]?.replies[0]?.semanticCriteria).toEqual(
      OBSERVABLE_EXTERNAL_SAVE_CONFIRMATION_CRITERIA
    );
  });

  it('uses a privacy-safe isolated-reply contract for scenario 020 context turns', () => {
    const scenario = findScenario(scenarios, 'intex-eval-020');

    for (let turnIndex = 0; turnIndex < 18; turnIndex += 1) {
      expect(scenario.expected.turns[turnIndex]?.replies[0]?.semanticCriteria).toEqual(
        SCENARIO_020_ISOLATED_REPLY_CRITERIA
      );
    }
  });

  it('makes the closed empty calendar result authoritative judge evidence for scenario 011', () => {
    const scenario = findScenario(scenarios, 'intex-eval-011');

    expect(scenario.expected.turns[0]?.replies[0]?.semanticCriteria).toEqual(
      SCENARIO_011_EMPTY_CALENDAR_CRITERIA
    );
    expect(markersIn(semanticCriteriaFor(scenario, 0))).toEqual([]);
  });

  it('keeps scenario 006 confirmation and completion criteria isolated from prior turns', () => {
    const scenario = findScenario(scenarios, 'intex-eval-006');
    const inaccessiblePriorStatePattern = /\b(?:first|second|follow-up|prior|previous)\b/iu;

    for (const turnIndex of [0, 2]) {
      expect(scenario.expected.turns[turnIndex]?.replies[0]?.semanticCriteria).toEqual(
        OBSERVABLE_NOTE_CONFIRMATION_CRITERIA
      );
    }
    for (const turnIndex of [1, 3]) {
      expect(scenario.expected.turns[turnIndex]?.replies[0]?.semanticCriteria).toEqual(
        CONCISE_NOTE_COMPLETION_CRITERIA
      );
    }
    for (let turnIndex = 0; turnIndex < 4; turnIndex += 1) {
      expect(semanticCriteriaFor(scenario, turnIndex)).not.toMatch(inaccessiblePriorStatePattern);
    }
  });

  it('keeps scenarios 001 and 007 note confirmations observable from complete redacted evidence', () => {
    for (const testCase of [
      {
        scenarioId: 'intex-eval-001',
        firstCriterion:
          'Correctly identifies a note-save request and asks for explicit confirmation in an appropriate, concise tone.',
        finalCriterion:
          'Does not claim the note already exists or expose raw argument content in the sanitized reply.',
      },
      {
        scenarioId: 'intex-eval-007',
        firstCriterion:
          'Correctly identifies a note-save request and asks for explicit confirmation in an appropriate, concise tone.',
        finalCriterion:
          'Does not classify the request as unsupported or expose raw argument content in the sanitized reply.',
      },
    ]) {
      const scenario = findScenario(scenarios, testCase.scenarioId);
      const criteria = scenario.expected.turns[0]?.replies[0]?.semanticCriteria;

      expect(criteria).toEqual([
        testCase.firstCriterion,
        ...OBSERVABLE_NOTE_CONFIRMATION_WITH_OPTIONAL_TITLE_CRITERIA,
        testCase.finalCriterion,
      ]);
      expect(criteria?.join(' ')).not.toMatch(SYNTHETIC_MARKER_PATTERN);
      expect(criteria?.join(' ')).not.toContain(messageText(scenario, 0));
    }
  });

  it('keeps scenario 020 final confirmation and completion observable in isolation', () => {
    const scenario = findScenario(scenarios, 'intex-eval-020');

    expect(scenario.expected.turns[18]?.replies[0]?.semanticCriteria).toEqual(
      OBSERVABLE_NOTE_CONFIRMATION_CRITERIA
    );
    expect(scenario.expected.turns[19]?.replies[0]?.semanticCriteria).toEqual(
      CONCISE_NOTE_COMPLETION_CRITERIA
    );
  });

  it('uses endpoint-observable calendar ranges and complete attendee-update snapshot evidence', () => {
    const calendar002 = findRequiredToolCall(
      findScenario(scenarios, 'intex-eval-002'),
      'create_calendar_event'
    );
    expect(calendar002.argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'start', operator: 'contains', value: '2026-08-18T14:30' },
        { path: 'end', operator: 'contains', value: '2026-08-18T15:15' },
      ])
    );

    const scenario003 = findScenario(scenarios, 'intex-eval-003');
    expect(scenario003.turns[0]).toMatchObject({
      kind: 'message',
      text: expect.stringMatching(/2026-07-21/iu),
    });
    expect(scenario003.turns[1]).toMatchObject({
      kind: 'message',
      text: 'At noon.',
    });
    expect(findRequiredToolCall(scenario003, 'create_calendar_event').argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'start', operator: 'contains', value: '2026-07-21T12:00' },
        { path: 'end', operator: 'contains', value: '2026-07-21T13:00' },
      ])
    );

    for (const toolCall of [
      calendar002,
      findRequiredToolCall(scenario003, 'create_calendar_event'),
    ]) {
      expect(toolCall.argumentAssertions.map((assertion) => assertion.path)).not.toContain(
        'timeZone'
      );
    }

    const scenario008 = findScenario(scenarios, 'intex-eval-008');
    expect(findRequiredToolCall(scenario008, 'query_calendar_events').argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'mode', operator: 'equals', value: 'list' },
        { path: 'queryLength', operator: 'exists' },
        { path: 'timeMin', operator: 'exists' },
        { path: 'timeMax', operator: 'exists' },
      ])
    );
    expect(findRequiredToolCall(scenario008, 'update_calendar_event').argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'attendeesToAddCount', operator: 'equals', value: 1 },
        { path: 'hasEventId', operator: 'equals', value: true },
        { path: 'hasCalendarId', operator: 'equals', value: true },
        { path: 'hasExpectedEtag', operator: 'equals', value: true },
        { path: 'hasEventStart', operator: 'equals', value: true },
        { path: 'hasEventEnd', operator: 'equals', value: true },
      ])
    );

    const query011 = findRequiredToolCall(
      findScenario(scenarios, 'intex-eval-011'),
      'query_calendar_events'
    );
    expect(query011.argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'mode', operator: 'equals', value: 'list' },
        {
          path: 'timeMin',
          operator: 'equals',
          value: '2026-07-17T00:00:00.000+02:00',
        },
        {
          path: 'timeMax',
          operator: 'equals',
          value: '2026-07-18T00:00:00.000+02:00',
        },
      ])
    );
  });

  it('pins marker count and digest in both confirmation preview and executed arguments', () => {
    const actualMutatingCalls = scenarios.flatMap((scenario) =>
      scenario.expected.turns.flatMap((expectation, executionTurnIndex) => {
        const turn = scenario.turns[executionTurnIndex];
        return expectation.requiredToolCalls
          .filter((call) => MUTATING_TOOL_NAMES.has(call.toolName))
          .map((call) => {
            if (turn?.kind !== 'confirmation_button') {
              throw new Error(`Mutating call is not confirmation-gated in ${scenario.id}`);
            }
            return markerEvidenceKey(
              scenario.id,
              turn.previousTurnIndex,
              executionTurnIndex,
              call.toolName
            );
          });
      })
    );
    const declaredCases = MARKER_EVIDENCE_CASES.map((testCase) => {
      const scenario = findScenario(scenarios, testCase.scenarioId);
      const toolName =
        scenario.expected.turns[testCase.executionTurnIndex]?.requiredToolCalls[0]?.toolName;
      if (toolName === undefined)
        throw new Error(`Missing evidence call in ${testCase.scenarioId}`);
      return markerEvidenceKey(
        testCase.scenarioId,
        testCase.requestTurnIndex,
        testCase.executionTurnIndex,
        toolName
      );
    });
    expect([...declaredCases].sort()).toEqual([...actualMutatingCalls].sort());
    expect(new Set(declaredCases).size).toBe(declaredCases.length);

    for (const testCase of MARKER_EVIDENCE_CASES) {
      const scenario = findScenario(scenarios, testCase.scenarioId);
      const sourceMarkers = markersIn(
        testCase.sourceTurnIndexes.map((turnIndex) => messageText(scenario, turnIndex)).join(' ')
      );
      expect(sourceMarkers).toEqual([...testCase.markers].sort());
      const expectedDigest = markerDigest(testCase.markers);
      const request = scenario.expected.turns[testCase.requestTurnIndex];
      const execution = scenario.expected.turns[testCase.executionTurnIndex];
      const toolCall = execution?.requiredToolCalls[0];

      expect(
        request === undefined
          ? false
          : hasEqualsPayloadAssertion(
              request,
              'confirmation_requested',
              'argsSummary.syntheticMarkerCount',
              testCase.markers.length
            )
      ).toBe(true);
      expect(
        request === undefined
          ? false
          : hasEqualsPayloadAssertion(
              request,
              'confirmation_requested',
              'argsSummary.syntheticMarkerDigest',
              expectedDigest
            )
      ).toBe(true);
      expect(toolCall?.argumentAssertions).toEqual(
        expect.arrayContaining([
          { path: 'syntheticMarkerCount', operator: 'equals', value: testCase.markers.length },
          { path: 'syntheticMarkerDigest', operator: 'equals', value: expectedDigest },
        ])
      );

      const missingFactDigest = markerDigest(testCase.markers.slice(0, -1));
      expect(missingFactDigest).not.toBe(expectedDigest);
      expect(
        request === undefined
          ? false
          : hasEqualsPayloadAssertion(
              request,
              'confirmation_requested',
              'argsSummary.syntheticMarkerDigest',
              missingFactDigest
            )
      ).toBe(false);
      expect(toolCall?.argumentAssertions).not.toContainEqual({
        path: 'syntheticMarkerDigest',
        operator: 'equals',
        value: missingFactDigest,
      });
    }
  });

  it('pins scenario 014 planning worker in both confirmation preview and executed arguments', () => {
    const scenario = findScenario(scenarios, 'intex-eval-014');
    const request = scenario.expected.turns[0];
    const execution = findRequiredToolCall(scenario, 'create_code_task');

    expect(messageText(scenario, 0)).toBe(
      'Create an OpenRouter planning code task to investigate synthetic cache behavior. Keep both exact markers INTEX-EVAL-014 and INTEX-EVAL-014-F01 in the task prompt as synthetic test markers only. They are not Linear issue IDs, and the task must not be associated with Linear.'
    );
    expect(
      request === undefined
        ? false
        : hasEqualsPayloadAssertion(
            request,
            'confirmation_requested',
            'argsSummary.workerType',
            'openrouter-free'
          )
    ).toBe(true);
    expect(
      request === undefined
        ? false
        : hasEqualsPayloadAssertion(
            request,
            'confirmation_requested',
            'argsSummary.taskMode',
            'planning'
          )
    ).toBe(true);
    expect(
      request === undefined
        ? false
        : request.timeline.payloadAssertions.some(
            (payload) =>
              payload.eventType === 'confirmation_requested' &&
              payload.assertions.some(
                (assertion) =>
                  assertion.path === 'argsSummary.hasLinearIssueId' &&
                  assertion.operator === 'absent'
              )
          )
    ).toBe(true);
    expect(execution.argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'workerType', operator: 'equals', value: 'openrouter-free' },
        { path: 'taskMode', operator: 'equals', value: 'planning' },
        { path: 'hasLinearIssueId', operator: 'absent' },
      ])
    );
    expect(semanticCriteriaFor(scenario, 0)).not.toContain('Linear: [redacted]');
  });

  it('uses exactly the base marker plus F01 through F18 for scenario 020', () => {
    const scenario = findScenario(scenarios, 'intex-eval-020');
    const markers = new Set(
      scenario.turns.flatMap((turn) =>
        turn.kind === 'message'
          ? [...turn.text.matchAll(SYNTHETIC_MARKER_PATTERN)].map((match) => match[0].toUpperCase())
          : []
      )
    );
    expect([...markers].sort()).toEqual([...SCENARIO_020_MARKERS].sort());
  });

  it('keeps read-only query 011 free of synthetic marker evidence assertions', () => {
    const scenario = findScenario(scenarios, 'intex-eval-011');
    const query = findRequiredToolCall(scenario, 'query_calendar_events');
    const toolPaths = query.argumentAssertions.map((assertion) => assertion.path);
    const timelinePaths = scenario.expected.turns.flatMap((turn) =>
      turn.timeline.payloadAssertions.flatMap((payload) =>
        payload.assertions.map((assertion) => assertion.path)
      )
    );
    for (const path of ['syntheticMarkerCount', 'syntheticMarkerDigest']) {
      expect(toolPaths).not.toContain(path);
    }
    for (const path of ['argsSummary.syntheticMarkerCount', 'argsSummary.syntheticMarkerDigest']) {
      expect(timelinePaths).not.toContain(path);
    }
  });

  it('places preference evidence markers inside fields reachable by mutation arguments', () => {
    const addText = messageText(findScenario(scenarios, 'intex-eval-017'), 0);
    const updateText = messageText(findScenario(scenarios, 'intex-eval-018'), 0);
    const deleteText = messageText(findScenario(scenarios, 'intex-eval-019'), 0);
    const addRow = /exact row:\s*(.*)$/iu.exec(addText)?.[1] ?? '';
    const updateMatch =
      /Update preference (\S+) at version 0 with this exact replacement row:\s*(.*)$/iu.exec(
        updateText
      );
    const deleteItemId = /Delete preference (\S+) at version/iu.exec(deleteText)?.[1] ?? '';

    expect(markersIn(addRow)).toEqual(['INTEX-EVAL-017', 'INTEX-EVAL-017-F01']);
    expect(markersIn(`${updateMatch?.[1] ?? ''} ${updateMatch?.[2] ?? ''}`)).toEqual([
      'INTEX-EVAL-018',
      'INTEX-EVAL-018-F01',
      'INTEX-EVAL-018-F02',
    ]);
    expect(markersIn(deleteItemId)).toEqual(['INTEX-EVAL-019', 'INTEX-EVAL-019-F01']);
  });

  it('judges confirmation intent and redacted state instead of claiming raw previews are visible', () => {
    for (const testCase of MARKER_EVIDENCE_CASES) {
      const scenario = findScenario(scenarios, testCase.scenarioId);
      const criteria = scenario.expected.turns[testCase.requestTurnIndex]?.replies
        .flatMap((reply) => reply.semanticCriteria)
        .join(' ');
      expect(criteria).not.toMatch(/INTEX-EVAL-[0-9]{3}/iu);
      expect(criteria).not.toMatch(
        /\b(?:preview|reply|confirmation)[^.]{0,100}\b(?:preserves|includes|contains|shows|repeats|retains|mentions)\b/iu
      );
    }

    for (const scenarioId of ['intex-eval-017', 'intex-eval-018', 'intex-eval-019']) {
      const criteria = findScenario(scenarios, scenarioId)
        .expected.turns[1]?.replies.flatMap((reply) => reply.semanticCriteria)
        .join(' ');
      expect(criteria).toMatch(/sanitized resulting preference state/iu);
    }
  });

  it('matches the stable SHA-256 digest of the full canonical parsed catalog', () => {
    expect(fullCatalogDigest(scenarios)).toBe(
      '47df465089fee3ff50711922d999b808820925c3964f7c9d92a6bc14f7ee148c'
    );
  });
});
