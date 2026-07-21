/* eslint-disable @typescript-eslint/explicit-function-return-type -- Contract fixtures preserve inferred literal types. */
import { describe, expect, it } from 'vitest';

import {
  INTEX_AGENT_TEST_RUN_SCENARIO_COUNT,
  publicTestRunHeaderV1Schema,
  safeAgentUsageV1Schema,
  safeDeterministicCheckV1Schema,
  safeExpectedToolFactV1Schema,
  safeReplyEvaluationV1Schema,
  safeToolEvidenceV1Schema,
  testArtifactDeliveryV1Schema,
  testRunDtoV1Schema,
  testScenarioDtoV1Schema,
} from '../index.js';

const now = '2026-07-20T10:00:00.000Z';

function totals() {
  return {
    scenarios: {
      planned: 20,
      started: 1,
      running: 1,
      completed: 0,
      passed: 0,
      failed: 0,
      notRun: 19,
    },
    turns: { planned: 20, completed: 1 },
    replies: { expected: 20, observed: 1, judged: 1 },
    tools: { selected: 1, mockCompleted: 1, mockFailed: 0, unexpectedKnown: 0 },
    evaluations: {
      deterministicPassed: 1,
      deterministicFailed: 0,
      minimaxPassed: 1,
      minimaxFailed: 0,
      pending: 19,
    },
  };
}

function scenarioSummary(scenarioNumber = 1) {
  return {
    scenarioId: `scenario_${String(scenarioNumber).padStart(3, '0')}`,
    scenarioNumber,
    scenarioLabel: `Natural catalog label ${String(scenarioNumber)}`,
    scenarioRevision: 1,
    lifecycle: scenarioNumber === 1 ? ('running' as const) : ('not_run' as const),
    verdict: 'pending' as const,
    plannedTurns: 1,
    completedTurns: scenarioNumber === 1 ? 1 : 0,
    expectedReplies: 1,
    completedReplies: scenarioNumber === 1 ? 1 : 0,
    selectedTools: scenarioNumber === 1 ? (['create_note'] as const) : [],
    deterministicVerdict: 'pending' as const,
    semanticVerdict: 'pending' as const,
    startedAt: scenarioNumber === 1 ? now : null,
    finishedAt: null,
    durationMs: null,
  };
}

function header() {
  return {
    schemaVersion: 1 as const,
    runId: 'run_1',
    revision: 2,
    corpusId: 'intex-agent-matrix-corpus',
    corpusVersion: '2026-07-19',
    transport: 'matrix_whatsapp' as const,
    executionMode: 'strict_mock_tools' as const,
    lifecycle: 'running' as const,
    verdict: 'pending' as const,
    artifactDelivery: { status: 'pending' as const, failureCode: null, updatedAt: now },
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    currentScenarioNumber: 1,
    totals: totals(),
    cost: { agentNanoUsd: 123, evaluatorNanoUsd: 45, totalNanoUsd: 168 },
  };
}

describe('Intex Agent Test Runs public contracts', () => {
  it('keeps the corpus and evidence bounds explicit', () => {
    expect(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT).toBe(20);
    expect(
      testRunDtoV1Schema.parse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => scenarioSummary(index + 1)),
      }).scenarios
    ).toHaveLength(20);

    const toolEvidence = {
      event: 'selected' as const,
      toolName: 'create_note' as const,
      turnIndex: 19,
      ordinal: 20,
      facts: [],
    };
    expect(safeToolEvidenceV1Schema.safeParse(toolEvidence).success).toBe(true);
    expect(safeToolEvidenceV1Schema.safeParse({ ...toolEvidence, turnIndex: 20 }).success).toBe(
      false
    );
    expect(safeToolEvidenceV1Schema.safeParse({ ...toolEvidence, ordinal: 21 }).success).toBe(
      false
    );

    const check = {
      code: 'tool_name' as const,
      status: 'passed' as const,
      turnIndex: 19,
      replyIndex: 1,
      evidence: {
        expectedToolName: 'create_note' as const,
        actualToolName: 'create_note' as const,
        expectedTurnIndex: null,
        actualTurnIndex: null,
        expectedCount: null,
        actualCount: null,
        expectedTransition: null,
        actualTransition: null,
        expectedFacts: [],
        actualFacts: [],
      },
    };
    expect(safeDeterministicCheckV1Schema.safeParse(check).success).toBe(true);
    expect(safeDeterministicCheckV1Schema.safeParse({ ...check, turnIndex: 20 }).success).toBe(
      false
    );
    expect(
      safeDeterministicCheckV1Schema.safeParse({
        ...check,
        evidence: { ...check.evidence, privateArgument: 'do not expose' },
      }).success
    ).toBe(false);

    const evaluation = {
      turnIndex: 19,
      replyIndex: 1,
      verdict: 'passed' as const,
      score: 5 as const,
      criteria: {
        understoodIntent: true,
        helpful: true,
        conciseAndClear: true,
        professionalTone: true,
        noPassiveAggression: true,
      },
      failureCodes: [],
      latencyMs: 1,
      usage: {
        logicalCalls: 1 as const,
        repairCount: 0 as const,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    };
    expect(safeReplyEvaluationV1Schema.safeParse(evaluation).success).toBe(true);
    expect(safeReplyEvaluationV1Schema.safeParse({ ...evaluation, turnIndex: 20 }).success).toBe(
      false
    );

    const usage = {
      turnIndex: 19,
      stage: 'agent_generation' as const,
      callOrdinal: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costNanoUsd: 1,
    };
    expect(safeAgentUsageV1Schema.safeParse(usage).success).toBe(true);
    expect(safeAgentUsageV1Schema.safeParse({ ...usage, turnIndex: 20 }).success).toBe(false);
  });

  it('requires values only for equality tool-fact expectations', () => {
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'equals',
        value: 12,
      }).success
    ).toBe(true);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'equals',
        value: null,
      }).success
    ).toBe(false);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'exists',
        value: null,
      }).success
    ).toBe(true);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'absent',
        value: 12,
      }).success
    ).toBe(false);
  });

  it('accepts only the closed artifact-delivery states', () => {
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'ready',
        failureCode: null,
        updatedAt: now,
      }).success
    ).toBe(true);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'failed',
        failureCode: 'REPORT_PUBLICATION_FAILED',
        updatedAt: now,
      }).success
    ).toBe(true);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'pending',
        failureCode: 'REPORT_STAGING_FAILED',
        updatedAt: now,
      }).success
    ).toBe(false);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'failed',
        failureCode: 'RAW_PROVIDER_ERROR',
        updatedAt: now,
      }).success
    ).toBe(false);
  });

  it('rejects private and unknown fields recursively', () => {
    expect(
      publicTestRunHeaderV1Schema.safeParse({ ...header(), userId: 'private-user' }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => ({
          ...scenarioSummary(index + 1),
          sessionId: 'private-session',
        })),
      }).success
    ).toBe(false);
  });

  it('accepts the closed safe timeline and rejects raw payloads or judge rationale', () => {
    const dto = {
      schemaVersion: 1 as const,
      runId: 'run_1',
      runRevision: 2,
      agentModel: 'or:deepseek/deepseek-v4-flash' as const,
      evaluatorModel: 'or:minimax/minimax-m3' as const,
      scenario: scenarioSummary(),
      eventWatermark: 3,
      timeline: [
        {
          type: 'user_message' as const,
          timelineIndex: 0,
          eventSequence: 1,
          turnIndex: 1,
          text: 'Natural message',
          createdAt: now,
        },
        {
          type: 'tool_selected' as const,
          timelineIndex: 1,
          eventSequence: 2,
          turnIndex: 1,
          ordinal: 1,
          toolName: 'create_note' as const,
          facts: [{ name: 'contentLength' as const, value: 12 }],
          createdAt: now,
        },
        {
          type: 'minimax_evaluation' as const,
          timelineIndex: 2,
          evaluatorModel: 'or:minimax/minimax-m3' as const,
          evaluation: {
            turnIndex: 1,
            replyIndex: 1,
            verdict: 'passed' as const,
            score: 5 as const,
            criteria: {
              understoodIntent: true,
              helpful: true,
              conciseAndClear: true,
              professionalTone: true,
              noPassiveAggression: true,
            },
            failureCodes: [],
            latencyMs: 15,
            usage: {
              logicalCalls: 1 as const,
              repairCount: 0 as const,
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              costNanoUsd: 2,
            },
          },
        },
      ],
    };
    expect(testScenarioDtoV1Schema.safeParse(dto).success).toBe(true);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [{ ...dto.timeline[0], payload: { capability: 'secret' } }],
      }).success
    ).toBe(false);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [{ ...dto.timeline[2], rationale: 'private model reasoning' }],
      }).success
    ).toBe(false);

    const replyEvaluation = dto.timeline[2];
    if (replyEvaluation === undefined) throw new Error('Test fixture is missing reply evaluation');
    const sixthReplyEvaluation = {
      ...replyEvaluation,
      evaluation: { ...replyEvaluation.evaluation, replyIndex: 6 },
    };
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [sixthReplyEvaluation],
      }).success
    ).toBe(false);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [
          {
            type: 'assistant_message',
            timelineIndex: 0,
            eventSequence: 1,
            turnIndex: 1,
            replyIndex: 6,
            text: 'Sixth reply',
            createdAt: now,
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects unsafe counters, duplicate tools, inconsistent cost, and non-contiguous timeline indexes', () => {
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        totals: { ...totals(), turns: { planned: Number.MAX_SAFE_INTEGER + 1, completed: 1 } },
      }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) =>
          index === 0
            ? { ...scenarioSummary(1), selectedTools: ['create_note', 'create_note'] }
            : scenarioSummary(index + 1)
        ),
      }).success
    ).toBe(false);
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        cost: { agentNanoUsd: 1, evaluatorNanoUsd: 2, totalNanoUsd: 4 },
      }).success
    ).toBe(false);
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        cost: { agentNanoUsd: null, evaluatorNanoUsd: 2, totalNanoUsd: 2 },
      }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => ({
          ...scenarioSummary(index + 1),
          ...(index === 1 ? { scenarioId: scenarioSummary(1).scenarioId } : {}),
        })),
      }).success
    ).toBe(false);
  });

  it('requires MiniMax verdict, criteria, and failure codes to describe one result', () => {
    const passed = {
      turnIndex: 0,
      replyIndex: 1,
      verdict: 'passed' as const,
      score: 5 as const,
      criteria: {
        understoodIntent: true,
        helpful: true,
        conciseAndClear: true,
        professionalTone: true,
        noPassiveAggression: true,
      },
      failureCodes: [],
      latencyMs: 1,
      usage: {
        logicalCalls: 1 as const,
        repairCount: 0 as const,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    };
    const failed = {
      ...passed,
      verdict: 'failed' as const,
      score: 1 as const,
      criteria: { ...passed.criteria, helpful: false },
      failureCodes: ['helpful' as const],
    };

    expect(safeReplyEvaluationV1Schema.safeParse(passed).success).toBe(true);
    expect(safeReplyEvaluationV1Schema.safeParse(failed).success).toBe(true);
    expect(
      safeReplyEvaluationV1Schema.safeParse({
        ...passed,
        criteria: { ...passed.criteria, helpful: false },
        failureCodes: ['helpful'],
      }).success
    ).toBe(false);
    expect(safeReplyEvaluationV1Schema.safeParse({ ...failed, failureCodes: [] }).success).toBe(
      false
    );
    expect(
      safeReplyEvaluationV1Schema.safeParse({
        ...failed,
        criteria: passed.criteria,
        failureCodes: [],
      }).success
    ).toBe(false);
  });
});
