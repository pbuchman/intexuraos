import { describe, expect, it } from 'vitest';
import { IntexEvalScenarioSchema, ValueAssertionSchema } from '../scenarioSchema.js';
import {
  INTEX_AGENT_SESSION_END_REASONS,
  INTEX_AGENT_SESSION_EVENT_TYPES,
  INTEX_AGENT_SESSION_START_REASONS,
  INTEX_AGENT_SESSION_STATUSES,
  INTEX_AGENT_TOOL_NAMES,
  INTEX_AGENT_TRANSITION_ACTIONS,
  TIMELINE_PAYLOAD_PATHS,
  TOOL_ARGUMENT_PATHS,
} from '../types.js';
import { createConfirmationScenario, createScenario } from './scenarioFixtures.js';

function expectScenarioInvalid(scenario: unknown): void {
  expect(IntexEvalScenarioSchema.safeParse(scenario).success).toBe(false);
}

function expectScenarioValid(scenario: unknown): void {
  expect(IntexEvalScenarioSchema.safeParse(scenario).success).toBe(true);
}

describe('IntexEvalScenarioSchema', () => {
  it('parses a fully valid version 1 scenario and normalizes trimmed fields', () => {
    const scenario = createScenario();
    scenario.title = '  Synthetic note scenario  ';
    scenario.description = '  Synthetic description.  ';
    scenario.timeZone = '  Europe/Warsaw  ';

    const parsed = IntexEvalScenarioSchema.parse(scenario);

    expect(parsed.title).toBe('Synthetic note scenario');
    expect(parsed.description).toBe('Synthetic description.');
    expect(parsed.timeZone).toBe('Europe/Warsaw');
  });

  it('pins the local endpoint wire enums for contract 2026-07-01', () => {
    expect(INTEX_AGENT_SESSION_STATUSES).toEqual([
      'active',
      'waiting_for_user',
      'executing_tool',
      'completed',
      'unsupported',
      'expired',
      'cancelled',
      'superseded',
    ]);
    expect(INTEX_AGENT_SESSION_START_REASONS).toEqual([
      'no_active_session',
      'previous_completed',
      'previous_expired',
      'user_requested_new_session',
      'previous_superseded',
    ]);
    expect(INTEX_AGENT_SESSION_END_REASONS).toEqual([
      'tool_completed',
      'tool_failed',
      'unsupported_request',
      'timeout',
      'cancelled_by_user',
      'superseded_by_user',
    ]);
    expect(INTEX_AGENT_SESSION_EVENT_TYPES).toEqual([
      'session_started',
      'session_closed',
      'user_message',
      'assistant_message',
      'agent_fallback',
      'clarification_requested',
      'confirmation_requested',
      'confirmation_resolved',
      'tool_call_started',
      'tool_call_completed',
      'tool_call_failed',
      'unsupported_request',
    ]);
    expect(INTEX_AGENT_TRANSITION_ACTIONS).toEqual([
      'started',
      'continued',
      'superseded_previous',
      'expired_previous',
    ]);
  });

  it.each([
    [
      'root',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario, { extra: 1 });
      },
    ],
    [
      'message turn',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.turns[0] ?? {}, { messageId: 'synthetic' });
      },
    ],
    [
      'expected root',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected, { extra: 1 });
      },
    ],
    [
      'turn expectation',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0] ?? {}, { extra: 1 });
      },
    ],
    [
      'required tool call',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.requiredToolCalls[0] ?? {}, { extra: 1 });
      },
    ],
    [
      'argument assertion',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(
          scenario.expected.turns[0]?.requiredToolCalls[0]?.argumentAssertions[0] ?? {},
          { extra: 1 }
        );
      },
    ],
    [
      'transition',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.transition ?? {}, { extra: 1 });
      },
    ],
    [
      'session snapshot',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.sessionAfterTurn ?? {}, { extra: 1 });
      },
    ],
    [
      'timeline',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.timeline ?? {}, { extra: 1 });
      },
    ],
    [
      'timeline payload assertion',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.timeline.payloadAssertions[0] ?? {}, {
          extra: 1,
        });
      },
    ],
    [
      'reply expectation',
      (scenario: ReturnType<typeof createScenario>): void => {
        Object.assign(scenario.expected.turns[0]?.replies[0] ?? {}, { extra: 1 });
      },
    ],
  ])('rejects unknown fields at the %s object level', (_name, mutate) => {
    const scenario = createScenario();
    mutate(scenario);
    expectScenarioInvalid(scenario);
  });

  it('rejects unknown fields on confirmation turns', () => {
    const scenario = createConfirmationScenario();
    Object.assign(scenario.turns[1] ?? {}, { timestamp: '2026-07-16T10:00:01+02:00' });
    expectScenarioInvalid(scenario);
  });

  it.each(['userId', 'whatsappSender', 'replyContext', 'sourceUrl', 'messageId', 'timestamp'])(
    'rejects tracked message identity field %s',
    (field) => {
      const scenario = createScenario();
      Object.assign(scenario.turns[0] ?? {}, { [field]: 'real-looking-value' });
      expectScenarioInvalid(scenario);
    }
  );

  it('rejects raw toolMocks in schema version 1', () => {
    const scenario = createScenario();
    Object.assign(scenario, { toolMocks: { create_note: { mode: 'success', result: {} } } });
    expectScenarioInvalid(scenario);
  });

  it.each([
    [
      'schema version',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.schemaVersion = '2';
      },
    ],
    [
      'scenario id',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.id = 'intex-eval-1';
      },
    ],
    [
      'empty title',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.title = '   ';
      },
    ],
    [
      'long title',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.title = 'a'.repeat(161);
      },
    ],
    [
      'empty description',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.description = '   ';
      },
    ],
    [
      'long description',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.description = 'a'.repeat(1001);
      },
    ],
    [
      'date-time without offset',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.currentDateTime = '2026-07-16T10:00:00';
      },
    ],
    [
      'invalid time zone',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.timeZone = 'Mars/Olympus';
      },
    ],
  ])('rejects an invalid %s', (_name, mutate) => {
    const scenario = createScenario();
    mutate(scenario);
    expectScenarioInvalid(scenario);
  });

  it.each([0, 21])('rejects a scenario with %i turns', (turnCount) => {
    expectScenarioInvalid(createScenario(turnCount));
  });

  it('accepts exactly 20 turns', () => {
    expectScenarioValid(createScenario(20));
  });

  it.each([
    ['', 'whatsapp_text'],
    ['x'.repeat(4001), 'whatsapp_text'],
    ['Synthetic text', 'email'],
  ])('rejects invalid message text/sourceType', (text, sourceType) => {
    const scenario = createScenario();
    const turn = scenario.turns[0];
    if (turn !== undefined) {
      turn.text = text;
      turn.sourceType = sourceType;
    }
    expectScenarioInvalid(scenario);
  });

  it.each(['whatsapp_text', 'whatsapp_audio_transcript'])(
    'accepts source type %s',
    (sourceType) => {
      const scenario = createScenario();
      const turn = scenario.turns[0];
      if (turn !== undefined) turn.sourceType = sourceType;
      expectScenarioValid(scenario);
    }
  );

  it('accepts a confirmation that references an earlier message turn', () => {
    expectScenarioValid(createConfirmationScenario());
  });

  it.each([-1, 1, 2])(
    'rejects confirmation previousTurnIndex %i when it does not reference an earlier message',
    (previousTurnIndex) => {
      const scenario = createConfirmationScenario();
      Object.assign(scenario.turns[1] ?? {}, { previousTurnIndex });
      expectScenarioInvalid(scenario);
    }
  );

  it('rejects confirmation references to an earlier confirmation turn', () => {
    const scenario = createScenario(3);
    scenario.turns[1] = {
      kind: 'confirmation_button',
      previousTurnIndex: 0,
      decision: 'accept',
    } as unknown as (typeof scenario.turns)[number];
    scenario.turns[2] = {
      kind: 'confirmation_button',
      previousTurnIndex: 1,
      decision: 'reject',
    } as unknown as (typeof scenario.turns)[number];
    expectScenarioInvalid(scenario);
  });

  it('rejects invalid confirmation decisions', () => {
    const scenario = createConfirmationScenario();
    Object.assign(scenario.turns[1] ?? {}, { decision: 'later' });
    expectScenarioInvalid(scenario);
  });

  it.each([
    ['tool name', 'requiredToolCalls', 'not_a_tool'],
    ['forbidden tool name', 'forbiddenToolCalls', 'not_a_tool'],
    ['event type', 'requiredEventTypes', 'not_an_event'],
    ['forbidden event type', 'forbiddenEventTypes', 'not_an_event'],
  ])('rejects invalid %s', (_name, field, invalidValue) => {
    const scenario = createScenario();
    const expectation = scenario.expected.turns[0];
    if (expectation !== undefined) {
      if (field === 'requiredToolCalls') {
        expectation.requiredToolCalls[0] = {
          toolName: invalidValue,
          count: 1,
          argumentAssertions: [],
        };
      } else if (field === 'forbiddenToolCalls') {
        expectation.forbiddenToolCalls = [invalidValue];
      } else if (field === 'requiredEventTypes') {
        expectation.timeline.requiredEventTypes = [invalidValue];
      } else {
        expectation.timeline.forbiddenEventTypes = [invalidValue];
      }
    }
    expectScenarioInvalid(scenario);
  });

  it.each([
    ['status', 'allowedStatuses', 'not_a_status'],
    ['start reason', 'startReason', 'not_a_start_reason'],
    ['end reason', 'endReason', 'not_an_end_reason'],
    ['active tool', 'activeTool', 'not_a_tool'],
  ])('rejects invalid session %s', (_name, field, invalidValue) => {
    const scenario = createScenario();
    const session = scenario.expected.turns[0]?.sessionAfterTurn;
    if (session !== undefined) Object.assign(session, { [field]: invalidValue });
    expectScenarioInvalid(scenario);
  });

  it('rejects an empty allowed status set', () => {
    const scenario = createScenario();
    const session = scenario.expected.turns[0]?.sessionAfterTurn;
    if (session !== undefined) session.allowedStatuses = [];
    expectScenarioInvalid(scenario);
  });

  it.each([
    ['action', { action: 'restarted' }],
    ['previous end reason', { action: 'expired_previous', previousEndReason: 'clock_skew' }],
  ])('rejects an invalid transition %s', (_name, transition) => {
    const scenario = createScenario();
    const expectation = scenario.expected.turns[0];
    if (expectation !== undefined) expectation.transition = transition;
    expectScenarioInvalid(scenario);
  });

  it.each([0, 6, 1.5])('rejects required tool count %s', (count) => {
    const scenario = createScenario();
    const call = scenario.expected.turns[0]?.requiredToolCalls[0];
    if (call !== undefined) call.count = count;
    expectScenarioInvalid(scenario);
  });

  it('rejects duplicate required tool names', () => {
    const scenario = createScenario();
    const calls = scenario.expected.turns[0]?.requiredToolCalls;
    if (calls !== undefined && calls[0] !== undefined) calls.push({ ...calls[0] });
    expectScenarioInvalid(scenario);
  });

  it('rejects overlap between required and forbidden tool names', () => {
    const scenario = createScenario();
    const expectation = scenario.expected.turns[0];
    if (expectation !== undefined) expectation.forbiddenToolCalls = ['create_note'];
    expectScenarioInvalid(scenario);
  });

  it('rejects overlap between required and forbidden timeline event types', () => {
    const scenario = createScenario();
    const timeline = scenario.expected.turns[0]?.timeline;
    if (timeline !== undefined) timeline.forbiddenEventTypes = ['session_started'];
    expectScenarioInvalid(scenario);
  });

  it.each([
    ['equals without value', { path: 'toolName', operator: 'equals' }],
    ['contains without value', { path: 'textPreview', operator: 'contains' }],
    ['exists with value', { path: 'toolName', operator: 'exists', value: 'create_note' }],
    ['absent with value', { path: 'reason', operator: 'absent', value: null }],
    ['nested value', { path: 'toolName', operator: 'equals', value: { nested: true } }],
    ['invalid operator', { path: 'toolName', operator: 'matches', value: 'create_note' }],
  ])('rejects %s assertions', (_name, assertion) => {
    expect(ValueAssertionSchema.safeParse(assertion).success).toBe(false);
  });

  it.each([null, true, 7, 'create_note'])('accepts scalar assertion value %s', (value) => {
    expect(
      ValueAssertionSchema.safeParse({ path: 'toolName', operator: 'equals', value }).success
    ).toBe(true);
  });

  it.each(
    Object.entries({
      create_note: 'contentLength',
      create_calendar_event: 'start',
      query_calendar_events: 'mode',
      create_research: 'promptLength',
      create_link: 'hasUrl',
      create_code_task: 'workerType',
      save_external: 'messageLength',
      add_user_preference: 'expectedVersion',
      update_user_preference: 'hasItemId',
      delete_user_preference: 'expectedVersion',
    })
  )('accepts observable argument path %s.%s', (toolName, path) => {
    const scenario = createScenario();
    const expectation = scenario.expected.turns[0];
    const call = expectation?.requiredToolCalls[0];
    if (expectation !== undefined && call !== undefined) {
      expectation.forbiddenToolCalls = [];
      call.toolName = toolName;
      call.argumentAssertions = [{ path, operator: 'exists' }];
    }
    expectScenarioValid(scenario);
  });

  it('accepts no argument assertions for get_user_preferences', () => {
    const scenario = createScenario();
    const call = scenario.expected.turns[0]?.requiredToolCalls[0];
    if (call !== undefined) {
      call.toolName = 'get_user_preferences';
      call.argumentAssertions = [];
    }
    expectScenarioValid(scenario);
  });

  it.each(['start', 'unknownPath'])('rejects tool-incompatible create_note path %s', (path) => {
    const scenario = createScenario();
    const call = scenario.expected.turns[0]?.requiredToolCalls[0];
    if (call !== undefined) call.argumentAssertions = [{ path, operator: 'exists' }];
    expectScenarioInvalid(scenario);
  });

  it('rejects every argument assertion for get_user_preferences', () => {
    const scenario = createScenario();
    const call = scenario.expected.turns[0]?.requiredToolCalls[0];
    if (call !== undefined) {
      call.toolName = 'get_user_preferences';
      call.argumentAssertions = [{ path: 'contentLength', operator: 'exists' }];
    }
    expectScenarioInvalid(scenario);
  });

  it.each(TIMELINE_PAYLOAD_PATHS)('accepts timeline payload assertion path %s', (path) => {
    const scenario = createScenario();
    const payloadAssertion = scenario.expected.turns[0]?.timeline.payloadAssertions[0];
    if (payloadAssertion !== undefined) {
      payloadAssertion.assertions = [{ path, operator: 'exists' }];
    }
    expectScenarioValid(scenario);
  });

  it('rejects an arbitrary timeline payload path', () => {
    const scenario = createScenario();
    const payloadAssertion = scenario.expected.turns[0]?.timeline.payloadAssertions[0];
    if (payloadAssertion !== undefined) {
      payloadAssertion.assertions = [{ path: 'rawMessage', operator: 'exists' }];
    }
    expectScenarioInvalid(scenario);
  });

  it('exports a path catalog for every canonical tool', () => {
    expect(Object.keys(TOOL_ARGUMENT_PATHS)).toEqual([...INTEX_AGENT_TOOL_NAMES]);
  });

  it.each([
    [
      'missing',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.expected.turns.pop();
      },
    ],
    [
      'duplicate',
      (scenario: ReturnType<typeof createScenario>): void => {
        const expectation = scenario.expected.turns[0];
        if (expectation !== undefined) scenario.expected.turns.push({ ...expectation });
      },
    ],
    [
      'out-of-range',
      (scenario: ReturnType<typeof createScenario>): void => {
        const expectation = scenario.expected.turns[0];
        if (expectation !== undefined) expectation.turnIndex = 2;
      },
    ],
    [
      'unsorted',
      (scenario: ReturnType<typeof createScenario>): void => {
        scenario.expected.turns.reverse();
      },
    ],
  ])('rejects %s turn expectation coverage', (_name, mutate) => {
    const scenario = createScenario(2);
    mutate(scenario);
    expectScenarioInvalid(scenario);
  });

  it.each([
    [
      'duplicate',
      [
        { replyIndex: 0, semanticCriteria: ['First criterion.'] },
        { replyIndex: 0, semanticCriteria: ['Second criterion.'] },
      ],
    ],
    [
      'non-contiguous',
      [
        { replyIndex: 0, semanticCriteria: ['First criterion.'] },
        { replyIndex: 2, semanticCriteria: ['Second criterion.'] },
      ],
    ],
    ['negative', [{ replyIndex: -1, semanticCriteria: ['First criterion.'] }]],
  ])('rejects %s reply indexes', (_name, replies) => {
    const scenario = createScenario();
    const expectation = scenario.expected.turns[0];
    if (expectation !== undefined) expectation.replies = replies;
    expectScenarioInvalid(scenario);
  });

  it.each([
    { name: 'empty', semanticCriteria: [] },
    { name: 'blank', semanticCriteria: ['   '] },
    { name: 'too long', semanticCriteria: ['a'.repeat(301)] },
    {
      name: 'duplicate',
      semanticCriteria: ['Duplicate criterion.', 'Duplicate criterion.'],
    },
  ])('rejects $name per-reply semantic criteria', ({ semanticCriteria }) => {
    const scenario = createScenario();
    const reply = scenario.expected.turns[0]?.replies[0];
    if (reply !== undefined) reply.semanticCriteria = semanticCriteria;
    expectScenarioInvalid(scenario);
  });

  it.each([
    'person@company.com',
    'auth0|abc123def456',
    '@alice:matrix.company.test',
    '!privateRoom123:matrix.company.test',
    '+48123456789',
    'intex_session_01HZYABCDEFGH',
    'wamid.HBgLREALMESSAGE1234',
    'https://private.company.test/path',
  ])('rejects real-looking tracked identity content: %s', (privateValue) => {
    const scenario = createScenario();
    const turn = scenario.turns[0];
    if (turn !== undefined) turn.text = `Synthetic request ${privateValue}`;
    expectScenarioInvalid(scenario);
  });

  it('accepts the documented synthetic URL domain', () => {
    const scenario = createScenario();
    const turn = scenario.turns[0];
    if (turn !== undefined) turn.text = 'Save https://example.com/intex-eval-001';
    expectScenarioValid(scenario);
  });

  it('accepts all declared transition actions with valid optional previous reasons', () => {
    for (const action of INTEX_AGENT_TRANSITION_ACTIONS) {
      const scenario = createScenario();
      const expectation = scenario.expected.turns[0];
      if (expectation !== undefined) {
        expectation.transition =
          action === 'expired_previous' ? { action, previousEndReason: 'timeout' } : { action };
      }
      expectScenarioValid(scenario);
    }
  });
});
