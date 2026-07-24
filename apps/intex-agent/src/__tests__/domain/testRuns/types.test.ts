import { describe, expect, it } from 'vitest';

import {
  deriveTestRunEvidenceTotals,
  isIntexAgentTestRunRecordV1,
  isScenarioProjectionEvidenceConsistent,
  isTerminalOutcomeCompatible,
  matrixCorpusTerminalCandidateV1Schema,
  testRunScenarioFoundationV1Schema,
  testRunScenarioProjectionV1Schema,
  type TestRunScenarioProjectionV1,
} from '../../../domain/testRuns/types.js';
import {
  emptyDeterministicEvidence,
  testRunRecord,
  testRunScenario,
} from './testRunFixtures.js';

describe('Intex Agent Test Run foundation types', () => {
  it('accepts a closed Home Dev preflight record with the mandatory models', () => {
    expect(isIntexAgentTestRunRecordV1(testRunRecord())).toBe(true);
  });

  it('accepts MiniMax M3 as the immutable agent model', () => {
    expect(
      isIntexAgentTestRunRecordV1(
        testRunRecord({ agentModel: 'or:minimax/minimax-m3' as never })
      )
    ).toBe(true);
  });

  it.each([
    ['wrong agent model', { agentModel: 'or:google/gemini-3-flash-preview' }],
    ['wrong evaluator model', { evaluatorModel: 'or:anthropic/claude-sonnet' }],
    ['wrong audience', { runtimeAudience: 'production' }],
    ['negative revision', { revision: -1 }],
    ['terminal preflight verdict', { verdict: 'passed' }],
    ['unexpected field', { privatePrompt: 'must never be stored' }],
  ])('rejects %s', (_name, change) => {
    expect(isIntexAgentTestRunRecordV1({ ...testRunRecord(), ...change })).toBe(false);
  });

  it('requires unique ordered scenario foundations and monotonic safe counters', () => {
    const scenarios = Array.from({ length: 20 }, (_, index) => testRunScenario(index + 1));
    expect(isIntexAgentTestRunRecordV1(testRunRecord({ scenarios }))).toBe(true);
    expect(
      isIntexAgentTestRunRecordV1(
        testRunRecord({
          scenarios: scenarios.map((scenario, index) =>
            index === 1 ? { ...scenario, scenarioId: 'scenario_001' } : scenario
          ),
        })
      )
    ).toBe(false);
    expect(
      isIntexAgentTestRunRecordV1(
        testRunRecord({
          scenarios: scenarios.map((scenario, index) =>
            index === 0 ? { ...scenario, eventWatermark: -1 } : scenario
          ),
        })
      )
    ).toBe(false);
  });

  it('requires a positive staged artifact revision in terminal candidates', () => {
    expect(
      matrixCorpusTerminalCandidateV1Schema.safeParse({
        version: 1,
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        outcome: 'completed_passed',
        projectionDigest: 'a'.repeat(64),
        artifactStageRevision: 0,
        artifactCandidateDigest: 'b'.repeat(64),
        createdAt: '2026-07-20T10:05:00.000Z',
      }).success
    ).toBe(false);
  });

  it('fails closed when evidence projections are duplicated, unknown, or disagree with summaries', () => {
    const scenario = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const projection: TestRunScenarioProjectionV1 = {
      schemaVersion: 1,
      runId: 'run_1',
      userId: 'auth0:user_1',
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      runRevision: 2,
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      verdict: 'pending',
      plannedTurns: 1,
      completedTurns: 0,
      toolEvidence: [],
      deterministicChecks: [],
      replyEvaluations: [],
      agentUsage: [],
    };

    expect(deriveTestRunEvidenceTotals([scenario], [projection])).not.toBeNull();
    expect(deriveTestRunEvidenceTotals([scenario], [projection, projection])).toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [scenario],
        [{ ...projection, scenarioId: 'scenario_unknown' }]
      )
    ).toBeNull();
    expect(
      deriveTestRunEvidenceTotals([scenario], [{ ...projection, eventWatermark: 0 }])
    ).toBeNull();
  });

  it('rejects completed pass summaries contradicted by deterministic or MiniMax evidence', () => {
    const completed = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'completed',
      verdict: 'passed',
      completedTurns: 1,
      completedReplies: 1,
      selectedTools: [],
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
      startedAt: '2026-07-20T10:00:00.000Z',
      finishedAt: '2026-07-20T10:01:00.000Z',
      durationMs: 60_000,
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const base = {
      ...projectionFixture(),
      lifecycle: 'completed' as const,
      verdict: 'passed' as const,
      completedTurns: 1,
      agentUsage: [
        {
          turnIndex: 0,
          stage: 'agent_generation' as const,
          callOrdinal: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costNanoUsd: 1,
        },
      ],
    };
    const evaluation = {
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
    const passedDeterministicCheck = {
      code: 'reply_count' as const,
      status: 'passed' as const,
      turnIndex: 0,
      replyIndex: 1,
      evidence: emptyDeterministicEvidence(),
    };
    const passedProjection = {
      ...base,
      deterministicChecks: [passedDeterministicCheck],
      replyEvaluations: [evaluation],
    };

    expect(deriveTestRunEvidenceTotals([completed], [passedProjection])).not.toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [completed],
        [
          {
            ...passedProjection,
            deterministicChecks: [{ ...passedDeterministicCheck, status: 'failed' as const }],
          },
        ]
      )
    ).toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [completed],
        [
          {
            ...passedProjection,
            replyEvaluations: [{ ...evaluation, verdict: 'failed' as const, score: 1 as const }],
          },
        ]
      )
    ).toBeNull();

    const failedEvaluation = {
      ...evaluation,
      verdict: 'failed' as const,
      score: 1 as const,
      criteria: { ...evaluation.criteria, understoodIntent: false },
      failureCodes: ['understoodIntent' as const],
    };
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completed, verdict: 'failed', deterministicVerdict: 'failed' }],
        [
          {
            ...passedProjection,
            verdict: 'failed',
            deterministicChecks: [{ ...passedDeterministicCheck, status: 'failed' }],
          },
        ]
      )
    ).not.toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completed, verdict: 'failed', semanticVerdict: 'failed' }],
        [{ ...passedProjection, verdict: 'failed', replyEvaluations: [failedEvaluation] }]
      )
    ).not.toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [completed],
        [
          {
            ...passedProjection,
            replyEvaluations: [evaluation, { ...evaluation, replyIndex: 2 }],
          },
        ]
      )
    ).toBeNull();
  });

  it('enforces atomic bindings and bounded turn counters while retaining extra replies as failure evidence', () => {
    const scenarios = Array.from({ length: 20 }, (_, index) => testRunScenario(index + 1));
    for (const invalidScenario of [
      { ...scenarios[0], sessionId: 'session_1', sessionBindingDigest: null },
      { ...scenarios[0], sessionId: null, sessionBindingDigest: '9'.repeat(64) },
      { ...scenarios[0], completedTurns: 2 },
    ])
      expect(
        isIntexAgentTestRunRecordV1(
          testRunRecord({
            scenarios: scenarios.map((scenario, index) =>
              index === 0 ? (invalidScenario as never) : scenario
            ),
          })
        )
      ).toBe(false);
    expect(
      isIntexAgentTestRunRecordV1(
        testRunRecord({
          scenarios: scenarios.map((scenario, index) =>
            index === 0 ? { ...scenario, completedReplies: 2 } : scenario
          ),
        })
      )
    ).toBe(true);
  });

  it('rejects a completed scenario without complete counts, terminal verdicts, and timestamps', () => {
    const scenarios = Array.from({ length: 20 }, (_, index) =>
      testRunScenario(
        index + 1,
        index === 0
          ? {
              lifecycle: 'completed',
              verdict: 'passed',
              deterministicVerdict: 'passed',
              semanticVerdict: 'passed',
              completedTurns: 0,
              completedReplies: 0,
            }
          : {}
      )
    );

    expect(isIntexAgentTestRunRecordV1(testRunRecord({ scenarios }))).toBe(false);
  });

  it('accepts a terminal failed scenario with partial turns only when deterministic evidence proves the blocker', () => {
    const failedCheck = {
      code: 'confirmation_count' as const,
      status: 'failed' as const,
      turnIndex: 1,
      replyIndex: null,
      evidence: {
        ...emptyDeterministicEvidence(),
        expectedCount: 1,
        actualCount: 0,
      },
    };
    const partialFailure = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'completed',
      verdict: 'failed',
      plannedTurns: 2,
      completedTurns: 1,
      expectedReplies: 2,
      completedReplies: 1,
      deterministicVerdict: 'failed',
      semanticVerdict: 'passed',
      startedAt: '2026-07-20T10:00:00.000Z',
      finishedAt: '2026-07-20T10:01:00.000Z',
      durationMs: 60_000,
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const partialProjection: TestRunScenarioProjectionV1 = {
      ...projectionFixture(),
      lifecycle: 'completed',
      verdict: 'failed',
      plannedTurns: 2,
      completedTurns: 1,
      deterministicChecks: [failedCheck],
      replyEvaluations: [
        {
          turnIndex: 0,
          replyIndex: 0,
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
          latencyMs: 1,
          usage: {
            logicalCalls: 1,
            repairCount: 0,
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            costNanoUsd: 1,
          },
        },
      ],
    };

    expect(testRunScenarioFoundationV1Schema.safeParse(partialFailure).success).toBe(true);
    expect(isScenarioProjectionEvidenceConsistent(partialFailure, partialProjection)).toBe(true);
    expect(
      isScenarioProjectionEvidenceConsistent(partialFailure, {
        ...partialProjection,
        deterministicChecks: [
          {
            ...failedCheck,
            code: 'reply_count',
            turnIndex: 0,
          },
        ],
      })
    ).toBe(false);
    expect(
      isTerminalOutcomeCompatible(
        [
          partialFailure,
          ...Array.from({ length: 19 }, (_, index) =>
            testRunScenario(index + 2, {
              lifecycle: 'completed',
              verdict: 'failed',
              completedTurns: 1,
              completedReplies: 1,
              deterministicVerdict: 'failed',
              semanticVerdict: 'not_evaluated',
              startedAt: '2026-07-20T10:00:00.000Z',
              finishedAt: '2026-07-20T10:01:00.000Z',
              durationMs: 60_000,
            })
          ),
        ],
        { agentNanoUsd: 1, evaluatorNanoUsd: 1, totalNanoUsd: 2 },
        'completed_failed'
      )
    ).toBe(true);
    expect(
      testRunScenarioFoundationV1Schema.safeParse({
        ...partialFailure,
        verdict: 'passed',
        deterministicVerdict: 'passed',
        semanticVerdict: 'passed',
      }).success
    ).toBe(false);
  });

  it('checks every completed-scenario verdict combination', () => {
    const completed = testRunScenario(1, {
      lifecycle: 'completed',
      verdict: 'passed',
      completedTurns: 1,
      completedReplies: 1,
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
      startedAt: '2026-07-20T10:00:00.000Z',
      finishedAt: '2026-07-20T10:01:00.000Z',
      durationMs: 60_000,
    });
    expect(testRunScenarioFoundationV1Schema.safeParse(completed).success).toBe(true);
    expect(
      testRunScenarioFoundationV1Schema.safeParse({
        ...completed,
        verdict: 'failed',
        deterministicVerdict: 'failed',
        semanticVerdict: 'not_evaluated',
      }).success
    ).toBe(true);
    for (const invalid of [
      { ...completed, verdict: 'pending' },
      { ...completed, deterministicVerdict: 'pending' },
      { ...completed, semanticVerdict: 'pending' },
      { ...completed, semanticVerdict: 'not_evaluated' },
      { ...completed, deterministicVerdict: 'failed' },
      { ...completed, semanticVerdict: 'failed' },
      { ...completed, verdict: 'failed' },
    ])
      expect(testRunScenarioFoundationV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('enforces every aggregate lifecycle, finalization, identity, current-scenario, and totals invariant', () => {
    const stoppedCandidate = {
      version: 1 as const,
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      outcome: 'stopped_not_evaluated' as const,
      projectionDigest: '1'.repeat(64),
      artifactStageRevision: 2,
      artifactCandidateDigest: '2'.repeat(64),
      createdAt: '2026-07-20T10:05:00.000Z',
    };
    const validFinalizing = testRunRecord({
      revision: 2,
      lifecycle: 'finalizing',
      artifactDelivery: {
        status: 'staged',
        failureCode: null,
        updatedAt: '2026-07-20T10:05:00.000Z',
      },
      contextFinalizationTombstoneDigest: '3'.repeat(64),
      artifactStageDigest: '2'.repeat(64),
      terminalCandidate: stoppedCandidate,
      updatedAt: '2026-07-20T10:05:00.000Z',
    });
    expect(isIntexAgentTestRunRecordV1(validFinalizing)).toBe(true);
    for (const invalid of [
      { ...validFinalizing, terminalCandidate: null },
      { ...validFinalizing, contextFinalizationTombstoneDigest: null },
      { ...validFinalizing, artifactStageDigest: null },
      {
        ...validFinalizing,
        artifactDelivery: { status: 'pending', failureCode: null, updatedAt: validFinalizing.updatedAt },
      },
      {
        ...validFinalizing,
        terminalCandidate: { ...stoppedCandidate, runId: 'run_other' },
      },
      {
        ...validFinalizing,
        terminalCandidate: { ...stoppedCandidate, userId: 'auth0:other' },
      },
      {
        ...validFinalizing,
        terminalCandidate: { ...stoppedCandidate, leaseFence: '8' },
      },
      {
        ...validFinalizing,
        terminalCandidate: { ...stoppedCandidate, outcome: 'completed_passed' },
      },
      { ...testRunRecord(), finishedAt: '2026-07-20T10:05:00.000Z' },
      {
        ...testRunRecord(),
        scenarios: Array.from({ length: 20 }, (_, index) =>
          testRunScenario(index + 1, index < 2 ? { lifecycle: 'running' } : {})
        ),
        currentScenarioNumber: 1,
      },
      { ...testRunRecord(), currentScenarioNumber: 1 },
      {
        ...testRunRecord(),
        totals: {
          ...testRunRecord().totals,
          scenarios: { ...testRunRecord().totals.scenarios, started: 1 },
        },
      },
      {
        ...testRunRecord(),
        totals: {
          ...testRunRecord().totals,
          turns: { ...testRunRecord().totals.turns, completed: 1 },
        },
      },
      {
        ...testRunRecord(),
        totals: {
          ...testRunRecord().totals,
          replies: { ...testRunRecord().totals.replies, observed: 1 },
        },
      },
    ])
      expect(isIntexAgentTestRunRecordV1(invalid)).toBe(false);
  });

  it('rejects unordered or duplicated evidence and projection turn overflow', () => {
    const projection = projectionFixture();
    const tool = {
      event: 'selected' as const,
      toolName: 'create_note' as const,
      turnIndex: 1,
      ordinal: 1,
      facts: [],
    };
    const deterministic = {
      code: 'tool_name' as const,
      status: 'passed' as const,
      turnIndex: 1,
      replyIndex: null,
      evidence: emptyDeterministicEvidence(),
    };
    const evaluation = {
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
    const usage = {
      turnIndex: 1,
      stage: 'agent_generation' as const,
      callOrdinal: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costNanoUsd: 1,
    };
    for (const invalid of [
      { ...projection, plannedTurns: 0, completedTurns: 1 },
      { ...projection, toolEvidence: [tool, tool] },
      { ...projection, deterministicChecks: [deterministic, deterministic] },
      { ...projection, replyEvaluations: [evaluation, evaluation] },
      { ...projection, agentUsage: [usage, usage] },
      { ...projection, toolEvidence: [{ ...tool, ordinal: 2 }, tool] },
      {
        ...projection,
        deterministicChecks: [
          deterministic,
          { ...deterministic, code: 'reply_count' as const },
        ],
      },
      {
        ...projection,
        replyEvaluations: [{ ...evaluation, replyIndex: 2 }, evaluation],
      },
      { ...projection, agentUsage: [{ ...usage, callOrdinal: 2 }, usage] },
    ])
      expect(testRunScenarioProjectionV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('derives incomplete and overflow cost states without unsafe arithmetic', () => {
    const baseScenario = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const baseProjection = projectionFixture();
    const completedScenario = { ...baseScenario, completedTurns: 1, completedReplies: 1 };
    const agentUsage = {
      turnIndex: 0,
      stage: 'agent_generation' as const,
      callOrdinal: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costNanoUsd: 1,
    };
    const evaluation = {
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
    expect(
      deriveTestRunEvidenceTotals(
        [completedScenario],
        [{ ...baseProjection, completedTurns: 1 }]
      )?.cost
    ).toEqual({ agentNanoUsd: null, evaluatorNanoUsd: null, totalNanoUsd: null });
    expect(
      deriveTestRunEvidenceTotals(
        [completedScenario],
        [{ ...baseProjection, completedTurns: 1, agentUsage: [agentUsage] }]
      )?.cost
    ).toEqual({ agentNanoUsd: 1, evaluatorNanoUsd: null, totalNanoUsd: null });
    const zeroAgentUsageCheck = {
      code: 'agent_usage_count' as const,
      status: 'passed' as const,
      turnIndex: 0,
      replyIndex: null,
      evidence: {
        ...emptyDeterministicEvidence(),
        expectedCount: 0,
        actualCount: 0,
      },
    };
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completedScenario, deterministicVerdict: 'passed' }],
        [
          {
            ...baseProjection,
            completedTurns: 1,
            deterministicChecks: [zeroAgentUsageCheck],
          },
        ]
      )?.cost
    ).toEqual({ agentNanoUsd: 0, evaluatorNanoUsd: null, totalNanoUsd: null });
    expect(
      deriveTestRunEvidenceTotals(
        [
          {
            ...completedScenario,
            verdict: 'failed',
            deterministicVerdict: 'failed',
            semanticVerdict: 'not_evaluated',
          },
        ],
        [
          {
            ...baseProjection,
            completedTurns: 1,
            verdict: 'failed',
            deterministicChecks: [{ ...zeroAgentUsageCheck, status: 'failed' as const }],
          },
        ]
      )?.cost
    ).toEqual({ agentNanoUsd: null, evaluatorNanoUsd: null, totalNanoUsd: null });
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completedScenario, semanticVerdict: 'passed' }],
        [
          {
            ...baseProjection,
            completedTurns: 1,
            agentUsage: [
              { ...agentUsage, costNanoUsd: Number.MAX_SAFE_INTEGER },
              { ...agentUsage, callOrdinal: 2, costNanoUsd: 1 },
            ],
            replyEvaluations: [evaluation],
          },
        ]
      )
    ).toBeNull();
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completedScenario, semanticVerdict: 'passed' }],
        [
          {
            ...baseProjection,
            completedTurns: 1,
            agentUsage: [{ ...agentUsage, costNanoUsd: Number.MAX_SAFE_INTEGER }],
            replyEvaluations: [evaluation],
          },
        ]
      )
    ).toBeNull();
    for (const invalidCost of [-1, 1.5]) {
      expect(
        deriveTestRunEvidenceTotals(
          [baseScenario],
          [
            {
              ...baseProjection,
              agentUsage: [{ ...agentUsage, costNanoUsd: invalidCost }],
            } as never,
          ]
        )
      ).toBeNull();
    }
    expect(
      deriveTestRunEvidenceTotals(
        [{ ...completedScenario, completedReplies: 2, semanticVerdict: 'passed' }],
        [
          {
            ...baseProjection,
            completedTurns: 1,
            agentUsage: [agentUsage],
            replyEvaluations: [
              { ...evaluation, usage: { ...evaluation.usage, costNanoUsd: Number.MAX_SAFE_INTEGER } },
              { ...evaluation, replyIndex: 2 },
            ],
          },
        ]
      )
    ).toBeNull();
  });

  it('derives selected-tool, not-evaluated, and pending evidence branches', () => {
    const running = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const base = projectionFixture();
    expect(
      isScenarioProjectionEvidenceConsistent(running, {
        ...base,
        toolEvidence: [
          {
            event: 'selected',
            toolName: 'create_note',
            turnIndex: 0,
            ordinal: 1,
            facts: [],
          },
        ],
      })
    ).toBe(false);

    const failedCheck = {
      code: 'reply_count' as const,
      status: 'failed' as const,
      turnIndex: 0,
      replyIndex: 1,
      evidence: emptyDeterministicEvidence(),
    };
    expect(
      isScenarioProjectionEvidenceConsistent(
        { ...running, deterministicVerdict: 'failed', semanticVerdict: 'not_evaluated' },
        { ...base, deterministicChecks: [failedCheck] }
      )
    ).toBe(true);

    const completedPending = {
      ...running,
      lifecycle: 'completed' as const,
      verdict: 'pending' as const,
      completedTurns: 1,
      deterministicVerdict: 'pending' as const,
      semanticVerdict: 'pending' as const,
      startedAt: '2026-07-20T10:00:00.000Z',
      finishedAt: '2026-07-20T10:01:00.000Z',
      durationMs: 60_000,
    };
    expect(
      isScenarioProjectionEvidenceConsistent(completedPending, {
        ...base,
        lifecycle: 'completed',
        verdict: 'pending',
        completedTurns: 1,
      })
    ).toBe(true);
  });

  it('distinguishes passed, failed, and stopped terminal evidence', () => {
    const complete = testRunScenario(1, {
      lifecycle: 'completed',
      verdict: 'passed',
      completedTurns: 1,
      completedReplies: 1,
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
    });
    const cost = { agentNanoUsd: 1, evaluatorNanoUsd: 1, totalNanoUsd: 2 };
    expect(isTerminalOutcomeCompatible([complete], cost, 'completed_passed')).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, verdict: 'failed', deterministicVerdict: 'failed' }],
        cost,
        'completed_failed'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [
          {
            ...complete,
            verdict: 'failed',
            deterministicVerdict: 'failed',
            semanticVerdict: 'not_evaluated',
          },
        ],
        cost,
        'completed_failed'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, verdict: 'passed', deterministicVerdict: 'failed' }],
        cost,
        'completed_failed'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, verdict: 'passed', semanticVerdict: 'failed' }],
        cost,
        'completed_failed'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, verdict: 'failed', semanticVerdict: 'failed' }],
        cost,
        'completed_failed'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, lifecycle: 'stopped', verdict: 'not_evaluated' }],
        { agentNanoUsd: null, evaluatorNanoUsd: null, totalNanoUsd: null },
        'stopped_not_evaluated'
      )
    ).toBe(true);
    expect(
      isTerminalOutcomeCompatible(
        [{ ...complete, lifecycle: 'running' }],
        cost,
        'stopped_not_evaluated'
      )
    ).toBe(false);
  });
});

function projectionFixture(): TestRunScenarioProjectionV1 {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    userId: 'auth0:user_1',
    sessionId: 'matrix_session_1',
    sessionBindingDigest: '9'.repeat(64),
    scenarioId: 'scenario_001',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario 001/020',
    runRevision: 2,
    scenarioRevision: 1,
    eventWatermark: 1,
    lifecycle: 'running',
    verdict: 'pending',
    plannedTurns: 1,
    completedTurns: 0,
    toolEvidence: [],
    deterministicChecks: [],
    replyEvaluations: [],
    agentUsage: [],
  };
}
