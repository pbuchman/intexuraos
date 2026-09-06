import type {
  PublicTestRunHeaderV1,
  PublicTestRunScenarioSummaryV1,
  TestRunDtoV1,
  TestScenarioDtoV1,
} from '@/types';

export const TEST_RUN_TIME = '2026-07-20T10:00:00.000Z';

export function testRunHeader(
  overrides: Partial<PublicTestRunHeaderV1> = {}
): PublicTestRunHeaderV1 {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    revision: 3,
    corpusId: 'matrix_corpus',
    corpusVersion: 'v1',
    transport: 'matrix_whatsapp',
    executionMode: 'strict_mock_tools',
    lifecycle: 'running',
    verdict: 'pending',
    artifactDelivery: { status: 'pending', failureCode: null, updatedAt: TEST_RUN_TIME },
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    startedAt: TEST_RUN_TIME,
    updatedAt: TEST_RUN_TIME,
    finishedAt: null,
    currentScenarioNumber: 1,
    totals: {
      scenarios: {
        planned: 20,
        started: 1,
        running: 1,
        completed: 0,
        passed: 0,
        failed: 0,
        notRun: 0,
      },
      turns: { planned: 60, completed: 1 },
      replies: { expected: 60, observed: 1, judged: 1 },
      tools: { selected: 1, mockCompleted: 1, mockFailed: 0, unexpectedKnown: 0 },
      evaluations: {
        deterministicPassed: 0,
        deterministicFailed: 0,
        minimaxPassed: 0,
        minimaxFailed: 0,
        pending: 20,
      },
    },
    cost: { agentNanoUsd: 100, evaluatorNanoUsd: 20, totalNanoUsd: 120 },
    ...overrides,
  };
}

export function testScenarioSummary(
  number: number,
  overrides: Partial<PublicTestRunScenarioSummaryV1> = {}
): PublicTestRunScenarioSummaryV1 {
  return {
    scenarioId: `scenario_${String(number).padStart(3, '0')}`,
    scenarioNumber: number,
    scenarioLabel: `Catalog label ${String(number)}`,
    scenarioRevision: 1,
    lifecycle: number === 1 ? 'running' : 'pending',
    verdict: 'pending',
    plannedTurns: 3,
    completedTurns: number === 1 ? 1 : 0,
    expectedReplies: 3,
    completedReplies: number === 1 ? 1 : 0,
    selectedTools: number === 1 ? ['create_note'] : [],
    deterministicVerdict: 'pending',
    semanticVerdict: 'pending',
    startedAt: number === 1 ? TEST_RUN_TIME : null,
    finishedAt: null,
    durationMs: null,
    ...overrides,
  };
}

export function testRunDto(overrides: Partial<TestRunDtoV1> = {}): TestRunDtoV1 {
  return {
    run: testRunHeader(),
    scenarios: Array.from({ length: 20 }, (_, index) => testScenarioSummary(index + 1)),
    ...overrides,
  };
}

export function testScenarioDto(
  overrides: Partial<TestScenarioDtoV1> = {}
): TestScenarioDtoV1 {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    runRevision: 3,
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    scenario: testScenarioSummary(1),
    eventWatermark: 6,
    timeline: [
      {
        type: 'user_message',
        timelineIndex: 0,
        eventSequence: 1,
        turnIndex: 0,
        text: 'Create a launch note.',
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'tool_selected',
        timelineIndex: 1,
        eventSequence: 2,
        turnIndex: 0,
        ordinal: 1,
        toolName: 'create_note',
        facts: [{ name: 'contentLength', value: 21 }],
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'confirmation_requested',
        timelineIndex: 2,
        eventSequence: 3,
        turnIndex: 0,
        toolName: 'create_note',
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'confirmation_resolved',
        timelineIndex: 3,
        eventSequence: 4,
        turnIndex: 0,
        toolName: 'create_note',
        resolution: 'confirmed',
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'mock_completed',
        timelineIndex: 4,
        eventSequence: 5,
        turnIndex: 0,
        ordinal: 1,
        toolName: 'create_note',
        facts: [{ name: 'titleLength', value: 11 }],
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'assistant_message',
        timelineIndex: 5,
        eventSequence: 6,
        turnIndex: 0,
        replyIndex: 1,
        text: 'The launch note is ready.',
        createdAt: TEST_RUN_TIME,
      },
      {
        type: 'deterministic_evaluation',
        timelineIndex: 6,
        verdict: 'passed',
        checks: [
          {
            code: 'tool_name',
            status: 'passed',
            turnIndex: 0,
            replyIndex: 1,
            evidence: {
              expectedToolName: 'create_note',
              actualToolName: 'create_note',
              expectedTurnIndex: null,
              actualTurnIndex: null,
              expectedCount: null,
              actualCount: null,
              expectedTransition: null,
              actualTransition: null,
              expectedFacts: [],
              actualFacts: [],
            },
          },
          {
            code: 'tool_fact',
            status: 'passed',
            turnIndex: 0,
            replyIndex: 1,
            evidence: {
              expectedToolName: 'create_note',
              actualToolName: 'create_note',
              expectedTurnIndex: null,
              actualTurnIndex: null,
              expectedCount: null,
              actualCount: null,
              expectedTransition: null,
              actualTransition: null,
              expectedFacts: [{ name: 'contentLength', operator: 'exists', value: null }],
              actualFacts: [{ name: 'contentLength', value: 21 }],
            },
          },
        ],
      },
      {
        type: 'minimax_evaluation',
        timelineIndex: 7,
        evaluatorModel: 'or:minimax/minimax-m3',
        evaluation: {
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
          latencyMs: 25,
          usage: {
            logicalCalls: 1,
            repairCount: 0,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            costNanoUsd: 20,
          },
        },
      },
    ],
    ...overrides,
  };
}
