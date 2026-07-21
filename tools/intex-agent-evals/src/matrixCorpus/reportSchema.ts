import { intexAgentToolNameV1Schema } from '@intexuraos/http-contracts';
import { z } from 'zod';
import { MATRIX_CORPUS_PREFLIGHT_CHECKS } from './preflight.js';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const revision = z.string().regex(/^[0-9a-f]{40}$/u);
const runId = z
  .string()
  .regex(/^eval-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const closedStatus = z.enum(['passed', 'failed', 'not_run']);
const lifecycle = z.enum(['completed', 'stopped']);
const verdict = z.enum(['passed', 'failed', 'not_evaluated']);
const CANONICAL_PASS_TOOL_ROWS = new Set([
  'intex-eval-001:1:create_note',
  'intex-eval-002:1:create_calendar_event',
  'intex-eval-003:2:create_calendar_event',
  'intex-eval-004:2:create_note',
  'intex-eval-006:1:create_note',
  'intex-eval-006:3:create_note',
  'intex-eval-007:1:create_note',
  'intex-eval-008:2:create_calendar_event',
  'intex-eval-010:1:create_note',
  'intex-eval-011:0:query_calendar_events',
  'intex-eval-012:1:create_research',
  'intex-eval-013:1:create_link',
  'intex-eval-014:1:create_code_task',
  'intex-eval-015:1:save_external',
  'intex-eval-016:0:get_user_preferences',
  'intex-eval-017:1:add_user_preference',
  'intex-eval-018:1:update_user_preference',
  'intex-eval-019:1:delete_user_preference',
  'intex-eval-020:19:create_note',
]);
const CANONICAL_PASS_TURN_COUNTS = [
  2, 2, 3, 3, 1, 4, 2, 3, 1, 2, 1, 2, 2, 2, 2, 1, 2, 2, 2, 20,
] as const;

const usage = z
  .object({
    logicalCalls: safeInteger,
    repairCount: safeInteger,
    inputTokens: safeInteger,
    outputTokens: safeInteger,
    totalTokens: safeInteger,
    costNanoUsd: safeInteger.nullable(),
    costComplete: z.boolean(),
  })
  .strict();

const totals = z
  .object({
    scenariosPlanned: z.literal(20),
    scenariosExecuted: safeInteger,
    scenariosPassed: safeInteger,
    scenariosFailed: safeInteger,
    scenariosNotRun: safeInteger,
    turnsPlanned: z.literal(59),
    turnsSent: safeInteger,
    turnsCorrelated: safeInteger,
    turnsCompleted: safeInteger,
    sessionsExpected: z.literal(20),
    sessionsCreated: safeInteger,
    sessionsContinued: safeInteger,
    sessionsClosed: safeInteger,
    confirmationsRequested: safeInteger,
    confirmationsAccepted: safeInteger,
    confirmationsRejected: safeInteger,
    confirmationsCompleted: safeInteger,
    repliesExpected: safeInteger,
    repliesObserved: safeInteger,
    repliesJudged: safeInteger,
    toolSelections: safeInteger,
    mockCompletions: safeInteger,
    mockFailures: safeInteger,
    productionExecutorResolutions: z.literal(0),
    productionExecutorAdmissions: z.literal(0),
  })
  .strict();

const scenario = z
  .object({
    scenarioId: z.string().regex(/^intex-eval-[0-9]{3}$/u),
    ordinal: z.number().int().min(1).max(20),
    safeTitle: z.string().min(1).max(160),
    scenarioDigest: digest,
    lifecycle: z.enum(['completed', 'stopped', 'not_run']),
    verdict,
    plannedTurns: z.number().int().min(1).max(20),
    completedTurns: z.number().int().min(0).max(20),
    sessionReferenceDigest: digest.nullable(),
    transport: z
      .object({
        matrixSends: safeInteger,
        whatsappIngress: safeInteger,
        whatsappEgress: safeInteger,
        assistantReplies: safeInteger,
        matrixMirrors: safeInteger,
      })
      .strict(),
    tools: z
      .array(
        z
          .object({
            toolName: intexAgentToolNameV1Schema,
            turnIndex: z.number().int().min(0).max(19),
            expected: safeInteger,
            selected: safeInteger,
            completed: safeInteger,
            failed: safeInteger,
          })
          .strict()
      )
      .max(100),
    deterministic: z.object({ passed: safeInteger, failed: safeInteger }).strict(),
    judge: z
      .object({
        status: closedStatus,
        passed: z.boolean().nullable(),
        score: z.number().int().min(0).max(100).nullable(),
        criteriaPassed: safeInteger,
        criteriaFailed: safeInteger,
        usage,
      })
      .strict(),
    agentUsage: usage,
    strictMockProof: z
      .object({
        version: z.literal(1),
        status: z.enum(['passed', 'failed', 'not_run']),
        mockProfileDigest: digest,
        productionExecutorResolutions: z.literal(0),
        productionExecutorAdmissions: z.literal(0),
      })
      .strict(),
    failureCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,96}$/u)).max(100),
  })
  .strict();

const cleanupCounts = z
  .object({
    observation: z.enum(['complete', 'removals_only', 'not_observed']),
    considered: safeInteger,
    retained: safeInteger,
    removed: safeInteger,
    missing: safeInteger,
    failed: safeInteger,
  })
  .strict();

export const MatrixCorpusReportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId,
    command: z.literal('matrix-corpus'),
    requestedRevision: revision,
    deployedRevision: revision,
    accountAlias: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u),
    runtimeAudience: z.literal('home-dev'),
    environmentAlias: z.literal('dev'),
    catalog: z.object({ digest, scenarioCount: z.literal(20), turnCount: z.literal(59) }).strict(),
    agentModel: z.literal('or:deepseek/deepseek-v4-flash'),
    evaluatorModel: z.literal('or:minimax/minimax-m3'),
    executionMode: z.literal('real_matrix_whatsapp_strict_mock_tools'),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    durationMs: safeInteger,
    terminal: z
      .object({
        lifecycle,
        verdict,
        acknowledged: z.boolean(),
        leaseReleased: z.boolean(),
        runOutcomeCode: z.enum(['PASS', 'BEHAVIORAL_FAILURE', 'INFRASTRUCTURE_FAILURE']),
        exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      })
      .strict(),
    preflight: z
      .array(
        z
          .object({
            check: z.enum(MATRIX_CORPUS_PREFLIGHT_CHECKS),
            status: z.enum(['passed', 'failed']),
            code: z
              .string()
              .regex(/^[A-Z0-9_]{1,96}$/u)
              .nullable(),
          })
          .strict()
      )
      .length(MATRIX_CORPUS_PREFLIGHT_CHECKS.length),
    totals,
    usage: z
      .object({
        agent: usage,
        evaluator: usage,
        totalCostNanoUsd: safeInteger.nullable(),
        costComplete: z.boolean(),
      })
      .strict(),
    scenarios: z.array(scenario).length(20),
    cleanup: z
      .object({
        contextFinalization: z.enum(['passed', 'failed']),
        scenarioContextsDeleted: safeInteger,
        runContextsDeleted: safeInteger,
        retainedSessionsUnchanged: z.enum(['passed', 'not_observed']),
        retainedProjectionsUnchanged: z.enum(['passed', 'not_observed']),
        quiesce: z.enum(['passed', 'failed']),
        drain: z.enum(['passed', 'failed']),
        finalizingCandidate: z.enum(['passed', 'failed']),
        releasePending: z.enum(['passed', 'failed']),
        terminalAcknowledgement: z.enum(['passed', 'failed']),
        leaseRelease: z.enum(['passed', 'failed']),
        retention: z
          .object({
            status: z.enum(['passed', 'failed']),
            runs: cleanupCounts,
            sessions: cleanupCounts,
            capabilities: cleanupCounts,
            artifacts: cleanupCounts,
          })
          .strict(),
      })
      .strict(),
    artifactDelivery: z
      .object({
        status: z.enum(['pending', 'staged', 'ready', 'failed', 'unknown']),
        stagedJsonDigest: digest.nullable(),
        stagedMarkdownDigest: digest.nullable(),
        failureCode: z
          .enum([
            'REPORT_STAGING_FAILED',
            'REPORT_VALIDATION_FAILED',
            'REPORT_PUBLICATION_FAILED',
            'REPORT_DELIVERY_STATUS_TIMEOUT',
          ])
          .nullable(),
      })
      .strict(),
    failures: z
      .array(
        z
          .object({
            stage: z.enum([
              'preflight',
              'provisioning',
              'retention',
              'scenario',
              'finalizing',
              'release',
              'report',
            ]),
            code: z.string().regex(/^[A-Z0-9_]{1,96}$/u),
            scenarioNumber: z.number().int().min(1).max(20).nullable(),
            turnIndex: z.number().int().min(0).max(19).nullable(),
            replyOrdinal: z.number().int().min(1).max(20).nullable(),
          })
          .strict()
      )
      .max(500),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.requestedRevision !== report.deployedRevision) {
      context.addIssue({ code: 'custom', message: 'revision mismatch' });
    }
    if (
      report.terminal.exitCode === 0 &&
      (!report.usage.costComplete || report.usage.totalCostNanoUsd === null)
    ) {
      context.addIssue({ code: 'custom', message: 'complete cost required for pass' });
    }
    if (
      report.artifactDelivery.status === 'ready' &&
      (!report.terminal.acknowledged || !report.terminal.leaseReleased)
    ) {
      context.addIssue({ code: 'custom', message: 'ready artifact requires terminal barriers' });
    }
    const scenarios = report.scenarios;
    if (
      report.preflight.some((check, index) => check.check !== MATRIX_CORPUS_PREFLIGHT_CHECKS[index])
    ) {
      context.addIssue({ code: 'custom', message: 'preflight sequence mismatch' });
    }
    if (
      scenarios.some(
        (scenario, offset) =>
          scenario.ordinal !== offset + 1 ||
          scenario.scenarioId !== `intex-eval-${String(offset + 1).padStart(3, '0')}`
      )
    ) {
      context.addIssue({ code: 'custom', message: 'scenario sequence mismatch' });
    }
    const sum = (selector: (scenario: (typeof scenarios)[number]) => number): number =>
      scenarios.reduce((total, scenario) => total + selector(scenario), 0);
    if (
      scenarios.some((entry) => entry.tools.some((tool) => tool.turnIndex >= entry.plannedTurns))
    ) {
      context.addIssue({ code: 'custom', message: 'tool turn outside scenario plan' });
    }
    if (
      report.totals.scenariosExecuted !==
        scenarios.filter((scenario) => scenario.lifecycle !== 'not_run').length ||
      report.totals.scenariosPassed !==
        scenarios.filter((scenario) => scenario.verdict === 'passed').length ||
      report.totals.scenariosFailed !==
        scenarios.filter((scenario) => scenario.verdict === 'failed').length ||
      report.totals.scenariosNotRun !==
        scenarios.filter((scenario) => scenario.lifecycle === 'not_run').length ||
      report.totals.turnsPlanned !== sum((scenario) => scenario.plannedTurns) ||
      report.totals.turnsCompleted !== sum((scenario) => scenario.completedTurns) ||
      report.totals.repliesObserved !== sum((scenario) => scenario.transport.assistantReplies) ||
      report.totals.toolSelections !==
        sum((scenario) => scenario.tools.reduce((total, tool) => total + tool.selected, 0)) ||
      report.totals.mockCompletions !==
        sum((scenario) => scenario.tools.reduce((total, tool) => total + tool.completed, 0)) ||
      report.totals.mockFailures !==
        sum((scenario) => scenario.tools.reduce((total, tool) => total + tool.failed, 0))
    ) {
      context.addIssue({ code: 'custom', message: 'report totals mismatch' });
    }
    if (
      report.usage.agent.totalTokens !==
        report.usage.agent.inputTokens + report.usage.agent.outputTokens ||
      report.usage.evaluator.totalTokens !==
        report.usage.evaluator.inputTokens + report.usage.evaluator.outputTokens ||
      (report.usage.costComplete &&
        report.usage.totalCostNanoUsd !==
          (report.usage.agent.costNanoUsd ?? 0) + (report.usage.evaluator.costNanoUsd ?? 0))
    ) {
      context.addIssue({ code: 'custom', message: 'usage totals mismatch' });
    }
    if (
      (report.artifactDelivery.status === 'pending' &&
        (report.artifactDelivery.stagedJsonDigest !== null ||
          report.artifactDelivery.stagedMarkdownDigest !== null)) ||
      (report.artifactDelivery.status === 'ready' &&
        (report.artifactDelivery.stagedJsonDigest === null ||
          report.artifactDelivery.stagedMarkdownDigest === null))
    ) {
      context.addIssue({ code: 'custom', message: 'artifact digest state mismatch' });
    }
    if (
      report.totals.confirmationsRequested !== report.totals.confirmationsCompleted ||
      report.totals.confirmationsCompleted !==
        report.totals.confirmationsAccepted + report.totals.confirmationsRejected
    ) {
      context.addIssue({ code: 'custom', message: 'confirmation totals mismatch' });
    }
    if (report.terminal.runOutcomeCode === 'PASS' || report.terminal.exitCode === 0) {
      const sessionDigests = report.scenarios.flatMap((entry) =>
        entry.sessionReferenceDigest === null ? [] : [entry.sessionReferenceDigest]
      );
      const observedToolRows = report.scenarios.flatMap((entry) =>
        entry.tools.map((tool) => `${entry.scenarioId}:${String(tool.turnIndex)}:${tool.toolName}`)
      );
      const agentUsageMatches = usageMatchesScenarioSum(
        report.usage.agent,
        report.scenarios.map((entry) => entry.agentUsage)
      );
      const evaluatorUsageMatches = usageMatchesScenarioSum(
        report.usage.evaluator,
        report.scenarios.map((entry) => entry.judge.usage)
      );
      const readyCleanupPassed =
        report.artifactDelivery.status !== 'ready' ||
        (report.cleanup.contextFinalization === 'passed' &&
          report.cleanup.scenarioContextsDeleted === 20 &&
          report.cleanup.runContextsDeleted === 1 &&
          report.cleanup.quiesce === 'passed' &&
          report.cleanup.drain === 'passed' &&
          report.cleanup.finalizingCandidate === 'passed' &&
          report.cleanup.releasePending === 'passed' &&
          report.cleanup.terminalAcknowledgement === 'passed' &&
          report.cleanup.leaseRelease === 'passed' &&
          report.cleanup.retention.status === 'passed' &&
          Object.values(report.cleanup.retention)
            .filter((value): value is z.infer<typeof cleanupCounts> => typeof value === 'object')
            .every((counts) => counts.failed === 0));
      const passIsComplete =
        report.terminal.runOutcomeCode === 'PASS' &&
        report.terminal.exitCode === 0 &&
        report.terminal.lifecycle === 'completed' &&
        report.terminal.verdict === 'passed' &&
        report.preflight.every((check) => check.status === 'passed' && check.code === null) &&
        report.totals.scenariosExecuted === 20 &&
        report.totals.scenariosPassed === 20 &&
        report.totals.scenariosFailed === 0 &&
        report.totals.scenariosNotRun === 0 &&
        report.totals.turnsSent === 59 &&
        report.totals.turnsCorrelated === 59 &&
        report.totals.turnsCompleted === 59 &&
        report.totals.sessionsCreated === 20 &&
        report.totals.sessionsContinued === 39 &&
        report.totals.sessionsClosed === 0 &&
        report.totals.confirmationsRequested === 17 &&
        report.totals.confirmationsAccepted === 17 &&
        report.totals.confirmationsRejected === 0 &&
        report.totals.confirmationsCompleted === 17 &&
        report.totals.repliesExpected === 59 &&
        report.totals.repliesObserved === 59 &&
        report.totals.repliesJudged === 59 &&
        report.totals.toolSelections === 19 &&
        report.totals.mockCompletions === 19 &&
        report.totals.mockFailures === 0 &&
        (report.artifactDelivery.status === 'pending' ||
          report.artifactDelivery.status === 'ready') &&
        report.artifactDelivery.failureCode === null &&
        sessionDigests.length === 20 &&
        new Set(sessionDigests).size === 20 &&
        observedToolRows.length === CANONICAL_PASS_TOOL_ROWS.size &&
        new Set(observedToolRows).size === observedToolRows.length &&
        observedToolRows.every((row) => CANONICAL_PASS_TOOL_ROWS.has(row)) &&
        agentUsageMatches &&
        evaluatorUsageMatches &&
        report.usage.agent.logicalCalls > 0 &&
        report.usage.agent.totalTokens > 0 &&
        report.usage.agent.costComplete &&
        report.usage.agent.costNanoUsd !== null &&
        report.usage.evaluator.logicalCalls === 59 &&
        report.usage.evaluator.totalTokens > 0 &&
        report.usage.evaluator.costComplete &&
        report.usage.evaluator.costNanoUsd !== null &&
        readyCleanupPassed &&
        report.failures.length === 0 &&
        report.scenarios.every(
          (entry) =>
            entry.lifecycle === 'completed' &&
            entry.verdict === 'passed' &&
            entry.plannedTurns === CANONICAL_PASS_TURN_COUNTS[entry.ordinal - 1] &&
            entry.completedTurns === entry.plannedTurns &&
            entry.sessionReferenceDigest !== null &&
            entry.transport.matrixSends === entry.plannedTurns &&
            entry.transport.whatsappIngress === entry.plannedTurns &&
            entry.transport.whatsappEgress === entry.plannedTurns &&
            entry.transport.assistantReplies === entry.plannedTurns &&
            entry.transport.matrixMirrors === entry.plannedTurns &&
            entry.tools.every(
              (tool) =>
                tool.expected > 0 &&
                tool.expected === 1 &&
                tool.expected === tool.selected &&
                tool.selected === tool.completed &&
                tool.failed === 0
            ) &&
            entry.deterministic.failed === 0 &&
            entry.judge.status === 'passed' &&
            entry.judge.passed === true &&
            entry.judge.criteriaPassed > 0 &&
            entry.judge.criteriaFailed === 0 &&
            entry.judge.usage.logicalCalls === entry.plannedTurns &&
            entry.judge.usage.totalTokens > 0 &&
            entry.judge.usage.costComplete &&
            entry.judge.usage.costNanoUsd !== null &&
            entry.agentUsage.logicalCalls > 0 &&
            entry.agentUsage.totalTokens > 0 &&
            entry.agentUsage.costComplete &&
            entry.agentUsage.costNanoUsd !== null &&
            entry.strictMockProof.status === 'passed' &&
            entry.failureCodes.length === 0
        );
      if (!passIsComplete) {
        context.addIssue({ code: 'custom', message: 'pass outcome requires complete evidence' });
      }
    }
  });

function usageMatchesScenarioSum(
  aggregate: z.infer<typeof usage>,
  entries: readonly z.infer<typeof usage>[]
): boolean {
  const costComplete = entries.every((entry) => entry.costComplete && entry.costNanoUsd !== null);
  const costNanoUsd = costComplete
    ? entries.reduce((total, entry) => total + (entry.costNanoUsd ?? 0), 0)
    : null;
  return (
    aggregate.logicalCalls === entries.reduce((total, entry) => total + entry.logicalCalls, 0) &&
    aggregate.repairCount === entries.reduce((total, entry) => total + entry.repairCount, 0) &&
    aggregate.inputTokens === entries.reduce((total, entry) => total + entry.inputTokens, 0) &&
    aggregate.outputTokens === entries.reduce((total, entry) => total + entry.outputTokens, 0) &&
    aggregate.totalTokens === entries.reduce((total, entry) => total + entry.totalTokens, 0) &&
    aggregate.costComplete === costComplete &&
    aggregate.costNanoUsd === costNanoUsd
  );
}

export type MatrixCorpusReportV1 = z.infer<typeof MatrixCorpusReportV1Schema>;

export function renderMatrixCorpusReportMarkdown(candidate: unknown): string {
  const report = MatrixCorpusReportV1Schema.parse(candidate);
  const rows = report.scenarios.map(
    (entry) =>
      `| ${String(entry.ordinal)} | ${entry.scenarioId} | ${entry.lifecycle} | ${entry.verdict} | ${String(entry.completedTurns)}/${String(entry.plannedTurns)} |`
  );
  return [
    '# Intex Agent Matrix corpus',
    '',
    `- Run: ${report.runId}`,
    `- Revision: ${report.deployedRevision}`,
    `- Agent: ${report.agentModel}`,
    `- Evaluator: ${report.evaluatorModel}`,
    `- Result: ${report.terminal.runOutcomeCode}`,
    `- Artifact delivery: ${report.artifactDelivery.status}`,
    '',
    '| # | Scenario | Lifecycle | Verdict | Turns |',
    '|---:|---|---|---|---:|',
    ...rows,
    '',
  ].join('\n');
}
