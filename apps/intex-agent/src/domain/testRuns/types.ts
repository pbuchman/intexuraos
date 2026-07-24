import {
  INTEX_AGENT_TEST_RUN_MAX_AGENT_USAGE,
  INTEX_AGENT_TEST_RUN_MAX_DETERMINISTIC_CHECKS,
  INTEX_AGENT_TEST_RUN_MAX_REPLY_EVALUATIONS,
  INTEX_AGENT_TEST_RUN_MAX_TOOL_EVIDENCE,
  INTEX_AGENT_TEST_RUN_SCENARIO_COUNT,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusAgentModelSchema,
  matrixCorpusEvaluatorModelSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusRuntimeAudienceSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  publicTestRunScenarioSummaryV1Schema,
  safeAgentUsageV1Schema,
  safeDeterministicCheckV1Schema,
  safeReplyEvaluationV1Schema,
  safeToolEvidenceV1Schema,
  testArtifactDeliveryV1Schema,
  testRunCostV1Schema,
  testRunLifecycleSchema,
  testRunTotalsV1Schema,
  testScenarioLifecycleSchema,
  testVerdictSchema,
  type PublicTestRunScenarioSummaryV1,
  type SafeAgentUsageV1,
  type SafeDeterministicCheckV1,
  type SafeReplyEvaluationV1,
  type SafeToolEvidenceV1,
  type TestArtifactDeliveryV1,
  type TestRunCostV1,
  type TestRunLifecycle,
  type TestRunTotalsV1,
  type TestScenarioLifecycle,
  type TestVerdict,
} from '@intexuraos/http-contracts';
import { z } from 'zod';

export {
  testArtifactDeliveryV1Schema,
  testRunLifecycleSchema,
  testScenarioLifecycleSchema,
  testVerdictSchema,
};
export type {
  SafeAgentUsageV1,
  SafeDeterministicCheckV1,
  SafeReplyEvaluationV1,
  SafeToolEvidenceV1,
  TestArtifactDeliveryV1,
  TestRunCostV1,
  TestRunLifecycle,
  TestRunTotalsV1,
  TestScenarioLifecycle,
  TestVerdict,
};

const safeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const CANONICAL_UTC_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const matrixCorpusTerminalCandidateV1Schema = z
  .object({
    version: z.literal(1),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    outcome: z.enum([
      'completed_passed',
      'completed_failed',
      'stopped_not_evaluated',
    ]),
    projectionDigest: matrixCorpusSha256DigestSchema,
    artifactStageRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    artifactCandidateDigest: matrixCorpusSha256DigestSchema,
    createdAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict();
export type MatrixCorpusTerminalCandidateV1 = z.infer<
  typeof matrixCorpusTerminalCandidateV1Schema
>;

export const testRunTerminalWinnerV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('release'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: matrixCorpusSha256DigestSchema,
      outcome: z.enum([
        'completed_passed',
        'completed_failed',
        'stopped_not_evaluated',
      ]),
      acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('abandoned'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: matrixCorpusSha256DigestSchema,
      outcome: z.enum([
        'stopped_not_evaluated',
        'provisioning_noop',
        'provisioning_rolled_back',
      ]),
      acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]);
export type TestRunTerminalWinnerV1 = z.infer<typeof testRunTerminalWinnerV1Schema>;

export const testRunScenarioFoundationV1Schema = publicTestRunScenarioSummaryV1Schema
  .extend({
    eventWatermark: safeIntegerSchema,
    sessionId: matrixCorpusSafeIdSchema.nullable(),
    sessionBindingDigest: matrixCorpusSha256DigestSchema.nullable(),
  })
  .strict()
  .superRefine((scenario, context) => {
    if ((scenario.sessionId === null) !== (scenario.sessionBindingDigest === null))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Session binding must be atomic' });
    if (scenario.completedTurns > scenario.plannedTurns)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Completed turns exceed plan' });
    if (
      scenario.lifecycle === 'completed' &&
      ((scenario.completedTurns !== scenario.plannedTurns &&
        (scenario.verdict !== 'failed' || scenario.deterministicVerdict !== 'failed')) ||
        (scenario.verdict !== 'passed' && scenario.verdict !== 'failed') ||
        (scenario.deterministicVerdict !== 'passed' &&
          scenario.deterministicVerdict !== 'failed') ||
        (scenario.semanticVerdict !== 'passed' &&
          scenario.semanticVerdict !== 'failed' &&
          !(
            scenario.semanticVerdict === 'not_evaluated' &&
            scenario.deterministicVerdict === 'failed'
          )) ||
        scenario.startedAt === null ||
        scenario.finishedAt === null ||
        scenario.durationMs === null ||
        (scenario.verdict === 'passed' &&
          (scenario.deterministicVerdict !== 'passed' ||
            scenario.semanticVerdict !== 'passed')) ||
        (scenario.verdict === 'failed' &&
          scenario.deterministicVerdict !== 'failed' &&
          scenario.semanticVerdict !== 'failed'))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed scenario evidence is incomplete',
      });
  });
export type TestRunScenarioFoundationV1 = z.infer<
  typeof testRunScenarioFoundationV1Schema
>;

export const testRunScenarioProjectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    sessionId: matrixCorpusSafeIdSchema,
    sessionBindingDigest: matrixCorpusSha256DigestSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
    scenarioLabel: z.string().min(1).max(256),
    runRevision: safeIntegerSchema,
    scenarioRevision: safeIntegerSchema,
    eventWatermark: safeIntegerSchema,
    lifecycle: testScenarioLifecycleSchema,
    verdict: testVerdictSchema,
    plannedTurns: safeIntegerSchema.max(20),
    completedTurns: safeIntegerSchema.max(20),
    toolEvidence: z.array(safeToolEvidenceV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_TOOL_EVIDENCE),
    deterministicChecks: z
      .array(safeDeterministicCheckV1Schema)
      .max(INTEX_AGENT_TEST_RUN_MAX_DETERMINISTIC_CHECKS),
    replyEvaluations: z
      .array(safeReplyEvaluationV1Schema)
      .max(INTEX_AGENT_TEST_RUN_MAX_REPLY_EVALUATIONS),
    agentUsage: z.array(safeAgentUsageV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_AGENT_USAGE),
  })
  .strict()
  .superRefine((projection, context) => {
    if (projection.completedTurns > projection.plannedTurns)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Completed turns exceed plan' });
    requireOrderedUnique(
      projection.toolEvidence,
      (entry) => `${String(entry.turnIndex)}:${String(entry.ordinal)}:${entry.event}:${entry.toolName}`,
      context,
      'tool evidence'
    );
    requireOrderedUnique(
      projection.deterministicChecks,
      (entry) => `${String(entry.turnIndex)}:${String(entry.replyIndex)}:${entry.code}`,
      context,
      'deterministic checks'
    );
    requireOrderedUnique(
      projection.replyEvaluations,
      (entry) => `${String(entry.turnIndex)}:${String(entry.replyIndex)}`,
      context,
      'reply evaluations'
    );
    requireOrderedUnique(
      projection.agentUsage,
      (entry) => `${String(entry.turnIndex)}:${entry.stage}:${String(entry.callOrdinal)}`,
      context,
      'agent usage'
    );
  });
export type TestRunScenarioProjectionV1 = z.infer<typeof testRunScenarioProjectionV1Schema>;

const intexAgentTestRunRecordV1BaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    revision: safeIntegerSchema,
    corpusId: matrixCorpusSafeIdSchema,
    corpusVersion: z.string().min(1).max(64),
    catalogDigest: matrixCorpusSha256DigestSchema,
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    transport: z.literal('matrix_whatsapp'),
    executionMode: z.literal('strict_mock_tools'),
    lifecycle: testRunLifecycleSchema,
    verdict: testVerdictSchema,
    artifactDelivery: testArtifactDeliveryV1Schema,
    agentModel: matrixCorpusAgentModelSchema,
    evaluatorModel: matrixCorpusEvaluatorModelSchema,
    startedAt: matrixCorpusRfc3339TimestampSchema,
    updatedAt: matrixCorpusRfc3339TimestampSchema,
    finishedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    currentScenarioNumber: z.number().int().min(1).max(20).nullable(),
    totals: testRunTotalsV1Schema,
    cost: testRunCostV1Schema,
    retentionReconciled: z.boolean(),
    contextFinalizationTombstoneDigest: matrixCorpusSha256DigestSchema.nullable(),
    artifactStageDigest: matrixCorpusSha256DigestSchema.nullable(),
    terminalCandidate: matrixCorpusTerminalCandidateV1Schema.nullable(),
    terminalWinner: testRunTerminalWinnerV1Schema.nullable(),
    scenarios: z.array(testRunScenarioFoundationV1Schema).length(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
  })
  .strict();

export const intexAgentTestRunRecordV1Schema = intexAgentTestRunRecordV1BaseSchema.superRefine(
  (record, context) => {
    const timestamps = [
      record.startedAt,
      record.updatedAt,
      record.finishedAt,
      record.artifactDelivery.updatedAt,
      record.terminalCandidate?.createdAt ?? null,
      record.terminalWinner?.acknowledgedAt ?? null,
      ...record.scenarios.flatMap((scenario) => [scenario.startedAt, scenario.finishedAt]),
    ].filter((value): value is string => value !== null);
    if (timestamps.some((timestamp) => !CANONICAL_UTC_MILLIS_PATTERN.test(timestamp)))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Timestamp must be UTC milliseconds' });
    if (
      record.scenarios.some((scenario, index) => scenario.scenarioNumber !== index + 1) ||
      new Set(record.scenarios.map((scenario) => scenario.scenarioId)).size !==
        record.scenarios.length
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid scenario ordering' });

    const terminal = record.lifecycle === 'completed' || record.lifecycle === 'stopped';
    if (
      (!terminal && (record.verdict !== 'pending' || record.finishedAt !== null)) ||
      (terminal &&
        (record.finishedAt === null ||
          record.terminalWinner === null ||
          record.verdict === 'pending'))
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lifecycle/verdict mismatch' });
    if (
      record.lifecycle === 'finalizing' &&
      (record.terminalCandidate === null ||
        record.contextFinalizationTombstoneDigest === null ||
        record.artifactStageDigest === null ||
        record.artifactDelivery.status !== 'staged')
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Finalizing gate mismatch' });
    if (
      record.lifecycle === 'finalizing' &&
      record.terminalCandidate !== null &&
      !isTerminalOutcomeCompatible(
        record.scenarios,
        record.cost,
        record.terminalCandidate.outcome
      )
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal outcome mismatch' });
    if (
      record.terminalCandidate !== null &&
      (record.terminalCandidate.runId !== record.runId ||
        record.terminalCandidate.userId !== record.userId ||
        record.terminalCandidate.leaseFence !== record.leaseFence)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Candidate identity mismatch' });

    const current = record.scenarios.filter((scenario) => scenario.lifecycle === 'running');
    if (
      current.length > 1 ||
      record.currentScenarioNumber !== (current[0]?.scenarioNumber ?? null)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Current scenario mismatch' });

    const derived = deriveTestRunScenarioTotals(record.scenarios);
    if (JSON.stringify(record.totals.scenarios) !== JSON.stringify(derived.scenarios))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Scenario totals mismatch' });
    if (JSON.stringify(record.totals.turns) !== JSON.stringify(derived.turns))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Turn totals mismatch' });
    if (
      record.totals.replies.expected !== derived.replies.expected ||
      record.totals.replies.observed !== derived.replies.observed
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Reply totals mismatch' });
  }
);
export type IntexAgentTestRunRecordV1 = z.infer<typeof intexAgentTestRunRecordV1Schema>;

export function isIntexAgentTestRunRecordV1(value: unknown): value is IntexAgentTestRunRecordV1 {
  return intexAgentTestRunRecordV1Schema.safeParse(value).success;
}

export interface TestRunProjectionScenarioCommandV1 {
  scenarioId: string;
  expectedScenarioRevision: number;
  eventWatermark: number;
  lifecycle: TestScenarioLifecycle;
  verdict: TestVerdict;
  sessionId: string;
  sessionBindingDigest: string;
  summary: PublicTestRunScenarioSummaryV1;
  projection: TestRunScenarioProjectionV1;
}

export const testRunProjectionScenarioCommandV1Schema = z
  .object({
    scenarioId: matrixCorpusSafeIdSchema,
    expectedScenarioRevision: safeIntegerSchema,
    eventWatermark: safeIntegerSchema,
    lifecycle: testScenarioLifecycleSchema,
    verdict: testVerdictSchema,
    sessionId: matrixCorpusSafeIdSchema,
    sessionBindingDigest: matrixCorpusSha256DigestSchema,
    summary: publicTestRunScenarioSummaryV1Schema,
    projection: testRunScenarioProjectionV1Schema,
  })
  .strict();

export interface TestRunProjectionCasCommandV1 {
  expectedRevision: number;
  nextLifecycle: 'preflight' | 'running' | 'finalizing';
  updatedAt: string;
  retentionReconciled?: true;
  scenario: TestRunProjectionScenarioCommandV1 | null;
  finalization: Readonly<{
    tombstoneDigest: string;
    artifactStageDigest: string;
    terminalCandidate: MatrixCorpusTerminalCandidateV1;
  }> | null;
}

export const testRunProjectionCasCommandV1Schema = z
  .object({
    expectedRevision: safeIntegerSchema,
    nextLifecycle: z.enum(['preflight', 'running', 'finalizing']),
    updatedAt: matrixCorpusRfc3339TimestampSchema,
    retentionReconciled: z.literal(true).optional(),
    scenario: testRunProjectionScenarioCommandV1Schema.nullable(),
    finalization: z
      .object({
        tombstoneDigest: matrixCorpusSha256DigestSchema,
        artifactStageDigest: matrixCorpusSha256DigestSchema,
        terminalCandidate: matrixCorpusTerminalCandidateV1Schema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export type TestRunTerminalControlCommandV1 =
  | Readonly<{
      kind: 'release';
      eventId: string;
      payloadDigest: string;
      tombstoneDigest: string;
      terminalCandidateDigest: string;
      artifactStageDigest: string;
      acknowledgedAt: string;
    }>
  | Readonly<{
      kind: 'abandoned';
      eventId: string;
      payloadDigest: string;
      acknowledgedAt: string;
    }>;

export type TestRunArtifactDeliveryCommandV1 = Readonly<{
  expectedRevision: number;
  next:
    | { status: 'staged'; jsonCandidateDigest: string; markdownCandidateDigest: string }
    | {
        status: 'failed';
        failureCode: 'REPORT_STAGING_FAILED';
      }
    | {
        status: 'failed';
        failureCode: 'REPORT_VALIDATION_FAILED';
        terminalControlEventId?: string | undefined;
      }
    | {
        status: 'failed';
        failureCode: 'REPORT_PUBLICATION_FAILED';
        terminalControlEventId: string;
      }
    | { status: 'ready'; terminalControlEventId: string }
    | { status: 'unknown'; failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' };
  updatedAt: string;
}>;

export type TestRunTransitionFailureCode =
  | 'INVALID_RECORD'
  | 'REVISION_CONFLICT'
  | 'SCENARIO_REVISION_CONFLICT'
  | 'EVENT_WATERMARK_GAP'
  | 'INVALID_TRANSITION'
  | 'FINALIZATION_MISMATCH'
  | 'TERMINAL_CONFLICT';

export type TestRunTransitionResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      record: IntexAgentTestRunRecordV1;
    }>
  | Readonly<{ ok: false; code: TestRunTransitionFailureCode }>;

export function deriveTestRunScenarioTotals(
  scenarios: readonly TestRunScenarioFoundationV1[]
): Pick<TestRunTotalsV1, 'scenarios' | 'turns' | 'replies'> {
  return {
    scenarios: {
      planned: scenarios.length,
      started: scenarios.filter((scenario) => !['pending', 'not_run'].includes(scenario.lifecycle)).length,
      running: scenarios.some((scenario) => scenario.lifecycle === 'running') ? 1 : 0,
      completed: scenarios.filter((scenario) => scenario.lifecycle === 'completed').length,
      passed: scenarios.filter((scenario) => scenario.verdict === 'passed').length,
      failed: scenarios.filter((scenario) => scenario.verdict === 'failed').length,
      notRun: scenarios.filter((scenario) => scenario.lifecycle === 'not_run').length,
    },
    turns: {
      planned: scenarios.reduce((sum, scenario) => sum + scenario.plannedTurns, 0),
      completed: scenarios.reduce((sum, scenario) => sum + scenario.completedTurns, 0),
    },
    replies: {
      expected: scenarios.reduce((sum, scenario) => sum + scenario.expectedReplies, 0),
      observed: scenarios.reduce((sum, scenario) => sum + scenario.completedReplies, 0),
      judged: 0,
    },
  };
}

export function deriveTestRunEvidenceTotals(
  scenarios: readonly TestRunScenarioFoundationV1[],
  projections: readonly TestRunScenarioProjectionV1[]
): Readonly<{ totals: TestRunTotalsV1; cost: TestRunCostV1 }> | null {
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const completedRepliesByScenarioId = new Map(
    scenarios.map((scenario) => [scenario.scenarioId, scenario.completedReplies])
  );
  const projectionScenarioIds = projections.map((projection) => projection.scenarioId);
  if (
    new Set(projectionScenarioIds).size !== projectionScenarioIds.length ||
    projections.some((projection) => {
      const scenario = scenariosById.get(projection.scenarioId);
      return (
        scenario?.scenarioNumber !== projection.scenarioNumber ||
        scenario.scenarioLabel !== projection.scenarioLabel ||
        scenario.sessionId !== projection.sessionId ||
        scenario.sessionBindingDigest !== projection.sessionBindingDigest ||
        scenario.scenarioRevision !== projection.scenarioRevision ||
        scenario.eventWatermark !== projection.eventWatermark ||
        scenario.lifecycle !== projection.lifecycle ||
        scenario.verdict !== projection.verdict ||
        scenario.plannedTurns !== projection.plannedTurns ||
        scenario.completedTurns !== projection.completedTurns ||
        !isScenarioProjectionEvidenceConsistent(scenario, projection)
      );
    })
  )
    return null;
  const base = deriveTestRunScenarioTotals(scenarios);
  const allAgentUsage = projections.flatMap((projection) => projection.agentUsage);
  const allEvaluations = projections.flatMap((projection) => projection.replyEvaluations);
  const agentNanoUsd = sumSafeIntegers(allAgentUsage.map((usage) => usage.costNanoUsd));
  const evaluatorNanoUsd = sumSafeIntegers(
    allEvaluations.map((evaluation) => evaluation.usage.costNanoUsd)
  );
  if (agentNanoUsd === null || evaluatorNanoUsd === null) return null;
  const hasAgentCoverage = projections.every(
    (projection) =>
      projection.completedTurns === 0 ||
      projection.agentUsage.length > 0 ||
      hasExactZeroAgentUsageProof(projection)
  );
  const hasEvaluatorCoverage = projections.every(
    (projection) =>
      projection.replyEvaluations.length ===
      completedRepliesByScenarioId.get(projection.scenarioId)
  );
  const agentCost = projections.length > 0 && hasAgentCoverage ? agentNanoUsd : null;
  const evaluatorCost =
    projections.length > 0 && hasEvaluatorCoverage ? evaluatorNanoUsd : null;
  const totalNanoUsd =
    agentCost === null || evaluatorCost === null
      ? null
      : sumSafeIntegers([agentCost, evaluatorCost]);
  if (agentCost !== null && evaluatorCost !== null && totalNanoUsd === null) return null;
  return {
    totals: {
      ...base,
      replies: { ...base.replies, judged: allEvaluations.length },
      tools: {
        selected: projections.flatMap((projection) => projection.toolEvidence)
          .filter((evidence) => evidence.event === 'selected').length,
        mockCompleted: projections.flatMap((projection) => projection.toolEvidence)
          .filter((evidence) => evidence.event === 'mock_completed').length,
        mockFailed: projections.flatMap((projection) => projection.toolEvidence)
          .filter((evidence) => evidence.event === 'mock_failed').length,
        unexpectedKnown: projections.flatMap((projection) => projection.toolEvidence)
          .filter((evidence) => evidence.event === 'unexpected_known_no_execution').length,
      },
      evaluations: {
        deterministicPassed: scenarios.filter(
          (scenario) => scenario.deterministicVerdict === 'passed'
        ).length,
        deterministicFailed: scenarios.filter(
          (scenario) => scenario.deterministicVerdict === 'failed'
        ).length,
        minimaxPassed: scenarios.filter((scenario) => scenario.semanticVerdict === 'passed')
          .length,
        minimaxFailed: scenarios.filter((scenario) => scenario.semanticVerdict === 'failed')
          .length,
        pending: scenarios.filter(
          (scenario) =>
            scenario.deterministicVerdict === 'pending' ||
            scenario.semanticVerdict === 'pending'
        ).length,
      },
    },
    cost: { agentNanoUsd: agentCost, evaluatorNanoUsd: evaluatorCost, totalNanoUsd },
  };
}

function hasExactZeroAgentUsageProof(projection: TestRunScenarioProjectionV1): boolean {
  return projection.deterministicChecks.some(
    (check) =>
      check.code === 'agent_usage_count' &&
      check.status === 'passed' &&
      check.evidence.expectedCount === 0 &&
      check.evidence.actualCount === 0
  );
}

export function isScenarioProjectionEvidenceConsistent(
  scenario: PublicTestRunScenarioSummaryV1,
  projection: TestRunScenarioProjectionV1
): boolean {
  const selectedTools = [
    ...new Set(
      projection.toolEvidence
        .filter((evidence) => evidence.event === 'selected')
        .map((evidence) => evidence.toolName)
    ),
  ];
  if (JSON.stringify(scenario.selectedTools) !== JSON.stringify(selectedTools)) return false;
  if (projection.replyEvaluations.length > scenario.completedReplies) return false;

  const deterministicVerdict = deriveDeterministicEvidenceVerdict(
    projection.deterministicChecks
  );
  const derivedSemanticVerdict = deriveSemanticEvidenceVerdict(
    projection.replyEvaluations,
    scenario.completedReplies
  );
  const semanticVerdict =
    derivedSemanticVerdict === 'pending' && deterministicVerdict === 'failed'
      ? 'not_evaluated'
      : derivedSemanticVerdict;
  if (
    scenario.lifecycle !== 'stopped' &&
    scenario.lifecycle !== 'not_run' &&
    (scenario.deterministicVerdict !== deterministicVerdict ||
      scenario.semanticVerdict !== semanticVerdict)
  )
    return false;

  if (scenario.lifecycle !== 'completed') return true;
  const verdict =
    deterministicVerdict === 'failed' || semanticVerdict === 'failed'
      ? 'failed'
      : deterministicVerdict === 'passed' && semanticVerdict === 'passed'
        ? 'passed'
        : 'pending';
  const executionEvidenceComplete =
    scenario.completedTurns === scenario.plannedTurns ||
    (verdict === 'failed' && hasMissingConfirmationBlocker(scenario, projection));
  return (
    executionEvidenceComplete &&
    projection.replyEvaluations.length === scenario.completedReplies &&
    scenario.startedAt !== null &&
    scenario.finishedAt !== null &&
    scenario.durationMs !== null &&
    scenario.verdict === verdict &&
    projection.verdict === verdict
  );
}

function hasMissingConfirmationBlocker(
  scenario: PublicTestRunScenarioSummaryV1,
  projection: TestRunScenarioProjectionV1
): boolean {
  return (
    scenario.completedTurns < scenario.plannedTurns &&
    projection.deterministicChecks.some(
      (check) =>
        check.code === 'confirmation_count' &&
        check.status === 'failed' &&
        check.turnIndex === scenario.completedTurns &&
        check.replyIndex === null &&
        check.evidence.expectedCount === 1 &&
        check.evidence.actualCount === 0
    )
  );
}

function deriveDeterministicEvidenceVerdict(
  checks: readonly SafeDeterministicCheckV1[]
): TestVerdict {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.length === 0 || checks.some((check) => check.status === 'pending')) return 'pending';
  return 'passed';
}

function deriveSemanticEvidenceVerdict(
  evaluations: readonly SafeReplyEvaluationV1[],
  completedReplies: number
): TestVerdict {
  if (evaluations.some((evaluation) => evaluation.verdict === 'failed')) return 'failed';
  if (completedReplies === 0 || evaluations.length !== completedReplies) return 'pending';
  return 'passed';
}

function sumSafeIntegers(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value)
      return null;
    total += value;
  }
  return total;
}

export function isTerminalOutcomeCompatible(
  scenarios: readonly TestRunScenarioFoundationV1[],
  cost: TestRunCostV1,
  outcome: MatrixCorpusTerminalCandidateV1['outcome']
): boolean {
  const completeEvidence = scenarios.every(
    (scenario) =>
      scenario.lifecycle === 'completed' &&
      (scenario.verdict === 'passed' || scenario.verdict === 'failed') &&
      ((scenario.completedTurns === scenario.plannedTurns &&
        scenario.completedReplies === scenario.expectedReplies) ||
        (scenario.completedTurns < scenario.plannedTurns &&
          scenario.completedReplies <= scenario.expectedReplies &&
          scenario.verdict === 'failed' &&
          scenario.deterministicVerdict === 'failed')) &&
      (scenario.deterministicVerdict === 'passed' ||
        scenario.deterministicVerdict === 'failed') &&
      (scenario.semanticVerdict === 'passed' ||
        scenario.semanticVerdict === 'failed' ||
        (scenario.semanticVerdict === 'not_evaluated' &&
          scenario.deterministicVerdict === 'failed'))
  );
  const completeCost =
    cost.agentNanoUsd !== null &&
    cost.evaluatorNanoUsd !== null &&
    cost.totalNanoUsd === cost.agentNanoUsd + cost.evaluatorNanoUsd;
  if (outcome === 'completed_passed')
    return (
      completeEvidence &&
      completeCost &&
      scenarios.every(
        (scenario) =>
          scenario.verdict === 'passed' &&
          scenario.deterministicVerdict === 'passed' &&
          scenario.semanticVerdict === 'passed'
      )
    );
  if (outcome === 'completed_failed')
    return (
      completeEvidence &&
      completeCost &&
      scenarios.some(
        (scenario) =>
          scenario.verdict === 'failed' ||
          scenario.deterministicVerdict === 'failed' ||
          scenario.semanticVerdict === 'failed'
      )
    );
  return (
    scenarios.every((scenario) =>
      ['completed', 'stopped', 'not_run'].includes(scenario.lifecycle)
    ) &&
    scenarios.every((scenario) => scenario.lifecycle !== 'stopped' || scenario.verdict === 'not_evaluated')
  );
}

function requireOrderedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  context: z.RefinementCtx,
  label: string
): void {
  const keys = values.map(key);
  if (
    new Set(keys).size !== keys.length ||
    keys.slice(1).some((value, index) => value < (keys[index] as string))
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid ${label} ordering` });
}
