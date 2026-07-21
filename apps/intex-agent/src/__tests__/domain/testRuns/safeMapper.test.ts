import { describe, expect, it } from 'vitest';

import type { IntexAgentSessionEvent } from '../../../domain/sessions/types.js';
import {
  mapPublicTestRun,
  mapPublicTestRunHeader,
  mapPublicTestScenario,
} from '../../../domain/testRuns/safeMapper.js';
import type { TestRunScenarioProjectionV1 } from '../../../domain/testRuns/types.js';
import {
  emptyDeterministicEvidence,
  testRunRecord,
  testRunScenario,
  testRunNow,
} from './testRunFixtures.js';

const bindingDigest = '9'.repeat(64);

function projection(eventWatermark = 4): TestRunScenarioProjectionV1 {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    userId: 'auth0:user_1',
    sessionId: 'session_private_1',
    sessionBindingDigest: bindingDigest,
    scenarioId: 'scenario_001',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario 001/020',
    runRevision: 3,
    scenarioRevision: 1,
    eventWatermark,
    lifecycle: 'running',
    verdict: 'pending',
    plannedTurns: 1,
    completedTurns: 1,
    toolEvidence: [],
    deterministicChecks: [
      {
        code: 'tool_name',
        status: 'passed',
        turnIndex: 0,
        replyIndex: null,
        evidence: emptyDeterministicEvidence(),
      },
    ],
    replyEvaluations: [
      {
        turnIndex: 0,
        replyIndex: 1,
        verdict: 'passed',
        score: 5,
        criteria: {
          understoodIntent: true,
          helpful: true,
          conciseAndClear: true,
          professionalTone: true,
          noPassiveAggression: true,
        },
        failureCodes: [],
        latencyMs: 10,
        usage: {
          logicalCalls: 1,
          repairCount: 0,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costNanoUsd: 3,
        },
      },
    ],
    agentUsage: [],
  };
}

function events(): IntexAgentSessionEvent[] {
  return [
    {
      id: 'private_event_1',
      sessionId: 'session_private_1',
      userId: 'auth0:user_1',
      type: 'user_message',
      payload: {
        text: 'Natural request',
        turnIndex: 0,
        capability: 'private-capability',
      },
      createdAt: testRunNow,
      eventSequence: 1,
    },
    {
      id: 'private_event_2',
      sessionId: 'session_private_1',
      userId: 'auth0:user_1',
      type: 'tool_call_started',
      payload: {
        status: 'started',
        toolName: 'create_note',
        turnIndex: 0,
        ordinal: 1,
        facts: [{ name: 'contentLength', value: 12 }],
        rawArguments: { content: 'private raw payload' },
      },
      createdAt: testRunNow,
      eventSequence: 2,
    },
    {
      id: 'private_event_3',
      sessionId: 'session_private_1',
      userId: 'auth0:user_1',
      type: 'assistant_message',
      payload: { text: 'Natural reply', providerRequestId: 'private-provider-id' },
      createdAt: testRunNow,
      eventSequence: 3,
    },
    {
      id: 'private_event_4',
      sessionId: 'session_private_1',
      userId: 'auth0:user_1',
      type: 'turn_processing_completed',
      payload: { status: 'completed' },
      createdAt: testRunNow,
      eventSequence: 4,
    },
  ];
}

function run(eventWatermark = 4): ReturnType<typeof testRunRecord> {
  const scenarios = Array.from({ length: 20 }, (_, index) =>
    testRunScenario(index + 1, index === 0 ? {
      scenarioRevision: 1,
      eventWatermark,
      lifecycle: 'running',
      plannedTurns: 1,
      completedTurns: 1,
      expectedReplies: 1,
      completedReplies: 1,
      selectedTools: ['create_note'],
      sessionId: 'session_private_1',
      sessionBindingDigest: bindingDigest,
    } : {})
  );
  return testRunRecord({ revision: 3, lifecycle: 'running', scenarios });
}

describe('Test Runs safe public mapper', () => {
  it('maps run and scenario summaries field by field without private identity', () => {
    const header = mapPublicTestRunHeader(run());
    const dto = mapPublicTestRun(run());
    expect(header).toMatchObject({ runId: 'run_1', revision: 3, currentScenarioNumber: 1 });
    expect(dto.scenarios).toHaveLength(20);
    const serialized = JSON.stringify({ header, dto });
    expect(serialized).not.toContain('auth0:user_1');
    expect(serialized).not.toContain('session_private_1');
    expect(serialized).not.toContain(bindingDigest);
  });

  it('builds a contiguous closed timeline and drops raw event fields', () => {
    const dto = mapPublicTestScenario({ run: run(), projection: projection(), events: events() });
    expect(dto.timeline.map((event) => event.type)).toEqual([
      'user_message',
      'tool_selected',
      'assistant_message',
      'deterministic_evaluation',
      'minimax_evaluation',
    ]);
    expect(dto.timeline.map((event) => event.timelineIndex)).toEqual([0, 1, 2, 3, 4]);
    const serialized = JSON.stringify(dto);
    expect(serialized).toContain('Natural request');
    expect(serialized).toContain('Natural reply');
    expect(serialized).not.toContain('private-capability');
    expect(serialized).not.toContain('rawArguments');
    expect(serialized).not.toContain('private-provider-id');
    expect(serialized).not.toContain('private_event_');
  });

  it('keeps a committed scenario readable after a later run-only revision', () => {
    const dto = mapPublicTestScenario({
      run: run(),
      projection: { ...projection(), runRevision: 2 },
      events: events(),
    });
    expect(dto.runRevision).toBe(3);
  });

  it('fails closed for a mismatched binding, revision, gap, or malformed public event', () => {
    expect(() => mapPublicTestScenario({
      run: run(),
      projection: { ...projection(), sessionBindingDigest: '8'.repeat(64) },
      events: events(),
    })).toThrow('TEST_RUN_PROJECTION_MISMATCH');
    expect(() => mapPublicTestScenario({
      run: run(),
      projection: projection(),
      events: events().filter((event) => event.eventSequence !== 2),
    })).toThrow('TEST_RUN_STALE_PROJECTION');
    expect(() => mapPublicTestScenario({
      run: run(),
      projection: projection(),
      events: events().map((event) =>
        event.type === 'user_message' ? { ...event, payload: { text: { private: true }, turnIndex: 0 } } : event
      ),
    })).toThrow('TEST_RUN_INVALID_TIMELINE');
  });

  it('covers fail-closed DTO and timeline schema boundaries', () => {
    const withoutEvaluations = mapPublicTestScenario({
      run: run(),
      projection: { ...projection(), deterministicChecks: [], replyEvaluations: [] },
      events: events(),
    });
    expect(withoutEvaluations.timeline.map((event) => event.type)).toEqual([
      'user_message',
      'tool_selected',
      'assistant_message',
    ]);

    const withoutSequences = events().map((event) => {
      const { eventSequence: _eventSequence, ...withoutSequence } = event;
      return withoutSequence;
    });
    expect(() =>
      mapPublicTestScenario({
        run: run(),
        projection: projection(),
        events: withoutSequences,
      })
    ).toThrow('TEST_RUN_STALE_PROJECTION');

    expect(() =>
      mapPublicTestScenario({
        run: { ...run(), agentModel: 'or:private/invalid' } as never,
        projection: projection(),
        events: events(),
      })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');

    expect(() =>
      mapPublicTestScenario({
        run: run(),
        projection: {
          ...projection(),
          deterministicChecks: [
            {
              code: 'tool_name',
              status: 'private' as never,
              turnIndex: 0,
              replyIndex: null,
              evidence: emptyDeterministicEvidence(),
            },
          ],
          replyEvaluations: [],
        },
        events: events(),
      })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');

    for (const eventIndex of [0, 2]) {
      const invalidTimestamp = events().map((event, index) =>
        index === eventIndex ? { ...event, createdAt: 'invalid' } : event
      );
      expect(() =>
        mapPublicTestScenario({
          run: run(),
          projection: projection(),
          events: invalidTimestamp,
        })
      ).toThrow('TEST_RUN_INVALID_TIMELINE');
    }
  });

  it('maps every safe tool and confirmation outcome while ignoring private lifecycle events', () => {
    const source = [
      { type: 'user_message', payload: { text: 'Do it', turnIndex: 0 } },
      {
        type: 'tool_call_started',
        payload: {
          status: 'started',
          toolName: 'create_note',
          turnIndex: 0,
          ordinal: 1,
          facts: [{ name: 'contentLength', value: 5 }],
        },
      },
      {
        type: 'tool_call_completed',
        payload: {
          status: 'mock_completed',
          toolName: 'create_note',
          turnIndex: 0,
          ordinal: 1,
          facts: [],
        },
      },
      {
        type: 'tool_call_failed',
        payload: {
          status: 'mock_failed',
          toolName: 'create_note',
          turnIndex: 0,
          ordinal: 2,
          facts: [],
        },
      },
      {
        type: 'tool_call_failed',
        payload: {
          status: 'unexpected_known_no_execution',
          toolName: 'create_note',
          turnIndex: 0,
          ordinal: 3,
          facts: [],
        },
      },
      {
        type: 'confirmation_requested',
        payload: {
          confirmationId: 'confirmation_1',
          toolName: 'create_note',
          toolSelection: { turnIndex: 0 },
        },
      },
      {
        type: 'confirmation_resolved',
        payload: { confirmationId: 'confirmation_1', resolution: 'accepted' },
      },
      {
        type: 'confirmation_requested',
        payload: {
          confirmationId: 'confirmation_2',
          toolName: 'create_note',
          toolSelection: { turnIndex: 0 },
        },
      },
      {
        type: 'confirmation_resolved',
        payload: { confirmationId: 'confirmation_2', resolution: 'rejected' },
      },
      { type: 'turn_processing_completed', payload: { status: 'completed' } },
      { type: 'assistant_message', payload: { text: 'Done' } },
    ] as const;
    const richEvents = source.map(
      (event, index): IntexAgentSessionEvent => ({
        id: `private_rich_${String(index + 1)}`,
        sessionId: 'session_private_1',
        userId: 'auth0:user_1',
        type: event.type,
        payload: event.payload,
        createdAt: testRunNow,
        eventSequence: index + 1,
      })
    );
    const richProjection = {
      ...projection(richEvents.length),
      deterministicChecks: [
        {
          code: 'tool_name' as const,
          status: 'failed' as const,
          turnIndex: 0,
          replyIndex: null,
          evidence: emptyDeterministicEvidence(),
        },
      ],
      replyEvaluations: [],
    };

    const dto = mapPublicTestScenario({
      run: run(richEvents.length),
      projection: richProjection,
      events: richEvents,
    });

    expect(dto.timeline.map((event) => event.type)).toEqual([
      'user_message',
      'tool_selected',
      'mock_completed',
      'mock_failed',
      'unexpected_known_no_execution',
      'confirmation_requested',
      'confirmation_resolved',
      'confirmation_requested',
      'confirmation_resolved',
      'assistant_message',
      'deterministic_evaluation',
    ]);
    expect(dto.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'confirmation_resolved', resolution: 'confirmed' }),
        expect.objectContaining({ type: 'confirmation_resolved', resolution: 'rejected' }),
        expect.objectContaining({ type: 'deterministic_evaluation', verdict: 'failed' }),
      ])
    );
  });

  it('fails closed for every critical projection identity mismatch and invalid source shape', () => {
    const baseProjection = projection();
    const projectionVariants: TestRunScenarioProjectionV1[] = [
      { ...baseProjection, runId: 'run_other' },
      { ...baseProjection, userId: 'auth0:other' },
      { ...baseProjection, runRevision: 4 },
      { ...baseProjection, scenarioNumber: 2 },
      { ...baseProjection, scenarioLabel: 'Scenario 002/020' },
      { ...baseProjection, scenarioRevision: 2 },
      { ...baseProjection, eventWatermark: 3 },
      { ...baseProjection, sessionId: 'session_other' },
    ];
    for (const candidate of projectionVariants)
      expect(() => mapPublicTestScenario({ run: run(), projection: candidate, events: events() }))
        .toThrow();

    const invalidEvents: IntexAgentSessionEvent[][] = [
      events().map((event, index) => {
        if (index !== 0) return event;
        const { eventSequence: _eventSequence, ...withoutSequence } = event;
        return withoutSequence;
      }),
      events().map((event, index) =>
        index === 0 ? { ...event, sessionId: 'session_other' } : event
      ),
      events().map((event, index) =>
        index === 0 ? { ...event, userId: 'auth0:other' } : event
      ),
      events().map((event, index) =>
        index === 0 ? { ...event, payload: { text: '', turnIndex: 0 } } : event
      ),
      events().map((event, index) =>
        index === 1
          ? { ...event, payload: { status: 'started', toolName: 'unknown', turnIndex: 0, ordinal: 1 } }
          : event
      ),
    ];
    for (const candidate of invalidEvents)
      expect(() => mapPublicTestScenario({ run: run(), projection: projection(), events: candidate }))
        .toThrow();
  });

  it('ignores only explicitly private event types and rejects an unknown stored event type', () => {
    expect(() => mapPublicTestScenario({ run: run(), projection: projection(), events: events() }))
      .not.toThrow();

    const corrupt = events().map((event, index) =>
      index === 3
        ? { ...event, type: 'future_unreviewed_event' as IntexAgentSessionEvent['type'] }
        : event
    );
    expect(() => mapPublicTestScenario({ run: run(), projection: projection(), events: corrupt }))
      .toThrow('TEST_RUN_INVALID_TIMELINE');
  });

  it('rejects a projection for a scenario absent from the run summary', () => {
    expect(() =>
      mapPublicTestScenario({
        run: run(),
        projection: { ...projection(), scenarioId: 'scenario_absent' },
        events: events(),
      })
    ).toThrow('TEST_RUN_PROJECTION_MISMATCH');
  });

  it('rejects assistant output before a user turn and malformed assistant text', () => {
    const assistantFirst = events().map((event, index) =>
      index === 0
        ? { ...event, type: 'assistant_message' as const, payload: { text: 'Too early' } }
        : event
    );
    expect(() =>
      mapPublicTestScenario({ run: run(), projection: projection(), events: assistantFirst })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');

    for (const text of ['', 'x'.repeat(4097), 3]) {
      const malformed = events().map((event, index) =>
        index === 2 ? { ...event, payload: { text } } : event
      );
      expect(() =>
        mapPublicTestScenario({ run: run(), projection: projection(), events: malformed })
      ).toThrow('TEST_RUN_INVALID_TIMELINE');
    }
  });

  it('fails closed when one turn contains a sixth assistant reply', () => {
    const source = events();
    const assistant = source[2];
    if (assistant === undefined) throw new Error('assistant fixture missing');
    const sixReplies = Array.from({ length: 6 }, (_, index) => ({
      ...assistant,
      id: `private_reply_${String(index + 1)}`,
      eventSequence: index + 3,
    }));
    const overBound = [source[0], source[1], ...sixReplies]
      .filter((event): event is IntexAgentSessionEvent => event !== undefined)
      .map((event, index) => ({ ...event, eventSequence: index + 1 }));
    const boundedRun = run(overBound.length);

    expect(() =>
      mapPublicTestScenario({
        run: boundedRun,
        projection: projection(overBound.length),
        events: overBound,
      })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');
  });

  it.each([
    ['turn', { status: 'started', toolName: 'create_note', turnIndex: 20, ordinal: 1, facts: [] }],
    ['ordinal zero', { status: 'started', toolName: 'create_note', turnIndex: 0, ordinal: 0, facts: [] }],
    ['ordinal high', { status: 'started', toolName: 'create_note', turnIndex: 0, ordinal: 21, facts: [] }],
    ['status', { status: 'open', toolName: 'create_note', turnIndex: 0, ordinal: 1, facts: [] }],
    ['fact', { status: 'started', toolName: 'create_note', turnIndex: 0, ordinal: 1, facts: [{ name: 'private', value: true }] }],
  ] as const)('rejects malformed tool timeline %s', (_name, payload) => {
    const malformed = events().map((event, index) =>
      index === 1 ? { ...event, payload } : event
    );
    expect(() =>
      mapPublicTestScenario({ run: run(), projection: projection(), events: malformed })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');
  });

  it.each([
    [
      'confirmation id',
      {
        confirmationId: '',
        toolName: 'create_note',
        toolSelection: { turnIndex: 0 },
      },
    ],
    [
      'tool name',
      {
        confirmationId: 'confirmation_1',
        toolName: 'private_tool',
        toolSelection: { turnIndex: 0 },
      },
    ],
    [
      'selection object',
      {
        confirmationId: 'confirmation_1',
        toolName: 'create_note',
        toolSelection: [],
      },
    ],
    [
      'turn index',
      {
        confirmationId: 'confirmation_1',
        toolName: 'create_note',
        toolSelection: { turnIndex: -1 },
      },
    ],
  ] as const)('rejects malformed %s in confirmation request', (_name, payload) => {
    const source = events().map((event, index) =>
      index === 1
        ? { ...event, type: 'confirmation_requested' as const, payload }
        : event
    );
    expect(() =>
      mapPublicTestScenario({ run: run(), projection: projection(), events: source })
    ).toThrow('TEST_RUN_INVALID_TIMELINE');
  });

  it('rejects unresolved or invalid confirmation decisions', () => {
    const user = events()[0];
    if (user === undefined) throw new Error('user fixture missing');
    for (const payload of [
      { confirmationId: 'missing', resolution: 'accepted' },
      { confirmationId: '', resolution: 'accepted' },
      { confirmationId: 'confirmation_1', resolution: 'private' },
    ]) {
      const source: IntexAgentSessionEvent[] = [
        { ...user, eventSequence: 1 },
        {
          ...user,
          id: 'private_resolution',
          type: 'confirmation_resolved',
          payload,
          eventSequence: 2,
        },
      ];
      expect(() =>
        mapPublicTestScenario({
          run: run(2),
          projection: { ...projection(2), deterministicChecks: [], replyEvaluations: [] },
          events: source,
        })
      ).toThrow('TEST_RUN_INVALID_TIMELINE');
    }
  });

  it.each([
    ['pending', 'pending'],
    ['passed', 'passed'],
  ] as const)('aggregates %s deterministic checks', (status, verdict) => {
    const dto = mapPublicTestScenario({
      run: run(),
      projection: {
        ...projection(),
        deterministicChecks: [
          {
            code: 'tool_name',
            status,
            turnIndex: 0,
            replyIndex: null,
            evidence: emptyDeterministicEvidence(),
          },
        ],
        replyEvaluations: [],
      },
      events: events(),
    });
    expect(dto.timeline).toContainEqual(expect.objectContaining({
      type: 'deterministic_evaluation',
      verdict,
    }));
  });
});
