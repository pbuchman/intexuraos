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
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

const MUTATING_REQUEST_CRITERIA_CASES = [
  {
    scenarioId: 'intex-eval-001',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-001', 'garage', '7241'],
  },
  {
    scenarioId: 'intex-eval-002',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-002', 'dentist', 'August 18', '2:30 PM', '45 minutes', 'Smile Clinic'],
  },
  {
    scenarioId: 'intex-eval-003',
    turnIndex: 1,
    tokens: ['INTEX-EVAL-003', 'lunch', 'Marta', 'next Tuesday', 'noon', 'one hour'],
  },
  {
    scenarioId: 'intex-eval-004',
    turnIndex: 1,
    tokens: ['INTEX-EVAL-004', 'backup code', '9988'],
  },
  {
    scenarioId: 'intex-eval-006',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-006', 'garage remote', 'desk drawer'],
  },
  {
    scenarioId: 'intex-eval-006',
    turnIndex: 2,
    tokens: ['INTEX-EVAL-006', 'parking', 'P3'],
  },
  {
    scenarioId: 'intex-eval-007',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-007', 'passport', 'November 2029'],
  },
  {
    scenarioId: 'intex-eval-008',
    turnIndex: 1,
    tokens: ['INTEX-EVAL-008', 'project review', 'September 10', '3 PM', 'one hour'],
  },
  {
    scenarioId: 'intex-eval-010',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-010', 'storage unit key', 'blue drawer'],
  },
  {
    scenarioId: 'intex-eval-012',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-012', 'battery testing'],
  },
  {
    scenarioId: 'intex-eval-013',
    turnIndex: 0,
    tokens: ['example.com/intex-eval-013'],
  },
  {
    scenarioId: 'intex-eval-014',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-014', 'MiniMax', 'planning', 'cache'],
  },
  {
    scenarioId: 'intex-eval-015',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-015', 'synthetic receipt'],
  },
  {
    scenarioId: 'intex-eval-017',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-017', 'concise Polish'],
  },
  {
    scenarioId: 'intex-eval-018',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-018', 'pref_eval_018', 'version 0', 'formal Polish'],
  },
  {
    scenarioId: 'intex-eval-019',
    turnIndex: 0,
    tokens: ['INTEX-EVAL-019', 'pref_eval_019', 'version 0'],
  },
] as const;

const SCENARIO_020_FACT_TOKENS = [
  'synthetic green folder',
  'Atlas Readiness Brief',
  'launch coordinator',
  'July 30 2026',
  'verify the demo dataset',
  'review the rollback outline',
  'confirm the mock dashboard',
  'synthetic amber',
  'rehearse the dry-run sequence',
  'numbered entries',
  'concise bullet points',
  'risks section',
  'decisions section',
  'next-actions section',
  'Orion',
  'forty-five minutes',
  'final checklist owner',
  'ready for synthetic review',
] as const;

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

  it('does not require positive lifecycle announcements outside the idle new-session command', () => {
    const positiveLifecycleCriterion =
      /(?:makes clear|clearly communicates)[^.]{0,200}(?:new (?:Intex Agent )?session|session (?:was )?superseded)|new (?:Intex Agent )?session (?:started|is handling)/iu;

    for (const scenario of scenarios) {
      if (scenario.id === 'intex-eval-009') continue;
      for (const criterion of scenario.expected.turns.flatMap((turn) =>
        turn.replies.flatMap((reply) => reply.semanticCriteria)
      )) {
        if (criterion.trimStart().toLocaleLowerCase('en-US').startsWith('does not ')) continue;
        expect(criterion).not.toMatch(positiveLifecycleCriterion);
      }
    }
  });

  it('uses endpoint-observable exact calendar ranges without requiring a tool timezone', () => {
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
    expect(scenario003.turns[1]).toMatchObject({
      kind: 'message',
      text: expect.stringMatching(/next Tuesday at noon for one hour/iu),
    });
    expect(findRequiredToolCall(scenario003, 'create_calendar_event').argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'start', operator: 'contains', value: '2026-07-21T12:00' },
        { path: 'end', operator: 'contains', value: '2026-07-21T13:00' },
      ])
    );

    const calendar008 = findRequiredToolCall(
      findScenario(scenarios, 'intex-eval-008'),
      'create_calendar_event'
    );
    expect(calendar008.argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'start', operator: 'contains', value: '2026-09-10T15:00' },
        { path: 'end', operator: 'contains', value: '2026-09-10T16:00' },
      ])
    );

    for (const toolCall of [
      calendar002,
      findRequiredToolCall(scenario003, 'create_calendar_event'),
      calendar008,
    ]) {
      expect(toolCall.argumentAssertions.map((assertion) => assertion.path)).not.toContain(
        'timeZone'
      );
    }

    const query011 = findRequiredToolCall(
      findScenario(scenarios, 'intex-eval-011'),
      'query_calendar_events'
    );
    expect(query011.argumentAssertions).toEqual(
      expect.arrayContaining([
        { path: 'mode', operator: 'equals', value: 'list' },
        { path: 'timeMin', operator: 'contains', value: '2026-07-17' },
        { path: 'timeMax', operator: 'contains', value: '2026-07-18' },
      ])
    );
  });

  it('preserves the concrete synthetic facts in every mutating confirmation preview', () => {
    for (const testCase of MUTATING_REQUEST_CRITERIA_CASES) {
      const scenario = findScenario(scenarios, testCase.scenarioId);
      const semanticCriteria = scenario.expected.turns[testCase.turnIndex]?.replies
        .flatMap((reply) => reply.semanticCriteria)
        .join(' ');
      expect(semanticCriteria).toBeDefined();
      for (const token of testCase.tokens) {
        expect(semanticCriteria?.toLocaleLowerCase('en-US')).toContain(
          token.toLocaleLowerCase('en-US')
        );
      }
    }
  });

  it('requires scenario 020 confirmation preview semantics to preserve all eighteen facts', () => {
    const requestCriteria = findScenario(scenarios, 'intex-eval-020')
      .expected.turns[18]?.replies.flatMap((reply) => reply.semanticCriteria)
      .join(' ');
    expect(requestCriteria).toBeDefined();
    for (const factToken of SCENARIO_020_FACT_TOKENS) {
      expect(requestCriteria?.toLocaleLowerCase('en-US')).toContain(
        factToken.toLocaleLowerCase('en-US')
      );
    }
  });

  it('matches the stable SHA-256 digest of the full canonical parsed catalog', () => {
    expect(fullCatalogDigest(scenarios)).toBe(
      'fc9e507f57668742406db3ed3769597337b889b4b88d1bb69b4810a3d6b8291b'
    );
  });
});
