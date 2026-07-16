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
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

const REQUIRED_ARGUMENT_PATHS = {
  create_note: ['contentLength'],
  create_calendar_event: ['summaryLength', 'start', 'end', 'timeZone'],
  query_calendar_events: ['mode', 'timeMin', 'timeMax'],
  create_research: ['titleLength', 'promptLength'],
  create_link: ['hasUrl'],
  create_code_task: ['promptLength', 'workerType', 'taskMode'],
  save_external: ['messageLength'],
  get_user_preferences: [],
  add_user_preference: ['textLength', 'expectedVersion'],
  update_user_preference: ['hasItemId', 'textLength', 'expectedVersion'],
  delete_user_preference: ['hasItemId', 'expectedVersion'],
} as const satisfies Record<IntexAgentToolName, readonly string[]>;

function findScenario(scenarios: readonly IntexEvalScenario[], id: string): IntexEvalScenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Missing tracked scenario ${id}`);
  return scenario;
}

function expectedForbiddenTools(expectation: TurnExpectation): IntexAgentToolName[] {
  const required = new Set(expectation.requiredToolCalls.map((call) => call.toolName));
  return INTEX_AGENT_TOOL_NAMES.filter((toolName) => !required.has(toolName));
}

function hasEqualsPayloadAssertion(
  expectation: TurnExpectation,
  eventType: string,
  path: string,
  value: string
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

describe('tracked scenario catalog', () => {
  let scenarios: IntexEvalScenario[];

  beforeAll(async () => {
    scenarios = await loadScenarioCatalog(trackedScenariosDirectory);
  });

  it('matches the exact version 1 catalog snapshot', () => {
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
            "create_calendar_event",
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
          const assertionPaths = new Set(
            toolCall.argumentAssertions.map((assertion) => assertion.path)
          );
          for (const requiredPath of REQUIRED_ARGUMENT_PATHS[toolCall.toolName]) {
            expect(assertionPaths.has(requiredPath)).toBe(true);
          }
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
        expect(requestExpectation?.requiredToolCalls).toEqual([]);
        expect(requestExpectation?.forbiddenToolCalls).toEqual([...INTEX_AGENT_TOOL_NAMES]);
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
});
