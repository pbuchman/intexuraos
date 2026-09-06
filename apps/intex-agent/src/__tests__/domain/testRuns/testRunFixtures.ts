import {
  type SafeDeterministicEvidenceV1,
} from '@intexuraos/http-contracts';
import {
  deriveTestRunScenarioTotals,
  type IntexAgentTestRunRecordV1,
  type TestRunScenarioFoundationV1,
} from '../../../domain/testRuns/types.js';

export const testRunNow = '2026-07-20T10:00:00.000Z';

export function emptyDeterministicEvidence(): SafeDeterministicEvidenceV1 {
  return {
    expectedToolName: null,
    actualToolName: null,
    expectedTurnIndex: null,
    actualTurnIndex: null,
    expectedCount: null,
    actualCount: null,
    expectedTransition: null,
    actualTransition: null,
    expectedFacts: [],
    actualFacts: [],
  };
}

export function testRunRecord(
  overrides: Partial<IntexAgentTestRunRecordV1> = {}
): IntexAgentTestRunRecordV1 {
  const scenarios = overrides.scenarios ?? Array.from(
    { length: 20 },
    (_, index) => testRunScenario(index + 1)
  );
  const derived = deriveTestRunScenarioTotals(scenarios);
  return {
    schemaVersion: 1,
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    revision: 0,
    corpusId: 'intex-agent-matrix-corpus',
    corpusVersion: '2026-07-19',
    catalogDigest: 'a'.repeat(64),
    runtimeAudience: 'hetzner-prod',
    transport: 'matrix_whatsapp',
    executionMode: 'strict_mock_tools',
    lifecycle: 'preflight',
    verdict: 'pending',
    artifactDelivery: { status: 'pending', failureCode: null, updatedAt: testRunNow },
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    startedAt: testRunNow,
    updatedAt: testRunNow,
    finishedAt: null,
    currentScenarioNumber:
      scenarios.find((scenario) => scenario.lifecycle === 'running')?.scenarioNumber ?? null,
    totals: {
      ...derived,
      replies: { ...derived.replies, judged: 0 },
      tools: { selected: 0, mockCompleted: 0, mockFailed: 0, unexpectedKnown: 0 },
      evaluations: {
        deterministicPassed: 0,
        deterministicFailed: 0,
        minimaxPassed: 0,
        minimaxFailed: 0,
        pending: 20,
      },
    },
    cost: { agentNanoUsd: null, evaluatorNanoUsd: null, totalNanoUsd: null },
    retentionReconciled: true,
    contextFinalizationTombstoneDigest: null,
    artifactStageDigest: null,
    terminalCandidate: null,
    terminalWinner: null,
    scenarios,
    ...overrides,
  };
}

export function testRunScenario(
  scenarioNumber: number,
  overrides: Partial<TestRunScenarioFoundationV1> = {}
): TestRunScenarioFoundationV1 {
  return {
    scenarioId: `scenario_${String(scenarioNumber).padStart(3, '0')}`,
    scenarioNumber,
    scenarioLabel: `Scenario ${String(scenarioNumber).padStart(3, '0')}/020`,
    scenarioRevision: 0,
    eventWatermark: 0,
    lifecycle: 'not_run',
    verdict: 'pending',
    plannedTurns: 1,
    completedTurns: 0,
    expectedReplies: 1,
    completedReplies: 0,
    selectedTools: [],
    deterministicVerdict: 'pending',
    semanticVerdict: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    sessionId: null,
    sessionBindingDigest: null,
    ...overrides,
  };
}
