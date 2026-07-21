import { describe, expect, it } from 'vitest';

import {
  decodeTestRunDtoV1,
  decodeTestRunListDtoV1,
  decodeTestScenarioDtoV1,
} from '../intexAgentTestRunsDecoder.js';

const startedAt = '2026-07-20T10:00:00.000Z';

function scenario(number: number): Record<string, unknown> {
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
    startedAt: number === 1 ? startedAt : null,
    finishedAt: null,
    durationMs: null,
  };
}

function runHeader(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    revision: 2,
    corpusId: 'intex_agent_matrix_corpus',
    corpusVersion: '2026-07-20',
    transport: 'matrix_whatsapp',
    executionMode: 'strict_mock_tools',
    lifecycle: 'running',
    verdict: 'pending',
    artifactDelivery: { status: 'pending', failureCode: null, updatedAt: startedAt },
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    startedAt,
    updatedAt: startedAt,
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
      turns: { planned: 59, completed: 1 },
      replies: { expected: 59, observed: 1, judged: 1 },
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
  };
}

function runDto(): Record<string, unknown> {
  return {
    run: runHeader(),
    scenarios: Array.from({ length: 20 }, (_, index) => scenario(index + 1)),
  };
}

function scenarioDto(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    runRevision: 2,
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    scenario: scenario(1),
    eventWatermark: 4,
    timeline: [
      {
        type: 'user_message',
        timelineIndex: 0,
        eventSequence: 1,
        turnIndex: 0,
        text: 'Create a note about the launch.',
        createdAt: startedAt,
      },
      {
        type: 'tool_selected',
        timelineIndex: 1,
        eventSequence: 2,
        turnIndex: 0,
        ordinal: 1,
        toolName: 'create_note',
        facts: [{ name: 'contentLength', value: 22 }],
        createdAt: startedAt,
      },
      {
        type: 'mock_completed',
        timelineIndex: 2,
        eventSequence: 3,
        turnIndex: 0,
        ordinal: 1,
        toolName: 'create_note',
        facts: [{ name: 'titleLength', value: 6 }],
        createdAt: startedAt,
      },
      {
        type: 'assistant_message',
        timelineIndex: 3,
        eventSequence: 4,
        turnIndex: 0,
        replyIndex: 1,
        text: 'The note is ready.',
        createdAt: startedAt,
      },
      {
        type: 'deterministic_evaluation',
        timelineIndex: 4,
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
        ],
      },
      {
        type: 'minimax_evaluation',
        timelineIndex: 5,
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
  };
}

describe('Intex Agent Test Runs response decoder', () => {
  it('accepts the exact bounded list, run, and scenario DTOs', () => {
    expect(decodeTestRunListDtoV1({ runs: [runHeader()] })).toEqual({ runs: [runHeader()] });
    expect(decodeTestRunDtoV1(runDto())).toEqual(runDto());
    expect(decodeTestScenarioDtoV1(scenarioDto())).toEqual(scenarioDto());
  });

  it.each([
    ['private owner', { ...runHeader(), userId: 'private-user' }],
    ['private session binding', { ...scenarioDto(), sessionId: 'private-session' }],
    ['unknown nested run field', { ...runHeader(), cost: { ...(runHeader()['cost'] as object), rawUsd: 1 } }],
  ])('fails closed for %s', (_name, privateValue) => {
    const decode = Object.hasOwn(privateValue, 'runId') && Object.hasOwn(privateValue, 'timeline')
      ? decodeTestScenarioDtoV1
      : decodeTestRunListDtoV1;
    const value = decode === decodeTestRunListDtoV1 ? { runs: [privateValue] } : privateValue;
    expect(() => decode(value)).toThrow('Invalid Test Runs response');
  });

  it.each([
    ['unsafe revision', { ...runHeader(), revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['unknown lifecycle', { ...runHeader(), lifecycle: 'queued' }],
    ['over-bound run list', { runs: [runHeader(), runHeader(), runHeader()] }],
  ])('rejects %s', (_name, invalid) => {
    const value = Object.hasOwn(invalid, 'runs') ? invalid : { runs: [invalid] };
    expect(() => decodeTestRunListDtoV1(value)).toThrow('Invalid Test Runs response');
  });

  it('rejects reordered scenarios and non-contiguous timeline indexes', () => {
    const reordered = runDto();
    (reordered['scenarios'] as unknown[]).reverse();
    expect(() => decodeTestRunDtoV1(reordered)).toThrow('Invalid Test Runs response');

    const nonContiguous = scenarioDto();
    const timeline = nonContiguous['timeline'] as Record<string, unknown>[];
    timeline[1] = { ...timeline[1], timelineIndex: 9 };
    expect(() => decodeTestScenarioDtoV1(nonContiguous)).toThrow('Invalid Test Runs response');
  });
});
