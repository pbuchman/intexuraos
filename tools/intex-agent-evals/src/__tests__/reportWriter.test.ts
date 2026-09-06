import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  FirebaseAuthError: class MockFirebaseAuthError extends Error {
    readonly code = 'auth/internal-error';
  },
  getAuth: vi.fn(),
}));

import {
  EvaluationReportV1Schema,
  SafeReportFailureV1Schema,
  createReportWriter,
  type EvaluationReportV1,
  type ReportFileHandle,
  type ReportFileSystem,
} from '../reportWriter.js';

const RUN_ID = 'evaluation-run-20260716-230217';
const STARTED_AT = '2026-07-16T21:02:17.000Z';
const FINISHED_AT = '2026-07-16T21:02:18.000Z';
const ARTIFACT_ROOT_PARTS = ['.artifacts', 'intex-agent-evals'] as const;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const PASS_CRITERIA = {
  understoodIntent: true,
  helpful: true,
  conciseAndClear: true,
  professionalTone: true,
  noPassiveAggression: true,
} as const;

const FAIL_CRITERIA = {
  understoodIntent: true,
  helpful: false,
  conciseAndClear: true,
  professionalTone: true,
  noPassiveAggression: true,
} as const;

const ZERO_USAGE = {
  callCount: 0,
  repairCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  providerReportedUsd: 0,
  providerReportedUsdComplete: true,
} as const;

const PASS_PREFLIGHT: Extract<EvaluationReportV1['preflight'], { status: 'passed' }> = {
  status: 'passed',
  host: 'home-dev',
  ports: { intexAgent: 8134, whatsappService: 8113, matrixAdapter: 8099 },
  judgeModel: 'or:minimax/minimax-m3',
  scenarioCount: 1,
  accountAlias: 'operator-evals',
  checks: [
    { check: 'runtime', status: 'passed' },
    { check: 'environment', status: 'passed' },
    { check: 'config', status: 'passed' },
    { check: 'matrix_files', status: 'passed' },
    { check: 'intex_agent_health', status: 'passed' },
    { check: 'whatsapp_health', status: 'passed' },
    { check: 'matrix_health', status: 'passed' },
    { check: 'firebase_identity', status: 'passed' },
    { check: 'matrix_identity', status: 'passed' },
    { check: 'whatsapp_delivery', status: 'passed' },
    { check: 'scenario_catalog', status: 'passed' },
    { check: 'minimax_probe', status: 'passed' },
  ],
};

function passReport(): EvaluationReportV1 {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    command: 'endpoint',
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    durationMs: 1_000,
    status: 'passed',
    exitCode: 0,
    preflight: PASS_PREFLIGHT,
    totals: {
      scenarioCount: 1,
      scenarioPassed: 1,
      scenarioBehavioralFailed: 0,
      scenarioInfrastructureFailed: 0,
      turnCount: 2,
      replyCount: 2,
      toolCallCount: 1,
      judgeVerdictCount: 2,
    },
    judgeUsage: {
      callCount: 3,
      repairCount: 1,
      inputTokens: 40,
      outputTokens: 20,
      totalTokens: 61,
      providerReportedUsd: 0.00125,
      providerReportedUsdComplete: true,
    },
    scenarios: [
      {
        scenarioId: 'intex-eval-001',
        status: 'passed',
        exitCode: 0,
        durationMs: 800,
        turnCount: 2,
        replyCount: 2,
        toolCallCount: 1,
        toolSummaries: [{ toolName: 'create_note', completedCount: 1, failedCount: 0 }],
        deterministicFailures: [],
        judgeVerdicts: [
          {
            scenarioId: 'intex-eval-001',
            turnIndex: 0,
            replyIndex: 0,
            pass: true,
            score: 5,
            criteria: PASS_CRITERIA,
            failures: [],
          },
          {
            scenarioId: 'intex-eval-001',
            turnIndex: 1,
            replyIndex: 0,
            pass: true,
            score: 5,
            criteria: PASS_CRITERIA,
            failures: [],
          },
        ],
        cleanup: { status: 'passed', deleted: 3, total: 3 },
      },
    ],
    failures: [],
  };
}

function behavioralReport(): EvaluationReportV1 {
  const report = passReport();
  const baseScenario = first(report.scenarios);
  const firstVerdict = first(baseScenario.judgeVerdicts);
  return {
    ...report,
    status: 'behavioral_failure',
    exitCode: 1,
    totals: {
      ...report.totals,
      scenarioPassed: 0,
      scenarioBehavioralFailed: 1,
    },
    scenarios: [
      {
        ...baseScenario,
        status: 'behavioral_failure',
        exitCode: 1,
        deterministicFailures: [{ code: 'forbidden_tool_called', turnIndex: 1 }],
        judgeVerdicts: [
          firstVerdict,
          {
            scenarioId: 'intex-eval-001',
            turnIndex: 1,
            replyIndex: 0,
            pass: false,
            score: 2,
            criteria: FAIL_CRITERIA,
            failures: ['unhelpful'],
          },
        ],
      },
    ],
    failures: [
      {
        stage: 'deterministic',
        code: 'forbidden_tool_called',
        scenarioId: 'intex-eval-001',
        turnIndex: 1,
      },
      {
        stage: 'judge',
        code: 'unhelpful',
        scenarioId: 'intex-eval-001',
        turnIndex: 1,
        replyIndex: 0,
      },
    ],
  };
}

function assertionFailureReport(
  path = 'contentLength',
  code = 'tool_argument_assertion_failed'
): Record<string, unknown> {
  const report = cloneReport(behavioralReport());
  const scenario = first(report['scenarios'] as Record<string, unknown>[]);
  const deterministicFailure = first(
    scenario['deterministicFailures'] as Record<string, unknown>[]
  );
  deterministicFailure['code'] = code;
  deterministicFailure['path'] = path;
  const projectedFailure = first(report['failures'] as Record<string, unknown>[]);
  projectedFailure['code'] = code;
  projectedFailure['path'] = path;
  return report;
}

function stoppedConfirmationReport(): Record<string, unknown> {
  const report = cloneReport(passReport());
  report['status'] = 'behavioral_failure';
  report['exitCode'] = 1;
  const totals = report['totals'] as Record<string, unknown>;
  totals['scenarioPassed'] = 0;
  totals['scenarioBehavioralFailed'] = 1;
  const scenario = first(report['scenarios'] as Record<string, unknown>[]);
  scenario['status'] = 'behavioral_failure';
  scenario['exitCode'] = 1;
  scenario['deterministicFailures'] = [{ code: 'confirmation_button_unavailable', turnIndex: 2 }];
  report['failures'] = [
    {
      stage: 'deterministic',
      code: 'confirmation_button_unavailable',
      scenarioId: 'intex-eval-001',
      turnIndex: 2,
    },
  ];
  return report;
}

function preflightFailureReport(): EvaluationReportV1 {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    command: 'full',
    startedAt: STARTED_AT,
    finishedAt: STARTED_AT,
    durationMs: 0,
    status: 'infrastructure_failure',
    exitCode: 2,
    preflight: {
      status: 'failed',
      code: 'MINIMAX_KEY_MISSING',
      checks: [
        { check: 'runtime', status: 'passed' },
        { check: 'environment', status: 'passed' },
        { check: 'config', status: 'passed' },
        { check: 'matrix_files', status: 'passed' },
        { check: 'intex_agent_health', status: 'passed' },
        { check: 'whatsapp_health', status: 'passed' },
        { check: 'matrix_health', status: 'passed' },
        { check: 'firebase_identity', status: 'passed' },
        { check: 'matrix_identity', status: 'passed' },
        { check: 'whatsapp_delivery', status: 'passed' },
        { check: 'scenario_catalog', status: 'passed' },
        { check: 'minimax_probe', status: 'failed', code: 'MINIMAX_KEY_MISSING' },
      ],
    },
    totals: {
      scenarioCount: 0,
      scenarioPassed: 0,
      scenarioBehavioralFailed: 0,
      scenarioInfrastructureFailed: 0,
      turnCount: 0,
      replyCount: 0,
      toolCallCount: 0,
      judgeVerdictCount: 0,
    },
    judgeUsage: ZERO_USAGE,
    scenarios: [],
    failures: [{ stage: 'preflight', code: 'MINIMAX_KEY_MISSING' }],
  };
}

function matrixReport(): EvaluationReportV1 {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    command: 'matrix-smoke',
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    durationMs: 1_000,
    status: 'behavioral_failure',
    exitCode: 1,
    preflight: PASS_PREFLIGHT,
    totals: {
      scenarioCount: 0,
      scenarioPassed: 0,
      scenarioBehavioralFailed: 0,
      scenarioInfrastructureFailed: 0,
      turnCount: 0,
      replyCount: 0,
      toolCallCount: 0,
      judgeVerdictCount: 0,
    },
    judgeUsage: {
      callCount: 1,
      repairCount: 0,
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      providerReportedUsd: 0.0004,
      providerReportedUsdComplete: true,
    },
    scenarios: [],
    matrixSmoke: {
      status: 'behavioral_failure',
      exitCode: 1,
      failureCodes: [],
      durationMs: 900,
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      judge: {
        pass: false,
        score: 2,
        criteria: FAIL_CRITERIA,
        failures: ['unhelpful'],
      },
      judgeUsage: {
        callCount: 1,
        repairCount: 0,
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        providerReportedUsd: 0.0004,
        providerReportedUsdComplete: true,
      },
    },
    failures: [{ stage: 'judge', code: 'unhelpful' }],
  };
}

function unexpectedPreflightFailureReport(): EvaluationReportV1 {
  return {
    ...preflightFailureReport(),
    preflight: { status: 'failed', code: 'UNEXPECTED_FAILURE', checks: [] },
    failures: [{ stage: 'preflight', code: 'UNEXPECTED_FAILURE' }],
  };
}

function failedJudgeReport(): EvaluationReportV1 {
  const report = passReport();
  const baseScenario = first(report.scenarios);
  const firstVerdict = first(baseScenario.judgeVerdicts);
  return {
    ...report,
    status: 'infrastructure_failure',
    exitCode: 2,
    totals: {
      ...report.totals,
      scenarioPassed: 0,
      scenarioInfrastructureFailed: 1,
      judgeVerdictCount: 1,
    },
    judgeUsage: {
      callCount: 2,
      repairCount: 0,
      inputTokens: 31,
      outputTokens: 9,
      totalTokens: 40,
      providerReportedUsd: 0.00075,
      providerReportedUsdComplete: false,
    },
    scenarios: [
      {
        ...baseScenario,
        status: 'infrastructure_failure',
        exitCode: 2,
        judgeVerdicts: [firstVerdict],
      },
    ],
    failures: [
      {
        stage: 'judge',
        code: 'MINIMAX_JUDGE_INVALID_OUTPUT',
        scenarioId: 'intex-eval-001',
        turnIndex: 1,
        replyIndex: 0,
      },
    ],
  };
}

function cleanupInfrastructureReport(): EvaluationReportV1 {
  const report = passReport();
  const scenario = first(report.scenarios);
  return {
    ...report,
    status: 'infrastructure_failure',
    exitCode: 2,
    totals: {
      ...report.totals,
      scenarioPassed: 0,
      scenarioInfrastructureFailed: 1,
    },
    scenarios: [
      {
        ...scenario,
        status: 'infrastructure_failure',
        exitCode: 2,
        cleanup: { status: 'infrastructure_failure', code: 'cleanup_failed' },
      },
    ],
    failures: [
      {
        stage: 'cleanup',
        code: 'cleanup_failed',
        scenarioId: scenario.scenarioId,
      },
    ],
  };
}

function passedMatrixReport(): EvaluationReportV1 {
  const report = matrixReport();
  const matrixSmoke = report.matrixSmoke;
  if (matrixSmoke === undefined) throw new Error('Fixture must contain Matrix smoke');
  return {
    ...report,
    status: 'passed',
    exitCode: 0,
    matrixSmoke: {
      ...matrixSmoke,
      status: 'passed',
      exitCode: 0,
      judge: {
        pass: true,
        score: 5,
        criteria: PASS_CRITERIA,
        failures: [],
      },
    },
    failures: [],
  };
}

function matrixInfrastructureReport(): EvaluationReportV1 {
  const report = matrixReport();
  return {
    ...report,
    status: 'infrastructure_failure',
    exitCode: 2,
    judgeUsage: ZERO_USAGE,
    matrixSmoke: {
      status: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_SYNC_FAILED'],
      durationMs: 900,
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
        hiddenToolAudit: 'not_available',
      },
      judgeUsage: ZERO_USAGE,
    },
    failures: [{ stage: 'matrix_smoke', code: 'MATRIX_SYNC_FAILED' }],
  };
}

function endpointInterruptionReport(command: 'endpoint' | 'full' | 'scenario'): EvaluationReportV1 {
  const report = passReport();
  return {
    ...report,
    command,
    status: 'infrastructure_failure',
    exitCode: 2,
    totals: {
      scenarioCount: 0,
      scenarioPassed: 0,
      scenarioBehavioralFailed: 0,
      scenarioInfrastructureFailed: 0,
      turnCount: 0,
      replyCount: 0,
      toolCallCount: 0,
      judgeVerdictCount: 0,
    },
    judgeUsage: ZERO_USAGE,
    scenarios: [],
    failures: [{ stage: 'endpoint', code: 'endpoint_failed' }],
  };
}

function asReport(value: unknown): EvaluationReportV1 {
  return value as EvaluationReportV1;
}

function cloneReport(report: EvaluationReportV1): Record<string, unknown> {
  return structuredClone(report) as Record<string, unknown>;
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Fixture must contain an item');
  return value;
}

const temporaryRoots: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'intex-agent-report-test-'));
  temporaryRoots.push(root);
  return root;
}

function artifactRoot(repositoryRoot: string): string {
  return join(repositoryRoot, ...ARTIFACT_ROOT_PARTS);
}

function finalDirectory(repositoryRoot: string, runId = RUN_ID): string {
  return join(artifactRoot(repositoryRoot), runId);
}

async function expectPathUnavailable(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error('Expected path to be unavailable');
  } catch (error) {
    expect(error).toMatchObject({ code: expect.stringMatching(/^(?:ENOENT|ENOTDIR)$/u) });
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true }))
  );
});

describe('EvaluationReportV1Schema', () => {
  it.each([
    ['passed endpoint', passReport()],
    ['behavioral endpoint', behavioralReport()],
    ['partial infrastructure', preflightFailureReport()],
    ['redacted unexpected preflight infrastructure', unexpectedPreflightFailureReport()],
    ['Matrix smoke', matrixReport()],
    ['failed judge with partial usage', failedJudgeReport()],
  ])('strict-parses the exact %s report projection', (_name, report) => {
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
  });

  it.each([
    ['cleanup infrastructure', cleanupInfrastructureReport()],
    ['passed Matrix', passedMatrixReport()],
    ['Matrix infrastructure', matrixInfrastructureReport()],
    ['endpoint corpus interruption', endpointInterruptionReport('endpoint')],
    ['full corpus interruption before Matrix', endpointInterruptionReport('full')],
    ['scenario interruption before a result', endpointInterruptionReport('scenario')],
  ])('accepts the correlated %s whole-report fixture', (_name, report) => {
    expect(EvaluationReportV1Schema.parse(report)).toEqual(report);
  });

  it('enforces cleanup precedence and requires infrastructure evidence at scenario and report levels', () => {
    const passedWithFailedCleanup = cloneReport(passReport());
    first(passedWithFailedCleanup['scenarios'] as Record<string, unknown>[])['cleanup'] = {
      status: 'infrastructure_failure',
      code: 'cleanup_failed',
    };

    const behaviorWithNoCleanup = cloneReport(behavioralReport());
    first(behaviorWithNoCleanup['scenarios'] as Record<string, unknown>[])['cleanup'] = {
      status: 'not_required',
      code: 'identity_not_created',
    };

    const scenarioInfrastructureWithoutEvidence = cloneReport(failedJudgeReport());
    scenarioInfrastructureWithoutEvidence['failures'] = [
      {
        stage: 'judge',
        code: 'unhelpful',
        scenarioId: 'intex-eval-001',
        turnIndex: 0,
        replyIndex: 0,
      },
    ];

    const reportInfrastructureWithOnlyBehavior = cloneReport(behavioralReport());
    reportInfrastructureWithOnlyBehavior['status'] = 'infrastructure_failure';
    reportInfrastructureWithOnlyBehavior['exitCode'] = 2;

    const behaviorHidingGlobalInfrastructure = cloneReport(behavioralReport());
    (behaviorHidingGlobalInfrastructure['failures'] as Record<string, unknown>[]).push({
      stage: 'endpoint',
      code: 'endpoint_failed',
    });

    const passedPreflightWithFailedCheck = cloneReport(passReport());
    const preflightChecks = (
      passedPreflightWithFailedCheck['preflight'] as Record<string, unknown>
    )['checks'] as Record<string, unknown>[];
    preflightChecks[0] = {
      check: 'runtime',
      status: 'failed',
      code: 'HOME_DEV_REQUIRED',
    };

    const passedPreflightWithoutChecks = cloneReport(passReport());
    (passedPreflightWithoutChecks['preflight'] as Record<string, unknown>)['checks'] = [];

    const passedPreflightWithDuplicateCheck = cloneReport(passReport());
    (
      (passedPreflightWithDuplicateCheck['preflight'] as Record<string, unknown>)[
        'checks'
      ] as Record<string, unknown>[]
    ).push({ check: 'runtime', status: 'passed' });

    const failedPreflightWithoutFailedCheck = cloneReport(preflightFailureReport());
    const failedChecksWithoutEvidence = (
      failedPreflightWithoutFailedCheck['preflight'] as Record<string, unknown>
    )['checks'] as Record<string, unknown>[];
    failedChecksWithoutEvidence.pop();

    const failedPreflightWithDuplicatePrefix = cloneReport(preflightFailureReport());
    const duplicatePrefixChecks = (
      failedPreflightWithDuplicatePrefix['preflight'] as Record<string, unknown>
    )['checks'] as Record<string, unknown>[];
    duplicatePrefixChecks.splice(1, 0, { check: 'runtime', status: 'passed' });

    const failedPreflightWithNoncanonicalPrefix = cloneReport(preflightFailureReport());
    const noncanonicalPrefixChecks = (
      failedPreflightWithNoncanonicalPrefix['preflight'] as Record<string, unknown>
    )['checks'] as Record<string, unknown>[];
    const environmentCheck = noncanonicalPrefixChecks[1];
    const configCheck = noncanonicalPrefixChecks[2];
    if (environmentCheck === undefined || configCheck === undefined) {
      throw new Error('Fixture must contain the canonical preflight prefix');
    }
    noncanonicalPrefixChecks[1] = configCheck;
    noncanonicalPrefixChecks[2] = environmentCheck;

    for (const candidate of [
      passedWithFailedCleanup,
      behaviorWithNoCleanup,
      scenarioInfrastructureWithoutEvidence,
      reportInfrastructureWithOnlyBehavior,
      behaviorHidingGlobalInfrastructure,
      passedPreflightWithFailedCheck,
      passedPreflightWithoutChecks,
      passedPreflightWithDuplicateCheck,
      failedPreflightWithoutFailedCheck,
      failedPreflightWithDuplicatePrefix,
      failedPreflightWithNoncanonicalPrefix,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('requires global and scenario evidence to correlate in both directions', () => {
    const failurePointsAtMissingScenario = cloneReport(behavioralReport());
    first(failurePointsAtMissingScenario['failures'] as Record<string, unknown>[])['scenarioId'] =
      'intex-eval-999';

    const failureDoesNotMatchLocalEvidence = cloneReport(behavioralReport());
    first(failureDoesNotMatchLocalEvidence['failures'] as Record<string, unknown>[])['code'] =
      'transition_mismatch';

    const localEvidenceHasNoGlobalProjection = cloneReport(behavioralReport());
    localEvidenceHasNoGlobalProjection['failures'] = [
      (localEvidenceHasNoGlobalProjection['failures'] as Record<string, unknown>[])[1],
    ];

    const cleanupDoesNotMatchProjection = cloneReport(cleanupInfrastructureReport());
    first(cleanupDoesNotMatchProjection['failures'] as Record<string, unknown>[])['code'] =
      'identity_not_created';

    const matrixCodeHasNoGlobalProjection = cloneReport(matrixInfrastructureReport());
    matrixCodeHasNoGlobalProjection['failures'] = [];

    const failedPreflightCannotContainEndpointEvidence = cloneReport(preflightFailureReport());
    (failedPreflightCannotContainEndpointEvidence['failures'] as Record<string, unknown>[]).push({
      stage: 'endpoint',
      code: 'endpoint_failed',
    });

    const matrixOnlyCannotContainEndpointEvidence = cloneReport(passedMatrixReport());
    matrixOnlyCannotContainEndpointEvidence['status'] = 'infrastructure_failure';
    matrixOnlyCannotContainEndpointEvidence['exitCode'] = 2;
    matrixOnlyCannotContainEndpointEvidence['failures'] = [
      { stage: 'endpoint', code: 'endpoint_failed' },
    ];

    for (const candidate of [
      failurePointsAtMissingScenario,
      failureDoesNotMatchLocalEvidence,
      localEvidenceHasNoGlobalProjection,
      cleanupDoesNotMatchProjection,
      matrixCodeHasNoGlobalProjection,
      failedPreflightCannotContainEndpointEvidence,
      matrixOnlyCannotContainEndpointEvidence,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('enforces catalog completeness while preserving endpoint-side infrastructure interruption', () => {
    const incompleteEndpoint = cloneReport(passReport());
    (incompleteEndpoint['preflight'] as Record<string, unknown>)['scenarioCount'] = 2;

    const moreThanCatalog = cloneReport(passReport());
    (moreThanCatalog['preflight'] as Record<string, unknown>)['scenarioCount'] = 0;

    const missingScenarioResult = cloneReport(endpointInterruptionReport('scenario'));
    missingScenarioResult['failures'] = [];
    missingScenarioResult['status'] = 'passed';
    missingScenarioResult['exitCode'] = 0;

    const matrixFailureCannotShortenEndpointCorpus = cloneReport(passReport());
    matrixFailureCannotShortenEndpointCorpus['command'] = 'full';
    matrixFailureCannotShortenEndpointCorpus['status'] = 'infrastructure_failure';
    matrixFailureCannotShortenEndpointCorpus['exitCode'] = 2;
    (matrixFailureCannotShortenEndpointCorpus['preflight'] as Record<string, unknown>)[
      'scenarioCount'
    ] = 2;
    matrixFailureCannotShortenEndpointCorpus['matrixSmoke'] =
      matrixInfrastructureReport().matrixSmoke;
    matrixFailureCannotShortenEndpointCorpus['failures'] = [
      { stage: 'matrix_smoke', code: 'MATRIX_SYNC_FAILED' },
    ];

    const globalEndpointInterruptionCannotContainMatrix = cloneReport(
      endpointInterruptionReport('full')
    );
    globalEndpointInterruptionCannotContainMatrix['judgeUsage'] = passedMatrixReport().judgeUsage;
    globalEndpointInterruptionCannotContainMatrix['matrixSmoke'] = passedMatrixReport().matrixSmoke;

    const scenarioEndpointInterruptionCannotContainMatrix = cloneReport(passReport());
    scenarioEndpointInterruptionCannotContainMatrix['command'] = 'full';
    scenarioEndpointInterruptionCannotContainMatrix['status'] = 'infrastructure_failure';
    scenarioEndpointInterruptionCannotContainMatrix['exitCode'] = 2;
    scenarioEndpointInterruptionCannotContainMatrix['totals'] = {
      ...passReport().totals,
      scenarioPassed: 0,
      scenarioInfrastructureFailed: 1,
    };
    const interruptedScenario = first(
      scenarioEndpointInterruptionCannotContainMatrix['scenarios'] as Record<string, unknown>[]
    );
    interruptedScenario['status'] = 'infrastructure_failure';
    interruptedScenario['exitCode'] = 2;
    scenarioEndpointInterruptionCannotContainMatrix['matrixSmoke'] =
      passedMatrixReport().matrixSmoke;
    scenarioEndpointInterruptionCannotContainMatrix['failures'] = [
      {
        stage: 'endpoint',
        code: 'endpoint_transport_failed',
        scenarioId: 'intex-eval-001',
      },
    ];

    const interruptedSingleScenarioCannotContainMultipleResults = cloneReport(passReport());
    interruptedSingleScenarioCannotContainMultipleResults['command'] = 'scenario';
    interruptedSingleScenarioCannotContainMultipleResults['status'] = 'infrastructure_failure';
    interruptedSingleScenarioCannotContainMultipleResults['exitCode'] = 2;
    (interruptedSingleScenarioCannotContainMultipleResults['preflight'] as Record<string, unknown>)[
      'scenarioCount'
    ] = 2;
    const secondScenario = structuredClone(
      first(
        interruptedSingleScenarioCannotContainMultipleResults['scenarios'] as Record<
          string,
          unknown
        >[]
      )
    );
    secondScenario['scenarioId'] = 'intex-eval-002';
    for (const verdict of secondScenario['judgeVerdicts'] as Record<string, unknown>[]) {
      verdict['scenarioId'] = 'intex-eval-002';
    }
    (
      interruptedSingleScenarioCannotContainMultipleResults['scenarios'] as Record<
        string,
        unknown
      >[]
    ).push(secondScenario);
    interruptedSingleScenarioCannotContainMultipleResults['totals'] = {
      scenarioCount: 2,
      scenarioPassed: 2,
      scenarioBehavioralFailed: 0,
      scenarioInfrastructureFailed: 0,
      turnCount: 4,
      replyCount: 4,
      toolCallCount: 2,
      judgeVerdictCount: 4,
    };
    (
      interruptedSingleScenarioCannotContainMultipleResults['judgeUsage'] as Record<string, unknown>
    )['callCount'] = 4;
    interruptedSingleScenarioCannotContainMultipleResults['failures'] = [
      { stage: 'endpoint', code: 'endpoint_failed' },
    ];

    for (const candidate of [
      incompleteEndpoint,
      moreThanCatalog,
      missingScenarioResult,
      matrixFailureCannotShortenEndpointCorpus,
      globalEndpointInterruptionCannotContainMatrix,
      scenarioEndpointInterruptionCannotContainMatrix,
      interruptedSingleScenarioCannotContainMultipleResults,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('enforces judge call, repair, and Matrix evidence lower bounds without additive token or cost rules', () => {
    const impossibleRepairCount = cloneReport(passReport());
    (impossibleRepairCount['judgeUsage'] as Record<string, unknown>)['repairCount'] = 2;

    const endpointVerdictsWithoutCalls = cloneReport(passReport());
    endpointVerdictsWithoutCalls['judgeUsage'] = ZERO_USAGE;

    const passedMatrixWithoutTransport = cloneReport(passedMatrixReport());
    (
      (passedMatrixWithoutTransport['matrixSmoke'] as Record<string, unknown>)[
        'transportFacts'
      ] as Record<string, unknown>
    )['outboundSent'] = false;

    const passedMatrixWithoutCalls = cloneReport(passedMatrixReport());
    passedMatrixWithoutCalls['judgeUsage'] = ZERO_USAGE;
    (passedMatrixWithoutCalls['matrixSmoke'] as Record<string, unknown>)['judgeUsage'] = ZERO_USAGE;

    const matrixInfrastructureWithoutEvidence = cloneReport(matrixInfrastructureReport());
    (matrixInfrastructureWithoutEvidence['matrixSmoke'] as Record<string, unknown>)[
      'failureCodes'
    ] = [];
    matrixInfrastructureWithoutEvidence['failures'] = [];

    for (const candidate of [
      impossibleRepairCount,
      endpointVerdictsWithoutCalls,
      passedMatrixWithoutTransport,
      passedMatrixWithoutCalls,
      matrixInfrastructureWithoutEvidence,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('requires bounded deterministic and global failure references', () => {
    const deterministicReplyOutOfRange = cloneReport(behavioralReport());
    const deterministicScenario = first(
      deterministicReplyOutOfRange['scenarios'] as Record<string, unknown>[]
    );
    first(deterministicScenario['deterministicFailures'] as Record<string, unknown>[])[
      'replyIndex'
    ] = 2;
    first(deterministicReplyOutOfRange['failures'] as Record<string, unknown>[])['replyIndex'] = 2;

    const turnWithoutScenario = cloneReport(matrixReport());
    first(turnWithoutScenario['failures'] as Record<string, unknown>[])['turnIndex'] = 0;

    const globalTurnOutOfRange = cloneReport(failedJudgeReport());
    first(globalTurnOutOfRange['failures'] as Record<string, unknown>[])['turnIndex'] = 2;

    const globalReplyOutOfRange = cloneReport(failedJudgeReport());
    first(globalReplyOutOfRange['failures'] as Record<string, unknown>[])['replyIndex'] = 2;

    for (const candidate of [
      deterministicReplyOutOfRange,
      turnWithoutScenario,
      globalTurnOutOfRange,
      globalReplyOutOfRange,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('accepts the closed stopped-confirmation failure at the executed-prefix boundary', () => {
    const report = stoppedConfirmationReport();

    const parsed = EvaluationReportV1Schema.safeParse(report);

    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed)).not.toMatch(/assistantText|rationale|rawResponse/u);
  });

  it.each([
    [
      'missing turn index',
      (failure: Record<string, unknown>): void => {
        delete failure['turnIndex'];
      },
    ],
    [
      'reply index',
      (failure: Record<string, unknown>): void => {
        failure['replyIndex'] = 0;
      },
    ],
    [
      'turn before prefix boundary',
      (failure: Record<string, unknown>): void => {
        failure['turnIndex'] = 1;
      },
    ],
    [
      'turn after prefix boundary',
      (failure: Record<string, unknown>): void => {
        failure['turnIndex'] = 3;
      },
    ],
  ])('rejects stopped-confirmation evidence with %s', (_label, mutate) => {
    const report = stoppedConfirmationReport();
    const scenario = first(report['scenarios'] as Record<string, unknown>[]);
    const scenarioFailure = first(scenario['deterministicFailures'] as Record<string, unknown>[]);
    const globalFailure = first(report['failures'] as Record<string, unknown>[]);
    mutate(scenarioFailure);
    mutate(globalFailure);

    expect(EvaluationReportV1Schema.safeParse(report).success).toBe(false);
  });

  it('keeps the executed-turn upper bound exclusive for every other deterministic code', () => {
    const report = stoppedConfirmationReport();
    const scenario = first(report['scenarios'] as Record<string, unknown>[]);
    first(scenario['deterministicFailures'] as Record<string, unknown>[])['code'] =
      'forbidden_tool_called';
    first(report['failures'] as Record<string, unknown>[])['code'] = 'forbidden_tool_called';

    expect(EvaluationReportV1Schema.safeParse(report).success).toBe(false);
  });

  it.each([
    ['passed', 1],
    ['behavioral_failure', 0],
    ['infrastructure_failure', 1],
  ])('rejects contradictory status/exit pair %s/%s', (status, exitCode) => {
    expect(EvaluationReportV1Schema.safeParse({ ...passReport(), status, exitCode }).success).toBe(
      false
    );
  });

  it('rejects unknown and privacy-forbidden nested fields', () => {
    const cases: unknown[] = [];

    const topLevel = cloneReport(passReport());
    topLevel['rawResponse'] = 'private-http-body-sentinel';
    cases.push(topLevel);

    const scenario = cloneReport(passReport());
    first(scenario['scenarios'] as Record<string, unknown>[])['assistantText'] =
      'private-assistant-text-sentinel';
    cases.push(scenario);

    const verdict = cloneReport(passReport());
    const firstScenario = first(verdict['scenarios'] as Record<string, unknown>[]);
    first(firstScenario['judgeVerdicts'] as Record<string, unknown>[])['rationale'] =
      'private-rationale-sentinel';
    cases.push(verdict);

    const matrix = cloneReport(matrixReport());
    (matrix['matrixSmoke'] as Record<string, unknown>)['roomId'] =
      '!private-room-id-sentinel:home-dev';
    cases.push(matrix);

    for (const candidate of cases) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('accepts only schema-whitelisted paths on deterministic assertion failures', () => {
    expect(EvaluationReportV1Schema.safeParse(assertionFailureReport()).success).toBe(true);
    expect(
      EvaluationReportV1Schema.safeParse(
        assertionFailureReport('status', 'timeline_payload_assertion_failed')
      ).success
    ).toBe(true);

    for (const path of ['private-tool-argument-sentinel', 'argsSummary.privateValue']) {
      expect(EvaluationReportV1Schema.safeParse(assertionFailureReport(path)).success).toBe(false);
    }
    expect(
      EvaluationReportV1Schema.safeParse(assertionFailureReport('argsSummary.workerType')).success
    ).toBe(false);
    expect(
      EvaluationReportV1Schema.safeParse(
        assertionFailureReport('contentLength', 'timeline_payload_assertion_failed')
      ).success
    ).toBe(false);

    const nonAssertion = cloneReport(behavioralReport());
    const scenario = first(nonAssertion['scenarios'] as Record<string, unknown>[]);
    first(scenario['deterministicFailures'] as Record<string, unknown>[])['path'] = 'contentLength';
    first(nonAssertion['failures'] as Record<string, unknown>[])['path'] = 'contentLength';
    expect(EvaluationReportV1Schema.safeParse(nonAssertion).success).toBe(false);

    const mismatchedProjection = assertionFailureReport();
    first(mismatchedProjection['failures'] as Record<string, unknown>[])['path'] = 'promptLength';
    expect(EvaluationReportV1Schema.safeParse(mismatchedProjection).success).toBe(false);
  });

  it('rejects invalid closed codes and stage/code mismatches', () => {
    const unknownCode = cloneReport(preflightFailureReport());
    first(unknownCode['failures'] as Record<string, unknown>[])['code'] = 'RAW_ERROR';
    expect(EvaluationReportV1Schema.safeParse(unknownCode).success).toBe(false);

    const wrongStage = cloneReport(preflightFailureReport());
    first(wrongStage['failures'] as Record<string, unknown>[])['stage'] = 'judge';
    expect(EvaluationReportV1Schema.safeParse(wrongStage).success).toBe(false);

    const overlappingJudgeCodeInMatrixStage = cloneReport(matrixInfrastructureReport());
    (overlappingJudgeCodeInMatrixStage['matrixSmoke'] as Record<string, unknown>)['failureCodes'] =
      ['MINIMAX_JUDGE_TIMEOUT'];
    overlappingJudgeCodeInMatrixStage['failures'] = [
      { stage: 'judge', code: 'MINIMAX_JUDGE_TIMEOUT' },
      { stage: 'matrix_smoke', code: 'MINIMAX_JUDGE_TIMEOUT' },
    ];
    expect(EvaluationReportV1Schema.safeParse(overlappingJudgeCodeInMatrixStage).success).toBe(
      false
    );
    expect(
      SafeReportFailureV1Schema.safeParse({
        stage: 'matrix_smoke',
        code: 'MINIMAX_JUDGE_TIMEOUT',
      }).success
    ).toBe(false);
  });

  it.each(['../escape', '/absolute', '', 'Uppercase', '.hidden', 'a'.repeat(97)])(
    'rejects unsafe report run ID %s',
    (runId) => {
      expect(EvaluationReportV1Schema.safeParse({ ...passReport(), runId }).success).toBe(false);
    }
  );

  it.each(['trailing-', 'trailing_', 'trailing.', 'contains..dots'])(
    'accepts a safe report run ID permitted by the exact contract: %s',
    (runId) => {
      expect(EvaluationReportV1Schema.safeParse({ ...passReport(), runId }).success).toBe(true);
    }
  );

  it('requires the authorized Matrix stage only after a fully passing endpoint corpus', () => {
    const matrixOnlyWithoutMatrix: EvaluationReportV1 = {
      ...preflightFailureReport(),
      command: 'matrix-smoke',
      status: 'passed',
      exitCode: 0,
      preflight: PASS_PREFLIGHT,
      failures: [],
    };
    expect(EvaluationReportV1Schema.safeParse(matrixOnlyWithoutMatrix).success).toBe(false);
    expect(EvaluationReportV1Schema.safeParse({ ...passReport(), command: 'full' }).success).toBe(
      false
    );
    expect(
      EvaluationReportV1Schema.safeParse({ ...behavioralReport(), command: 'full' }).success
    ).toBe(true);
    expect(
      EvaluationReportV1Schema.safeParse({
        ...behavioralReport(),
        command: 'full',
        matrixSmoke: passedMatrixReport().matrixSmoke,
      }).success
    ).toBe(false);
    expect(
      EvaluationReportV1Schema.safeParse({ ...failedJudgeReport(), command: 'full' }).success
    ).toBe(true);
  });

  it('requires exact top-level Matrix judge usage for a Matrix-only run', () => {
    const report = matrixReport();
    expect(
      EvaluationReportV1Schema.safeParse({
        ...report,
        judgeUsage: { ...report.judgeUsage, providerReportedUsd: 0.0005 },
      }).success
    ).toBe(false);
  });

  it('rejects invalid timestamps, duration, numbers, totals, duplicates, and incomplete pass cost', () => {
    const candidates: unknown[] = [
      { ...passReport(), startedAt: '2026-07-16T21:02:17' },
      { ...passReport(), finishedAt: 'not-a-timestamp' },
      { ...passReport(), durationMs: 999 },
      { ...passReport(), durationMs: -1 },
      { ...passReport(), totals: { ...passReport().totals, turnCount: 3 } },
      {
        ...passReport(),
        scenarios: [...passReport().scenarios, passReport().scenarios[0]],
        totals: { ...passReport().totals, scenarioCount: 2, scenarioPassed: 2 },
      },
      {
        ...passReport(),
        judgeUsage: { ...passReport().judgeUsage, providerReportedUsdComplete: false },
      },
      {
        ...passReport(),
        judgeUsage: { ...passReport().judgeUsage, providerReportedUsd: Number.NaN },
      },
    ];

    for (const candidate of candidates) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it('accepts provider-reported total tokens independently of input plus output', () => {
    const report = passReport();
    expect(report.judgeUsage.totalTokens).not.toBe(
      report.judgeUsage.inputTokens + report.judgeUsage.outputTokens
    );
    expect(EvaluationReportV1Schema.parse(report).judgeUsage).toEqual(report.judgeUsage);
  });

  it('rejects duplicate verdict references, duplicate tools, incoherent verdicts, and mismatched cleanup', () => {
    const duplicateVerdict = cloneReport(passReport());
    const scenario = first(duplicateVerdict['scenarios'] as Record<string, unknown>[]);
    const verdicts = scenario['judgeVerdicts'] as Record<string, unknown>[];
    verdicts[1] = structuredClone(first(verdicts));

    const duplicateTool = cloneReport(passReport());
    const duplicateToolScenario = first(duplicateTool['scenarios'] as Record<string, unknown>[]);
    duplicateToolScenario['toolSummaries'] = [
      ...(duplicateToolScenario['toolSummaries'] as Record<string, unknown>[]),
      { toolName: 'create_note', completedCount: 0, failedCount: 0 },
    ];

    const contradictoryVerdict = cloneReport(passReport());
    const contradictoryScenario = first(
      contradictoryVerdict['scenarios'] as Record<string, unknown>[]
    );
    first(contradictoryScenario['judgeVerdicts'] as Record<string, unknown>[])['pass'] = false;

    const cleanup = cloneReport(passReport());
    const cleanupScenario = first(cleanup['scenarios'] as Record<string, unknown>[]);
    cleanupScenario['cleanup'] = { status: 'passed', deleted: 2, total: 3 };

    const outOfRangeReply = cloneReport(passReport());
    const outOfRangeScenario = first(outOfRangeReply['scenarios'] as Record<string, unknown>[]);
    first(outOfRangeScenario['judgeVerdicts'] as Record<string, unknown>[])['replyIndex'] = 2;

    for (const candidate of [
      duplicateVerdict,
      duplicateTool,
      contradictoryVerdict,
      cleanup,
      outOfRangeReply,
    ]) {
      expect(EvaluationReportV1Schema.safeParse(candidate).success).toBe(false);
    }
  });
});

describe('private atomic report writer', () => {
  it('writes whitelisted assertion paths to JSON and Markdown without private failure values', async () => {
    const repositoryRoot = await createRepositoryRoot();
    expect(
      await createReportWriter({ repositoryRoot })(asReport(assertionFailureReport()))
    ).toMatchObject({ ok: true });

    const json = await readFile(join(finalDirectory(repositoryRoot), 'report.json'), 'utf8');
    const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const scenario = first(parsed['scenarios'] as Record<string, unknown>[]);
    expect(first(scenario['deterministicFailures'] as Record<string, unknown>[])).toEqual({
      code: 'tool_argument_assertion_failed',
      turnIndex: 1,
      path: 'contentLength',
    });
    expect(first(parsed['failures'] as Record<string, unknown>[])).toEqual({
      stage: 'deterministic',
      code: 'tool_argument_assertion_failed',
      scenarioId: 'intex-eval-001',
      turnIndex: 1,
      path: 'contentLength',
    });
    expect(markdown).toContain(
      '| `intex-eval-001` | `tool_argument_assertion_failed` | `contentLength` | 1 | - |'
    );
    expect(markdown).toContain(
      '| `deterministic` | `tool_argument_assertion_failed` | `contentLength` | `intex-eval-001` | 1 | - |'
    );
    expect(`${json}\n${markdown}`).not.toMatch(
      /private-(?:expected|actual|message|tool)-sentinel/u
    );
  });

  it('publishes a parsed JSON/Markdown pair and returns only the fixed relative directory', async () => {
    const repositoryRoot = await createRepositoryRoot();
    const result = await createReportWriter({ repositoryRoot })(passReport());

    expect(result).toEqual({
      ok: true,
      relativeDirectory: `.artifacts/intex-agent-evals/${RUN_ID}`,
    });
    const json = await readFile(join(finalDirectory(repositoryRoot), 'report.json'), 'utf8');
    const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
    expect(json).toBe(`${JSON.stringify(passReport(), null, 2)}\n`);
    expect(markdown).toMatchInlineSnapshot(`
      "# Intex Agent evaluation report

      ## Run summary

      | Field | Value |
      | --- | --- |
      | Run ID | \`evaluation-run-20260716-230217\` |
      | Command | \`endpoint\` |
      | Status | \`passed\` |
      | Exit code | 0 |
      | Started | \`2026-07-16T21:02:17.000Z\` |
      | Finished | \`2026-07-16T21:02:18.000Z\` |
      | Duration (ms) | 1000 |
      | Preflight | \`passed\` |
      | Host | \`home-dev\` |
      | Account alias | \`operator-evals\` |
      | Judge model | \`or:minimax/minimax-m3\` |

      ## Totals

      | Metric | Value |
      | --- | ---: |
      | Scenarios | 1 |
      | Passed scenarios | 1 |
      | Behavioral failures | 0 |
      | Infrastructure failures | 0 |
      | Turns | 2 |
      | Replies | 2 |
      | Tool calls | 1 |
      | Judge verdicts | 2 |

      ## Judge usage

      | Metric | Value |
      | --- | ---: |
      | Calls | 3 |
      | Repairs | 1 |
      | Input tokens | 40 |
      | Output tokens | 20 |
      | Provider total tokens | 61 |
      | Provider-reported USD | 0.00125 |
      | Provider cost complete | true |

      ## Scenarios

      | Scenario | Status | Exit | Duration (ms) | Turns | Replies | Tool calls |
      | --- | --- | ---: | ---: | ---: | ---: | ---: |
      | \`intex-eval-001\` | \`passed\` | 0 | 800 | 2 | 2 | 1 |

      ## Tool summaries

      | Scenario | Tool | Completed | Failed |
      | --- | --- | ---: | ---: |
      | \`intex-eval-001\` | \`create_note\` | 1 | 0 |

      ## Deterministic failures

      | Scenario | Code | Path | Turn | Reply |
      | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | - | - |

      ## Judge verdicts

      | Scenario | Turn | Reply | Pass | Score | Intent | Helpful | Clear | Professional | No passive aggression | Failures |
      | --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
      | \`intex-eval-001\` | 0 | 0 | true | 5 | true | true | true | true | true | _none_ |
      | \`intex-eval-001\` | 1 | 0 | true | 5 | true | true | true | true | true | _none_ |

      ## Cleanup

      | Scenario | Status | Code | Deleted | Total |
      | --- | --- | --- | ---: | ---: |
      | \`intex-eval-001\` | \`passed\` | _none_ | 3 | 3 |

      ## Failures

      | Stage | Code | Path | Scenario | Turn | Reply |
      | --- | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | _none_ | - | - |
      "
    `);
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
    expect(json.endsWith('\n\n')).toBe(false);
  });

  it('matches the complete behavioral Markdown snapshot', async () => {
    const repositoryRoot = await createRepositoryRoot();
    expect(await createReportWriter({ repositoryRoot })(behavioralReport())).toMatchObject({
      ok: true,
    });
    const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
    expect(markdown).toMatchInlineSnapshot(`
      "# Intex Agent evaluation report

      ## Run summary

      | Field | Value |
      | --- | --- |
      | Run ID | \`evaluation-run-20260716-230217\` |
      | Command | \`endpoint\` |
      | Status | \`behavioral_failure\` |
      | Exit code | 1 |
      | Started | \`2026-07-16T21:02:17.000Z\` |
      | Finished | \`2026-07-16T21:02:18.000Z\` |
      | Duration (ms) | 1000 |
      | Preflight | \`passed\` |
      | Host | \`home-dev\` |
      | Account alias | \`operator-evals\` |
      | Judge model | \`or:minimax/minimax-m3\` |

      ## Totals

      | Metric | Value |
      | --- | ---: |
      | Scenarios | 1 |
      | Passed scenarios | 0 |
      | Behavioral failures | 1 |
      | Infrastructure failures | 0 |
      | Turns | 2 |
      | Replies | 2 |
      | Tool calls | 1 |
      | Judge verdicts | 2 |

      ## Judge usage

      | Metric | Value |
      | --- | ---: |
      | Calls | 3 |
      | Repairs | 1 |
      | Input tokens | 40 |
      | Output tokens | 20 |
      | Provider total tokens | 61 |
      | Provider-reported USD | 0.00125 |
      | Provider cost complete | true |

      ## Scenarios

      | Scenario | Status | Exit | Duration (ms) | Turns | Replies | Tool calls |
      | --- | --- | ---: | ---: | ---: | ---: | ---: |
      | \`intex-eval-001\` | \`behavioral_failure\` | 1 | 800 | 2 | 2 | 1 |

      ## Tool summaries

      | Scenario | Tool | Completed | Failed |
      | --- | --- | ---: | ---: |
      | \`intex-eval-001\` | \`create_note\` | 1 | 0 |

      ## Deterministic failures

      | Scenario | Code | Path | Turn | Reply |
      | --- | --- | --- | ---: | ---: |
      | \`intex-eval-001\` | \`forbidden_tool_called\` | - | 1 | - |

      ## Judge verdicts

      | Scenario | Turn | Reply | Pass | Score | Intent | Helpful | Clear | Professional | No passive aggression | Failures |
      | --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
      | \`intex-eval-001\` | 0 | 0 | true | 5 | true | true | true | true | true | _none_ |
      | \`intex-eval-001\` | 1 | 0 | false | 2 | true | false | true | true | true | \`unhelpful\` |

      ## Cleanup

      | Scenario | Status | Code | Deleted | Total |
      | --- | --- | --- | ---: | ---: |
      | \`intex-eval-001\` | \`passed\` | _none_ | 3 | 3 |

      ## Failures

      | Stage | Code | Path | Scenario | Turn | Reply |
      | --- | --- | --- | --- | ---: | ---: |
      | \`deterministic\` | \`forbidden_tool_called\` | - | \`intex-eval-001\` | 1 | - |
      | \`judge\` | \`unhelpful\` | - | \`intex-eval-001\` | 1 | 0 |
      "
    `);
  });

  it('matches the complete partial-infrastructure Markdown snapshot', async () => {
    const repositoryRoot = await createRepositoryRoot();
    expect(await createReportWriter({ repositoryRoot })(preflightFailureReport())).toMatchObject({
      ok: true,
    });
    const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
    expect(markdown).toMatchInlineSnapshot(`
      "# Intex Agent evaluation report

      ## Run summary

      | Field | Value |
      | --- | --- |
      | Run ID | \`evaluation-run-20260716-230217\` |
      | Command | \`full\` |
      | Status | \`infrastructure_failure\` |
      | Exit code | 2 |
      | Started | \`2026-07-16T21:02:17.000Z\` |
      | Finished | \`2026-07-16T21:02:17.000Z\` |
      | Duration (ms) | 0 |
      | Preflight | \`failed\` |
      | Preflight failure | \`MINIMAX_KEY_MISSING\` |

      ## Totals

      | Metric | Value |
      | --- | ---: |
      | Scenarios | 0 |
      | Passed scenarios | 0 |
      | Behavioral failures | 0 |
      | Infrastructure failures | 0 |
      | Turns | 0 |
      | Replies | 0 |
      | Tool calls | 0 |
      | Judge verdicts | 0 |

      ## Judge usage

      | Metric | Value |
      | --- | ---: |
      | Calls | 0 |
      | Repairs | 0 |
      | Input tokens | 0 |
      | Output tokens | 0 |
      | Provider total tokens | 0 |
      | Provider-reported USD | 0 |
      | Provider cost complete | true |

      ## Scenarios

      | Scenario | Status | Exit | Duration (ms) | Turns | Replies | Tool calls |
      | --- | --- | ---: | ---: | ---: | ---: | ---: |
      | _none_ | _none_ | - | - | - | - | - |

      ## Tool summaries

      | Scenario | Tool | Completed | Failed |
      | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | - |

      ## Deterministic failures

      | Scenario | Code | Path | Turn | Reply |
      | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | - | - |

      ## Judge verdicts

      | Scenario | Turn | Reply | Pass | Score | Intent | Helpful | Clear | Professional | No passive aggression | Failures |
      | --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
      | _none_ | - | - | - | - | - | - | - | - | - | _none_ |

      ## Cleanup

      | Scenario | Status | Code | Deleted | Total |
      | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | _none_ | - | - |

      ## Failures

      | Stage | Code | Path | Scenario | Turn | Reply |
      | --- | --- | --- | --- | ---: | ---: |
      | \`preflight\` | \`MINIMAX_KEY_MISSING\` | - | _none_ | - | - |
      "
    `);
  });

  it('matches the complete Matrix Markdown snapshot', async () => {
    const repositoryRoot = await createRepositoryRoot();
    expect(await createReportWriter({ repositoryRoot })(matrixReport())).toMatchObject({
      ok: true,
    });
    const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
    expect(markdown).toMatchInlineSnapshot(`
      "# Intex Agent evaluation report

      ## Run summary

      | Field | Value |
      | --- | --- |
      | Run ID | \`evaluation-run-20260716-230217\` |
      | Command | \`matrix-smoke\` |
      | Status | \`behavioral_failure\` |
      | Exit code | 1 |
      | Started | \`2026-07-16T21:02:17.000Z\` |
      | Finished | \`2026-07-16T21:02:18.000Z\` |
      | Duration (ms) | 1000 |
      | Preflight | \`passed\` |
      | Host | \`home-dev\` |
      | Account alias | \`operator-evals\` |
      | Judge model | \`or:minimax/minimax-m3\` |

      ## Totals

      | Metric | Value |
      | --- | ---: |
      | Scenarios | 0 |
      | Passed scenarios | 0 |
      | Behavioral failures | 0 |
      | Infrastructure failures | 0 |
      | Turns | 0 |
      | Replies | 0 |
      | Tool calls | 0 |
      | Judge verdicts | 0 |

      ## Judge usage

      | Metric | Value |
      | --- | ---: |
      | Calls | 1 |
      | Repairs | 0 |
      | Input tokens | 12 |
      | Output tokens | 4 |
      | Provider total tokens | 16 |
      | Provider-reported USD | 0.0004 |
      | Provider cost complete | true |

      ## Scenarios

      | Scenario | Status | Exit | Duration (ms) | Turns | Replies | Tool calls |
      | --- | --- | ---: | ---: | ---: | ---: | ---: |
      | _none_ | _none_ | - | - | - | - | - |

      ## Tool summaries

      | Scenario | Tool | Completed | Failed |
      | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | - |

      ## Deterministic failures

      | Scenario | Code | Path | Turn | Reply |
      | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | - | - | - |

      ## Judge verdicts

      | Scenario | Turn | Reply | Pass | Score | Intent | Helpful | Clear | Professional | No passive aggression | Failures |
      | --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
      | _none_ | - | - | - | - | - | - | - | - | - | _none_ |

      ## Cleanup

      | Scenario | Status | Code | Deleted | Total |
      | --- | --- | --- | ---: | ---: |
      | _none_ | _none_ | _none_ | - | - |

      ## Failures

      | Stage | Code | Path | Scenario | Turn | Reply |
      | --- | --- | --- | --- | ---: | ---: |
      | \`judge\` | \`unhelpful\` | - | _none_ | - | - |

      ## Matrix smoke

      | Field | Value |
      | --- | --- |
      | Status | \`behavioral_failure\` |
      | Exit code | 1 |
      | Duration (ms) | 900 |
      | Failure codes | _none_ |
      | Cursor captured | true |
      | Outbound sent | true |
      | Eligible puppet text observed | true |
      | Hidden tool audit | \`not_available\` |
      | Judge pass | false |
      | Judge score | 2 |
      | Judge intent | true |
      | Judge helpful | false |
      | Judge clear | true |
      | Judge professional | true |
      | Judge no passive aggression | true |
      | Judge failures | \`unhelpful\` |
      | Judge calls | 1 |
      | Judge repairs | 0 |
      | Judge input tokens | 12 |
      | Judge output tokens | 4 |
      | Judge provider total tokens | 16 |
      | Judge provider-reported USD | 0.0004 |
      | Judge provider cost complete | true |
      "
    `);
  });

  it('retains finite partial failed-judge usage without presenting it as complete', async () => {
    const repositoryRoot = await createRepositoryRoot();
    const report = failedJudgeReport();
    expect(await createReportWriter({ repositoryRoot })(report)).toMatchObject({ ok: true });

    const persisted = JSON.parse(
      await readFile(join(finalDirectory(repositoryRoot), 'report.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(persisted['judgeUsage']).toEqual(report.judgeUsage);
    expect(JSON.stringify(persisted)).not.toContain('rationale');
  });

  it.each([
    ['behavioral endpoint', behavioralReport()],
    ['partial infrastructure', preflightFailureReport()],
    ['Matrix smoke', matrixReport()],
  ])(
    'publishes the exact strict JSON and required Markdown sections for %s',
    async (_name, report) => {
      const repositoryRoot = await createRepositoryRoot();
      const result = await createReportWriter({ repositoryRoot })(report);
      expect(result.ok).toBe(true);

      const json = await readFile(join(finalDirectory(repositoryRoot), 'report.json'), 'utf8');
      const markdown = await readFile(join(finalDirectory(repositoryRoot), 'report.md'), 'utf8');
      expect(json).toBe(`${JSON.stringify(report, null, 2)}\n`);
      expect(markdown).toContain(`| Status | \`${report.status}\` |`);
      expect(markdown).toContain(`| Exit code | ${String(report.exitCode)} |`);
      if (report.matrixSmoke !== undefined) {
        expect(markdown).toContain('## Matrix smoke\n');
        expect(markdown).toContain('| Hidden tool audit | `not_available` |');
      } else {
        expect(markdown).not.toContain('## Matrix smoke\n');
      }
    }
  );

  it('creates exact private modes and a complete pair before the atomic rename', async () => {
    const repositoryRoot = await createRepositoryRoot();
    let pairWasCompleteBeforeRename = false;
    const fileSystem = createNodeFileSystem({
      async beforeRename(source, destination) {
        expect(destination).toBe(finalDirectory(repositoryRoot));
        expect(await readFile(join(source, 'report.json'), 'utf8')).toMatch(/\n$/u);
        expect(await readFile(join(source, 'report.md'), 'utf8')).toMatch(/\n$/u);
        await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        pairWasCompleteBeforeRename = true;
      },
    });

    expect(await createReportWriter({ repositoryRoot, fileSystem })(passReport())).toMatchObject({
      ok: true,
    });
    expect(pairWasCompleteBeforeRename).toBe(true);
    expect((await lstat(artifactRoot(repositoryRoot))).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
    expect((await lstat(finalDirectory(repositoryRoot))).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
    expect((await lstat(join(finalDirectory(repositoryRoot), 'report.json'))).mode & 0o777).toBe(
      PRIVATE_FILE_MODE
    );
    expect((await lstat(join(finalDirectory(repositoryRoot), 'report.md'))).mode & 0o777).toBe(
      PRIVATE_FILE_MODE
    );
  });

  it.each(['../escape', '/absolute', '', 'Uppercase', 'a'.repeat(97)])(
    'rejects unsafe run ID before filesystem work: %s',
    async (runId) => {
      const repositoryRoot = await createRepositoryRoot();
      const fileSystem = createNodeFileSystem();
      const mkdirSpy = vi.spyOn(fileSystem, 'mkdir');
      const result = await createReportWriter({ repositoryRoot, fileSystem })({
        ...passReport(),
        runId,
      });
      expect(result).toEqual({ ok: false, code: 'REPORTING_FAILED' });
      expect(mkdirSpy).not.toHaveBeenCalled();
    }
  );

  it('rejects a symlink, non-directory, or unsafe-mode artifact root', async () => {
    for (const kind of ['symlink', 'file', 'unsafe-mode'] as const) {
      const repositoryRoot = await createRepositoryRoot();
      await mkdir(join(repositoryRoot, '.artifacts'), { mode: PRIVATE_DIRECTORY_MODE });
      const root = artifactRoot(repositoryRoot);
      if (kind === 'symlink') {
        const target = await createRepositoryRoot();
        await symlink(target, root);
      } else if (kind === 'file') {
        await writeFile(root, 'unsafe root', { mode: PRIVATE_FILE_MODE });
      } else {
        await mkdir(root, { mode: 0o755 });
        await chmod(root, 0o755);
      }

      expect(await createReportWriter({ repositoryRoot })(passReport())).toEqual({
        ok: false,
        code: 'REPORTING_FAILED',
      });
      await expectPathUnavailable(finalDirectory(repositoryRoot));
    }
  });

  it('refuses and preserves an existing final target without overwrite or deletion', async () => {
    const repositoryRoot = await createRepositoryRoot();
    await mkdir(finalDirectory(repositoryRoot), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    await chmod(artifactRoot(repositoryRoot), PRIVATE_DIRECTORY_MODE);
    const sentinelPath = join(finalDirectory(repositoryRoot), 'keep.txt');
    await writeFile(sentinelPath, 'existing-final-sentinel', { mode: PRIVATE_FILE_MODE });

    expect(await createReportWriter({ repositoryRoot })(passReport())).toEqual({
      ok: false,
      code: 'REPORTING_FAILED',
    });
    expect(await readFile(sentinelPath, 'utf8')).toBe('existing-final-sentinel');
    await expect(lstat(join(finalDirectory(repositoryRoot), 'report.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('strict-parses before every filesystem operation and emits no raw validation cause', async () => {
    const repositoryRoot = await createRepositoryRoot();
    const invalid = cloneReport(passReport());
    invalid['prompt'] = 'private-prompt-sentinel';
    const fileSystem = createNodeFileSystem();
    const mkdirSpy = vi.spyOn(fileSystem, 'mkdir');

    expect(await createReportWriter({ repositoryRoot, fileSystem })(asReport(invalid))).toEqual({
      ok: false,
      code: 'REPORTING_FAILED',
    });
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it.each([
    'json_open',
    'markdown_open',
    'json_write',
    'markdown_write',
    'json_sync',
    'markdown_sync',
    'json_close',
    'markdown_close',
    'rename',
  ] as const)(
    'returns one safe failure, removes its temp directory, and leaves no final pair on %s failure',
    async (fault) => {
      const repositoryRoot = await createRepositoryRoot();
      const observations: FaultObservations = { closed: [], removed: [] };
      const fileSystem = createFaultFileSystem(fault, observations);

      expect(await createReportWriter({ repositoryRoot, fileSystem })(passReport())).toEqual({
        ok: false,
        code: 'REPORTING_FAILED',
      });
      await expect(lstat(finalDirectory(repositoryRoot))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(observations.removed).toHaveLength(1);
      const removedPath = first(observations.removed);
      expect(dirname(removedPath)).toBe(artifactRoot(repositoryRoot));
      expect(basename(removedPath)).toMatch(/^\.tmp-evaluation-run-20260716-230217-/u);
      expect(await readdir(artifactRoot(repositoryRoot))).toEqual([]);
      if (fault.endsWith('_write') || fault.endsWith('_sync')) {
        expect(observations.closed).toContain(
          fault.startsWith('json') ? 'report.json' : 'report.md'
        );
      }
    }
  );

  it('best-effort cleanup failure never removes or publishes the final directory', async () => {
    const repositoryRoot = await createRepositoryRoot();
    const observations: FaultObservations = { closed: [], removed: [] };
    const fileSystem = createFaultFileSystem('cleanup', observations, 'json_write');

    expect(await createReportWriter({ repositoryRoot, fileSystem })(passReport())).toEqual({
      ok: false,
      code: 'REPORTING_FAILED',
    });
    await expect(lstat(finalDirectory(repositoryRoot))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(observations.removed).toHaveLength(1);
    const removedPath = first(observations.removed);
    expect(removedPath).not.toBe(finalDirectory(repositoryRoot));
    expect(dirname(removedPath)).toBe(artifactRoot(repositoryRoot));
  });
});

interface NodeFileSystemHooks {
  beforeRename?(source: string, destination: string): Promise<void>;
}

function createNodeFileSystem(hooks: NodeFileSystemHooks = {}): ReportFileSystem {
  return {
    lstat,
    mkdir,
    mkdtemp,
    chmod,
    async open(path, flags, mode): Promise<ReportFileHandle> {
      return open(path, flags, mode);
    },
    async rename(source, destination): Promise<void> {
      await hooks.beforeRename?.(source, destination);
      await rename(source, destination);
    },
    rm,
  };
}

type FaultOperation =
  | 'json_open'
  | 'markdown_open'
  | 'json_write'
  | 'markdown_write'
  | 'json_sync'
  | 'markdown_sync'
  | 'json_close'
  | 'markdown_close'
  | 'rename'
  | 'cleanup';

interface FaultObservations {
  closed: string[];
  removed: string[];
}

function createFaultFileSystem(
  fault: FaultOperation,
  observations: FaultObservations,
  secondaryFault?: Exclude<FaultOperation, 'cleanup'>
): ReportFileSystem {
  const base = createNodeFileSystem();
  const hasFault = (candidate: FaultOperation): boolean =>
    fault === candidate || secondaryFault === candidate;

  return {
    ...base,
    async open(path, flags, mode): Promise<ReportFileHandle> {
      const fileName = basename(path);
      const prefix = fileName === 'report.json' ? 'json' : 'markdown';
      if (hasFault(`${prefix}_open`)) throw new Error('private-open-cause-sentinel');
      const handle = await base.open(path, flags, mode);
      return {
        async writeFile(contents): Promise<void> {
          if (hasFault(`${prefix}_write`)) throw new Error('private-write-cause-sentinel');
          await handle.writeFile(contents);
        },
        async sync(): Promise<void> {
          if (hasFault(`${prefix}_sync`)) throw new Error('private-sync-cause-sentinel');
          await handle.sync();
        },
        async close(): Promise<void> {
          observations.closed.push(fileName);
          await handle.close();
          if (hasFault(`${prefix}_close`)) throw new Error('private-close-cause-sentinel');
        },
      };
    },
    async rename(source, destination): Promise<void> {
      if (hasFault('rename')) throw new Error('private-rename-cause-sentinel');
      await base.rename(source, destination);
    },
    async rm(path, options): Promise<void> {
      observations.removed.push(path);
      if (hasFault('cleanup')) throw new Error('private-cleanup-cause-sentinel');
      await base.rm(path, options);
    },
  };
}
