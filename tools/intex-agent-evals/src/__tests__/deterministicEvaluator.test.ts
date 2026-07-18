import { describe, expect, it } from 'vitest';
import { evaluateDeterministically, type ReplyTechnicalFacts } from '../deterministicEvaluator.js';
import type {
  EndpointConversationResponse,
  EndpointTimelineEvent,
  EndpointToolCall,
} from '../endpointClient.js';
import { IntexEvalScenarioSchema, type IntexEvalScenario } from '../scenarioSchema.js';
import {
  createConfirmationScenario,
  createScenario,
  type ExpectationFixture,
  type ScenarioFixture,
} from './scenarioFixtures.js';

describe('deterministic evaluator', () => {
  it('reports a stopped confirmation without cascading failures beyond the executed prefix', () => {
    const scenario = IntexEvalScenarioSchema.parse(createConfirmationScenario());
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).toolCalls = [];
    response.turns = response.turns.slice(0, 1);
    response.sessionTransitions = response.sessionTransitions.slice(0, 1);
    Object.assign(response, {
      stoppedBeforeTurn: { turnIndex: 1, reason: 'confirmation_button_unavailable' },
    });

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toEqual([
      {
        code: 'required_tool_count_mismatch',
        scenarioId: scenario.id,
        turnIndex: 0,
        expected: 1,
        actual: 0,
      },
      {
        code: 'confirmation_button_unavailable',
        scenarioId: scenario.id,
        turnIndex: 1,
      },
    ]);
    expect(evaluation.repliesForJudge).toHaveLength(1);
    expect(evaluation.repliesForJudge[0]).toMatchObject({
      turnIndex: 0,
      assistantText: 'Sanitized assistant reply.',
      technicalFacts: { failureCodes: ['required_tool_count_mismatch'] },
    });
  });

  it('passes every evidence class and freezes the exact judge technical facts', () => {
    const scenario = scenarioFor((expected) => {
      expected.requiredToolCalls = [
        {
          toolName: 'create_note',
          count: 1,
          argumentAssertions: [
            { path: 'contentLength', operator: 'equals', value: 12 },
            { path: 'syntheticMarkerCount', operator: 'equals', value: 2 },
            { path: 'syntheticMarkerDigest', operator: 'contains', value: 'digest' },
          ],
        },
      ];
      expected.forbiddenToolCalls = ['create_calendar_event'];
      expected.transition = { action: 'started' };
      expected.sessionAfterTurn = {
        allowedStatuses: ['waiting_for_user'],
        startReason: 'no_active_session',
        activeTool: 'create_note',
      };
      expected.timeline = {
        requiredEventTypes: ['session_started', 'confirmation_requested'],
        forbiddenEventTypes: ['tool_call_failed'],
        payloadAssertions: [
          {
            eventType: 'confirmation_requested',
            assertions: [
              { path: 'toolName', operator: 'equals', value: 'create_note' },
              {
                path: 'argsSummary.syntheticMarkerCount',
                operator: 'equals',
                value: 2,
              },
              {
                path: 'argsSummary.syntheticMarkerDigest',
                operator: 'equals',
                value: 'safe-digest',
              },
            ],
          },
        ],
      };
    });
    const response = responseFor(scenario);

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.repliesForJudge).toEqual([
      {
        scenarioId: scenario.id,
        turnIndex: 0,
        replyIndex: 0,
        assistantText: 'Sanitized assistant reply.',
        semanticCriteria: ['Asks the user to confirm the synthetic note.'],
        technicalFacts: {
          turnPassed: true,
          failureCodes: [],
          tools: [
            {
              toolName: 'create_note',
              expectation: 'required',
              expectedCount: 1,
              actualCount: 1,
              actualStatuses: ['completed'],
              argumentAssertions: 'passed',
              syntheticMarkerEvidence: 'passed',
            },
            {
              toolName: 'create_calendar_event',
              expectation: 'forbidden',
              expectedCount: 0,
              actualCount: 0,
              actualStatuses: [],
              argumentAssertions: 'not_applicable',
              syntheticMarkerEvidence: 'not_applicable',
            },
          ],
          transition: {
            expectedAction: 'started',
            actualAction: 'started',
            outcome: 'passed',
          },
          session: {
            allowedStatuses: ['waiting_for_user'],
            actualStatus: 'waiting_for_user',
            expectedStartReason: 'no_active_session',
            actualStartReason: 'no_active_session',
            expectedActiveTool: 'create_note',
            actualActiveTool: 'create_note',
            outcome: 'passed',
          },
          timeline: {
            required: [
              { eventType: 'session_started', outcome: 'passed' },
              { eventType: 'confirmation_requested', outcome: 'passed' },
            ],
            forbidden: [{ eventType: 'tool_call_failed', outcome: 'passed' }],
            payloadGroups: [
              {
                eventType: 'confirmation_requested',
                outcome: 'passed',
                syntheticMarkerEvidence: 'passed',
              },
            ],
          },
          confirmationAction: 'requested',
          toolOutcome: { toolName: 'create_note', status: 'completed' },
        },
      },
    ]);
  });

  it('counts required tools only on their own turn and reports missing/count mismatches', () => {
    const fixture = createScenario(2) as ScenarioFixture;
    requiredItem(requiredItem(fixture.expected.turns, 0).requiredToolCalls, 0).count = 2;
    const scenario = IntexEvalScenarioSchema.parse(fixture);
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).toolCalls = [];
    requiredItem(response.turns, 1).toolCalls = [passingCall()];

    const evaluation = evaluateDeterministically(scenario, response);

    expect(
      evaluation.failures.filter((failure) => failure.code === 'required_tool_count_mismatch')
    ).toEqual([
      {
        code: 'required_tool_count_mismatch',
        scenarioId: scenario.id,
        turnIndex: 0,
        expected: 2,
        actual: 0,
      },
    ]);
    expect(evaluation.repliesForJudge[0]?.technicalFacts.tools[0]).toMatchObject({
      actualCount: 0,
      argumentAssertions: 'not_observed',
    });
  });

  it('reports a forbidden call with a safe count', () => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).toolCalls.push({
      toolName: 'create_calendar_event',
      status: 'failed',
      error: 'private-tool-error-sentinel',
    });

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures).toContainEqual({
      code: 'forbidden_tool_called',
      scenarioId: scenario.id,
      turnIndex: 0,
      expected: 0,
      actual: 1,
    });
    expect(evaluation.repliesForJudge[0]?.technicalFacts.tools[1]).toMatchObject({
      expectation: 'forbidden',
      actualStatuses: ['failed'],
    });
  });

  it.each([
    ['equals', { path: 'contentLength', operator: 'equals', value: 12 }, 13],
    [
      'contains',
      { path: 'syntheticMarkerDigest', operator: 'contains', value: 'safe-fragment' },
      'private-assertion-sentinel',
    ],
    ['exists', { path: 'tagsCount', operator: 'exists' }, undefined],
    ['absent', { path: 'tagsCount', operator: 'absent' }, 1],
    ['non-scalar', { path: 'contentLength', operator: 'equals', value: 12 }, { nested: true }],
  ] as const)(
    'applies %s with own-property traversal and safe failure output',
    (_label, assertion, actual) => {
      const scenario = scenarioFor((expected) => {
        requiredItem(expected.requiredToolCalls, 0).argumentAssertions = [{ ...assertion }];
      });
      const response = responseFor(scenario);
      const summary = requiredItem(requiredItem(response.turns, 0).toolCalls, 0)
        .argsSummary as Record<string, unknown>;
      if (actual === undefined) Reflect.deleteProperty(summary, assertion.path);
      else summary[assertion.path] = actual;

      const evaluation = evaluateDeterministically(scenario, response);
      const failure = evaluation.failures.find(
        (candidate) => candidate.code === 'tool_argument_assertion_failed'
      );

      expect(failure).toMatchObject({
        code: 'tool_argument_assertion_failed',
        scenarioId: scenario.id,
        turnIndex: 0,
        path: assertion.path,
      });
      expect(JSON.stringify(failure)).not.toContain('private-assertion-sentinel');
    }
  );

  it('does not traverse inherited assertion values', () => {
    const scenario = scenarioFor((expected) => {
      requiredItem(expected.requiredToolCalls, 0).argumentAssertions = [
        { path: 'contentLength', operator: 'exists' },
      ];
    });
    const response = responseFor(scenario);
    requiredItem(requiredItem(response.turns, 0).toolCalls, 0).argsSummary = Object.create({
      contentLength: 12,
    }) as never;

    expect(evaluateDeterministically(scenario, response).failures).toContainEqual(
      expect.objectContaining({ code: 'tool_argument_assertion_failed', path: 'contentLength' })
    );
  });

  it('requires every matching required call to pass every assertion', () => {
    const scenario = scenarioFor((expected) => {
      requiredItem(expected.requiredToolCalls, 0).count = 2;
      requiredItem(expected.requiredToolCalls, 0).argumentAssertions = [
        { path: 'contentLength', operator: 'equals', value: 12 },
      ];
    });
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).toolCalls.push({
      ...passingCall(),
      argsSummary: { contentLength: 99 },
    });

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures).toContainEqual(
      expect.objectContaining({ code: 'tool_argument_assertion_failed', path: 'contentLength' })
    );
    expect(evaluation.repliesForJudge[0]?.technicalFacts.tools[0]).toMatchObject({
      actualCount: 2,
      argumentAssertions: 'failed',
    });
  });

  it.each([
    ['passed', true, true],
    ['failed', true, false],
    ['not_observed', false, false],
    ['not_applicable', true, undefined],
  ] as const)(
    'reports required-tool marker evidence as %s without exposing a digest',
    (expectedState, observed, markerPasses) => {
      const scenario = scenarioFor((expected) => {
        requiredItem(expected.requiredToolCalls, 0).argumentAssertions =
          markerPasses === undefined
            ? [{ path: 'contentLength', operator: 'equals', value: 12 }]
            : [
                {
                  path: 'syntheticMarkerDigest',
                  operator: 'equals',
                  value: 'safe-digest',
                },
              ];
      });
      const response = responseFor(scenario);
      if (!observed) requiredItem(response.turns, 0).toolCalls = [];
      else if (markerPasses === false) {
        requiredItem(requiredItem(response.turns, 0).toolCalls, 0).argsSummary = {
          syntheticMarkerDigest: 'private-digest-sentinel',
        };
      }

      const facts = onlyFacts(evaluateDeterministically(scenario, response));
      expect(facts.tools[0]?.syntheticMarkerEvidence).toBe(expectedState);
      expect(JSON.stringify(facts)).not.toMatch(/safe-digest|private-digest-sentinel/u);
    }
  );

  it.each([
    ['missing', []],
    [
      'duplicate',
      [
        { turnIndex: 0, action: 'started', sessionId: 'session-0' },
        { turnIndex: 0, action: 'continued', sessionId: 'session-0' },
      ],
    ],
    ['wrong action', [{ turnIndex: 0, action: 'continued', sessionId: 'session-0' }]],
  ] as const)('fails a %s transition defensively', (_label, transitions) => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    response.sessionTransitions = structuredClone([...transitions]);

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures).toContainEqual(
      expect.objectContaining({ code: 'transition_mismatch', turnIndex: 0 })
    );
    expect(onlyFacts(evaluation).transition.outcome).toBe('failed');
  });

  it('compares an optional previous end reason', () => {
    const scenario = scenarioFor((expected) => {
      expected.transition = { action: 'started', previousEndReason: 'timeout' };
    });
    const response = responseFor(scenario);
    requiredItem(response.sessionTransitions, 0).previousEndReason = 'cancelled_by_user';

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures).toContainEqual(
      expect.objectContaining({
        code: 'transition_mismatch',
        expected: 'timeout',
        actual: 'cancelled_by_user',
      })
    );
  });

  it.each([
    ['status', 'status', 'completed'],
    ['start reason', 'startReason', 'previous_completed'],
    ['end reason', 'endReason', 'timeout'],
    ['active tool', 'activeTool', 'create_calendar_event'],
  ] as const)('fails a mismatched session %s', (_label, field, value) => {
    const scenario = scenarioFor((expected) => {
      expected.sessionAfterTurn = {
        allowedStatuses: ['waiting_for_user'],
        startReason: 'no_active_session',
        endReason: 'tool_completed',
        activeTool: 'create_note',
      };
    });
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).sessionAfterTurn.endReason = 'tool_completed';
    Object.assign(requiredItem(response.turns, 0).sessionAfterTurn, { [field]: value });

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures).toContainEqual(
      expect.objectContaining({
        code: field === 'status' ? 'session_status_mismatch' : 'session_field_mismatch',
        path: field,
      })
    );
    expect(onlyFacts(evaluation).session.outcome).toBe('failed');
  });

  it('evaluates required, forbidden, same-event payload, and cross-session current-turn events', () => {
    const scenario = scenarioFor((expected) => {
      expected.timeline = {
        requiredEventTypes: ['session_started', 'confirmation_requested'],
        forbiddenEventTypes: ['tool_call_failed'],
        payloadAssertions: [
          {
            eventType: 'confirmation_requested',
            assertions: [
              { path: 'toolName', operator: 'equals', value: 'create_note' },
              { path: 'status', operator: 'equals', value: 'pending' },
            ],
          },
        ],
      };
    });
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).timelineEvents = [
      event('session_started', {}, 'different-session'),
      event('confirmation_requested', { toolName: 'create_note' }),
      event('confirmation_requested', { status: 'pending' }),
      event('tool_call_failed', {}),
    ];

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures.map((failure) => failure.code)).toEqual([
      'forbidden_timeline_event_present',
      'timeline_payload_assertion_failed',
    ]);
    expect(onlyFacts(evaluation).timeline).toMatchObject({
      required: [
        { eventType: 'session_started', outcome: 'passed' },
        { eventType: 'confirmation_requested', outcome: 'passed' },
      ],
      forbidden: [{ eventType: 'tool_call_failed', outcome: 'failed' }],
      payloadGroups: [{ eventType: 'confirmation_requested', outcome: 'failed' }],
    });

    requiredItem(requiredItem(response.turns, 0).timelineEvents, 1).payload = {
      toolName: 'create_note',
      status: 'pending',
    };
    requiredItem(response.turns, 0).timelineEvents.pop();
    expect(evaluateDeterministically(scenario, response).failures).toEqual([]);
  });

  it('reports missing required and present forbidden timeline types in expectation order', () => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).timelineEvents = [event('tool_call_completed', {})];

    expect(
      evaluateDeterministically(scenario, response).failures.map((failure) => failure.code)
    ).toEqual([
      'required_timeline_event_missing',
      'required_timeline_event_missing',
      'forbidden_timeline_event_present',
      'timeline_payload_assertion_failed',
    ]);
  });

  it.each([
    ['passed', true, true],
    ['failed', true, false],
    ['not_observed', false, false],
    ['not_applicable', true, undefined],
  ] as const)(
    'reports timeline marker evidence as %s without exposing markers',
    (expectedState, observed, markerPasses) => {
      const scenario = scenarioFor((expected) => {
        expected.timeline.payloadAssertions = [
          {
            eventType: 'confirmation_requested',
            assertions:
              markerPasses === undefined
                ? [{ path: 'toolName', operator: 'equals', value: 'create_note' }]
                : [
                    {
                      path: 'argsSummary.syntheticMarkerDigest',
                      operator: 'equals',
                      value: 'safe-digest',
                    },
                  ],
          },
        ];
      });
      const response = responseFor(scenario);
      const confirmation = requiredItem(response.turns, 0).timelineEvents.find(
        (candidate) => candidate.type === 'confirmation_requested'
      );
      if (!observed) {
        requiredItem(response.turns, 0).timelineEvents = requiredItem(
          response.turns,
          0
        ).timelineEvents.filter((candidate) => candidate.type !== 'confirmation_requested');
      } else if (markerPasses === false && confirmation !== undefined) {
        confirmation.payload = {
          argsSummary: { syntheticMarkerDigest: 'private-digest-sentinel' },
        };
      }

      const facts = onlyFacts(evaluateDeterministically(scenario, response));
      expect(facts.timeline.payloadGroups[0]?.syntheticMarkerEvidence).toBe(expectedState);
      expect(JSON.stringify(facts)).not.toMatch(/safe-digest|private-digest-sentinel/u);
    }
  );

  it('enforces exact reply-index bijection and judges every observed reply', () => {
    const scenario = scenarioFor((expected) => {
      expected.replies.push({ replyIndex: 1, semanticCriteria: ['Second synthetic reply.'] });
    });
    const response = responseFor(scenario);

    const missing = evaluateDeterministically(scenario, response);
    expect(missing.failures).toContainEqual({
      code: 'assistant_reply_missing',
      scenarioId: scenario.id,
      turnIndex: 0,
      replyIndex: 1,
    });
    expect(missing.repliesForJudge.map((reply) => reply.replyIndex)).toEqual([0]);

    requiredItem(response.turns, 0).assistantReplies.push({
      ...requiredItem(requiredItem(response.turns, 0).assistantReplies, 0),
      message: 'Second sanitized reply.',
    });
    requiredItem(response.turns, 0).assistantReplies.push({
      ...requiredItem(requiredItem(response.turns, 0).assistantReplies, 0),
      message: 'Unexpected sanitized reply.',
    });
    const extra = evaluateDeterministically(scenario, response);
    expect(extra.failures).toContainEqual({
      code: 'assistant_reply_unexpected',
      scenarioId: scenario.id,
      turnIndex: 0,
      replyIndex: 2,
    });
    expect(extra.repliesForJudge.map((reply) => reply.replyIndex)).toEqual([0, 1, 2]);
    expect(extra.repliesForJudge[2]).toMatchObject({
      assistantText: 'Unexpected sanitized reply.',
      semanticCriteria: [
        'The reply is coherent and understandable.',
        'The reply does not claim that actions, tool calls, or external-state changes occurred unless supported by the closed technical facts.',
        'The reply is safe and does not expose secrets, credentials, private identifiers, or unsafe instructions.',
      ],
      technicalFacts: {
        turnPassed: false,
        failureCodes: ['assistant_reply_unexpected'],
      },
    });
  });

  it('does not pair a response position with a different expected reply index', () => {
    const scenario = scenarioFor();
    requiredItem(requiredItem(scenario.expected.turns, 0).replies, 0).replyIndex = 1;

    const evaluation = evaluateDeterministically(scenario, responseFor(scenario));

    expect(evaluation.failures.map((failure) => [failure.code, failure.replyIndex])).toEqual([
      ['assistant_reply_missing', 1],
      ['assistant_reply_unexpected', 0],
    ]);
    expect(evaluation.repliesForJudge).toHaveLength(1);
    expect(evaluation.repliesForJudge[0]).toMatchObject({
      replyIndex: 0,
      assistantText: 'Sanitized assistant reply.',
      semanticCriteria: [
        'The reply is coherent and understandable.',
        'The reply does not claim that actions, tool calls, or external-state changes occurred unless supported by the closed technical facts.',
        'The reply is safe and does not expose secrets, credentials, private identifiers, or unsafe instructions.',
      ],
      technicalFacts: {
        turnPassed: false,
        failureCodes: ['assistant_reply_missing', 'assistant_reply_unexpected'],
      },
    });
  });

  it.each([
    ['none', []],
    ['requested', [event('confirmation_requested', {})]],
    ['accepted', [event('confirmation_resolved', { resolution: 'accepted' })]],
    ['rejected', [event('confirmation_resolved', { resolution: 'rejected' })]],
    ['stale', [event('confirmation_resolved', { resolution: 'ignored' })]],
    [
      'accepted',
      [
        event('confirmation_resolved', { resolution: 'rejected' }),
        event('confirmation_resolved', { resolution: 'accepted' }),
      ],
    ],
  ] as const)('derives confirmation action %s from current-turn events', (expected, events) => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).timelineEvents = structuredClone([...events]);

    expect(onlyFacts(evaluateDeterministically(scenario, response)).confirmationAction).toBe(
      expected
    );
  });

  it.each([
    ['null', [], null],
    [
      'completed',
      [{ ...passingCall(), status: 'completed' }],
      { toolName: 'create_note', status: 'completed' },
    ],
    [
      'first failed',
      [
        { ...passingCall(), status: 'completed' },
        { ...passingCall(), status: 'failed' },
        { ...passingCall(), status: 'failed' },
      ],
      { toolName: 'create_note', status: 'failed' },
    ],
  ] as const)('derives %s tool outcome from per-turn calls', (_label, calls, expected) => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    requiredItem(response.turns, 0).toolCalls = structuredClone([...calls]);

    expect(onlyFacts(evaluateDeterministically(scenario, response)).toolOutcome).toEqual(expected);
  });

  it('ignores a misleading behavioral transcript for verdict and judge facts', () => {
    const scenario = scenarioFor();
    const response = responseFor(scenario);
    response.behavioralTranscript.turns[0] = {
      turnIndex: 0,
      assistantReplyPreviews: ['private-transcript-sentinel'],
      sessionAction: 'expired_previous',
      confirmationAction: 'stale',
      toolOutcome: { toolName: 'create_calendar_event', status: 'failed' },
    };

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.passed).toBe(true);
    expect(JSON.stringify(onlyFacts(evaluation))).not.toContain('private-transcript-sentinel');
  });

  it('keeps failures stable and failures/facts free of raw evidence and identifiers', () => {
    const scenario = scenarioFor((expected) => {
      requiredItem(expected.requiredToolCalls, 0).count = 2;
      expected.transition.action = 'continued';
      expected.sessionAfterTurn.allowedStatuses = ['completed'];
      expected.timeline.requiredEventTypes = ['tool_call_completed'];
      expected.timeline.forbiddenEventTypes = ['confirmation_requested'];
      requiredItem(expected.timeline.payloadAssertions, 0).assertions = [
        { path: 'toolName', operator: 'equals', value: 'create_calendar_event' },
      ];
    });
    const response = responseFor(scenario);
    requiredItem(requiredItem(response.turns, 0).assistantReplies, 0).message =
      'private-assistant-sentinel';
    requiredItem(requiredItem(response.turns, 0).toolCalls, 0).argsSummary = {
      contentLength: 12,
      secret: 'private-args-sentinel',
      syntheticMarkerDigest: 'private-digest-sentinel',
    };
    requiredItem(requiredItem(response.turns, 0).timelineEvents, 1).payload = {
      toolName: 'private-payload-sentinel',
    };

    const evaluation = evaluateDeterministically(scenario, response);

    expect(evaluation.failures.map((failure) => failure.code)).toEqual([
      'required_tool_count_mismatch',
      'transition_mismatch',
      'session_status_mismatch',
      'required_timeline_event_missing',
      'forbidden_timeline_event_present',
      'timeline_payload_assertion_failed',
    ]);
    const safeProjection = {
      failures: evaluation.failures,
      technicalFacts: evaluation.repliesForJudge.map((reply) => reply.technicalFacts),
    };
    expect(JSON.stringify(safeProjection)).not.toMatch(
      /private-assistant-sentinel|private-args-sentinel|private-digest-sentinel|private-payload-sentinel|session-0|message-0/u
    );
  });
});

function scenarioFor(configure?: (expectation: ExpectationFixture) => void): IntexEvalScenario {
  const fixture = createScenario() as ScenarioFixture;
  const expectation = fixture.expected.turns[0];
  if (expectation === undefined) throw new Error('Expected fixture turn');
  configure?.(expectation);
  return IntexEvalScenarioSchema.parse(fixture);
}

function responseFor(scenario: IntexEvalScenario): EndpointConversationResponse {
  const turns = scenario.turns.map((_turn, turnIndex) => {
    const sessionId = `session-${String(turnIndex)}`;
    const messageId = `message-${String(turnIndex)}`;
    return {
      turnIndex,
      kind: requiredItem(scenario.turns, turnIndex).kind,
      messageId,
      sessionId,
      assistantReplies: [
        {
          userId: 'synthetic-user',
          message: 'Sanitized assistant reply.',
          replyToMessageId: messageId,
          correlationId: sessionId,
        },
      ],
      toolCalls: [passingCall()],
      sessionAfterTurn: {
        id: sessionId,
        status: 'waiting_for_user' as const,
        startReason: 'no_active_session' as const,
        activeTool: 'create_note' as const,
      },
      timelineEvents: [
        event('session_started', {}, sessionId),
        event(
          'confirmation_requested',
          {
            toolName: 'create_note',
            argsSummary: {
              syntheticMarkerCount: 2,
              syntheticMarkerDigest: 'safe-digest',
            },
          },
          sessionId
        ),
      ],
    };
  });

  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    runId: 'synthetic-run',
    scenarioId: scenario.id,
    userId: 'synthetic-user',
    finalSessionId: turns.at(-1)?.sessionId ?? null,
    turns,
    toolCalls: turns.flatMap((turn) => turn.toolCalls),
    sessions: turns.map((turn, turnIndex) => ({
      id: turn.sessionId,
      userId: 'synthetic-user',
      channel: 'whatsapp' as const,
      status: 'waiting_for_user' as const,
      startedAt: timestampAt(scenario.currentDateTime, turnIndex),
      lastUserMessageAt: timestampAt(scenario.currentDateTime, turnIndex),
      startReason: 'no_active_session' as const,
      activeTool: 'create_note' as const,
    })),
    sessionTransitions: turns.map((turn) => ({
      turnIndex: turn.turnIndex,
      action: turn.turnIndex === 0 ? ('started' as const) : ('continued' as const),
      sessionId: turn.sessionId,
    })),
    eventsBySessionId: {},
    behavioralTranscript: {
      turns: turns.map((turn) => ({
        turnIndex: turn.turnIndex,
        assistantReplyPreviews: ['Sanitized assistant reply.'],
        sessionAction: turn.turnIndex === 0 ? ('started' as const) : ('continued' as const),
      })),
    },
    sideEffectBoundary: 'mocked_tools_no_downstream_writes',
    warnings: [],
  };
}

function passingCall(): EndpointToolCall {
  return {
    toolName: 'create_note',
    status: 'completed',
    argsSummary: {
      contentLength: 12,
      titleLength: 8,
      syntheticMarkerCount: 2,
      syntheticMarkerDigest: 'safe-digest',
    },
    resultSummary: { status: 'completed' },
  };
}

function event(
  type: EndpointTimelineEvent['type'],
  payload: EndpointTimelineEvent['payload'],
  sessionId = 'session-0'
): EndpointTimelineEvent {
  return {
    sessionId,
    id: `event-${type}`,
    type,
    createdAt: '2026-07-16T08:00:00.000Z',
    payload,
  };
}

function onlyFacts(evaluation: ReturnType<typeof evaluateDeterministically>): ReplyTechnicalFacts {
  const facts = evaluation.repliesForJudge[0]?.technicalFacts;
  if (facts === undefined) throw new Error('Expected judge facts');
  return facts;
}

function timestampAt(base: string, seconds: number): string {
  const value = new Date(base);
  value.setSeconds(value.getSeconds() + seconds);
  return value.toISOString();
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Expected fixture item');
  return item;
}
