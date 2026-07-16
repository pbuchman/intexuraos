interface AssertionFixture {
  path: string;
  operator: string;
  value?: null | boolean | number | string;
}

interface ToolCallFixture {
  toolName: string;
  count: number;
  argumentAssertions: AssertionFixture[];
}

interface TransitionFixture {
  action: string;
  previousEndReason?: string;
}

interface SessionFixture {
  allowedStatuses: string[];
  startReason?: string;
  endReason?: string;
  activeTool?: string;
}

interface TimelinePayloadFixture {
  eventType: string;
  assertions: AssertionFixture[];
}

interface TimelineFixture {
  requiredEventTypes: string[];
  forbiddenEventTypes: string[];
  payloadAssertions: TimelinePayloadFixture[];
}

interface ReplyFixture {
  replyIndex: number;
  semanticCriteria: string[];
}

export interface ExpectationFixture {
  turnIndex: number;
  requiredToolCalls: ToolCallFixture[];
  forbiddenToolCalls: string[];
  transition: TransitionFixture;
  sessionAfterTurn: SessionFixture;
  timeline: TimelineFixture;
  replies: ReplyFixture[];
}

export interface TurnFixture {
  kind: string;
  text?: string;
  sourceType?: string;
  previousTurnIndex?: number;
  decision?: string;
}

export interface ScenarioFixture {
  schemaVersion: string;
  id: string;
  title: string;
  description: string;
  currentDateTime: string;
  timeZone: string;
  turns: TurnFixture[];
  expected: { turns: ExpectationFixture[] };
}

export function createExpectation(turnIndex: number): ExpectationFixture {
  return {
    turnIndex,
    requiredToolCalls: [
      {
        toolName: 'create_note',
        count: 1,
        argumentAssertions: [{ path: 'contentLength', operator: 'exists' }],
      },
    ],
    forbiddenToolCalls: ['create_calendar_event'],
    transition: { action: turnIndex === 0 ? 'started' : 'continued' },
    sessionAfterTurn: {
      allowedStatuses: ['waiting_for_user'],
      startReason: 'no_active_session',
      activeTool: 'create_note',
    },
    timeline: {
      requiredEventTypes: ['session_started', 'confirmation_requested'],
      forbiddenEventTypes: ['tool_call_completed'],
      payloadAssertions: [
        {
          eventType: 'confirmation_requested',
          assertions: [{ path: 'toolName', operator: 'equals', value: 'create_note' }],
        },
      ],
    },
    replies: [
      {
        replyIndex: 0,
        semanticCriteria: ['Asks the user to confirm the synthetic note.'],
      },
    ],
  };
}

export function createScenario(turnCount = 1, id = 'intex-eval-001'): ScenarioFixture {
  const turns = Array.from({ length: turnCount }, (_, index) => ({
    kind: 'message',
    text: `Create synthetic note INTEX-EVAL-001 fragment ${String(index)}.`,
    sourceType: 'whatsapp_text',
  }));

  return {
    schemaVersion: '1',
    id,
    title: 'Synthetic note scenario',
    description: 'Validates a synthetic note confirmation without real identity data.',
    currentDateTime: '2026-07-16T10:00:00+02:00',
    timeZone: 'Europe/Warsaw',
    turns,
    expected: {
      turns: Array.from({ length: turnCount }, (_, index) => createExpectation(index)),
    },
  };
}

export function createConfirmationScenario(): ScenarioFixture {
  const scenario = createScenario(2);
  scenario.turns[1] = {
    kind: 'confirmation_button',
    previousTurnIndex: 0,
    decision: 'accept',
  };
  return scenario;
}
