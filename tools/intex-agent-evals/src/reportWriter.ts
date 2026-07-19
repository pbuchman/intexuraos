import {
  chmod as nodeChmod,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  open as nodeOpen,
  rename as nodeRename,
  rm as nodeRm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { EndpointFailureCode } from './endpointClient.js';
import { MATRIX_SMOKE_FAILURE_CODES } from './live/runMatrixSmoke.js';
import type { PreflightCheckId, PreflightFailureCode, SafeCheckResult } from './preflight.js';
import type {
  CleanupResult,
  JudgeFailure,
  JudgeInfrastructureCode,
} from './runEndpointScenario.js';
import type { DeterministicFailureCode } from './deterministicEvaluator.js';
import {
  IntexAgentToolNameSchema,
  ScenarioAssertionPathSchema,
  TimelinePayloadAssertionPathSchema,
  ToolArgumentAssertionPathSchema,
} from './types.js';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const REPORT_FILE_FLAGS = 'wx' as const;
const REPORTING_FAILURE = { ok: false, code: 'REPORTING_FAILED' } as const;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SCENARIO_ID_PATTERN = /^intex-eval-[0-9]{3}$/u;

function defineExhaustiveCodes<TExpected extends string>() {
  return <const TCodes extends readonly [TExpected, ...TExpected[]]>(
    codes: TCodes & ([TExpected] extends [TCodes[number]] ? unknown : never)
  ): TCodes => codes;
}

function excludeCodes<
  const TAll extends readonly [string, ...string[]],
  const TExcluded extends readonly string[],
>(
  allCodes: TAll,
  excludedCodes: TExcluded
): readonly [
  Exclude<TAll[number], TExcluded[number]>,
  ...Exclude<TAll[number], TExcluded[number]>[],
] {
  const excluded = new Set<string>(excludedCodes);
  const remaining = allCodes.filter(
    (code): code is Exclude<TAll[number], TExcluded[number]> => !excluded.has(code)
  );
  if (remaining.length === 0) throw new Error('Report failure code tuple cannot be empty');
  return remaining as unknown as readonly [
    Exclude<TAll[number], TExcluded[number]>,
    ...Exclude<TAll[number], TExcluded[number]>[],
  ];
}

const PREFLIGHT_CHECK_IDS = defineExhaustiveCodes<PreflightCheckId>()([
  'runtime',
  'environment',
  'config',
  'matrix_files',
  'intex_agent_health',
  'whatsapp_health',
  'matrix_health',
  'firebase_identity',
  'matrix_identity',
  'whatsapp_delivery',
  'scenario_catalog',
  'minimax_probe',
] as const satisfies readonly PreflightCheckId[]);

const PREFLIGHT_FAILURE_CODES = defineExhaustiveCodes<PreflightFailureCode>()([
  'HOME_DEV_REQUIRED',
  'REQUIRED_ENV_MISSING',
  'SETUP_TTY_REQUIRED',
  'CONFIG_NOT_FOUND',
  'CONFIG_INVALID',
  'CONFIG_PARENT_UNSAFE',
  'CONFIG_FILE_UNSAFE',
  'CONFIG_CONFLICT',
  'CONFIG_WRITE_FAILED',
  'MATRIX_TOKEN_FILE_UNSAFE',
  'MATRIX_TOKEN_INVALID',
  'MATRIX_TARGETS_FILE_UNSAFE',
  'MATRIX_TARGETS_INVALID',
  'INTEX_AGENT_HEALTH_FAILED',
  'WHATSAPP_HEALTH_FAILED',
  'MATRIX_HEALTH_FAILED',
  'FIREBASE_IDENTITY_MISSING',
  'FIREBASE_IDENTITY_DISABLED',
  'FIREBASE_CHECK_FAILED',
  'MATRIX_IDENTITY_MISMATCH',
  'MATRIX_WHOAMI_UNAUTHORIZED',
  'MATRIX_WHOAMI_FAILED',
  'WHATSAPP_DELIVERY_NOT_READY',
  'WHATSAPP_DELIVERY_FAILED',
  'SCENARIO_CATALOG_FAILED',
  'MINIMAX_KEY_MISSING',
  'MINIMAX_PROBE_TIMEOUT',
  'MINIMAX_PROBE_INVALID',
  'MINIMAX_PROBE_FAILED',
  'UNEXPECTED_FAILURE',
] as const satisfies readonly PreflightFailureCode[]);

type CleanupFailureCode = Extract<CleanupResult, { code: string }>['code'];
type EndpointReportFailureCode =
  | EndpointFailureCode
  | 'identity_generation_failed'
  | 'endpoint_failed';
type DeterministicReportFailureCode = DeterministicFailureCode | 'deterministic_evaluator_failed';
type JudgeReportFailureCode =
  | JudgeInfrastructureCode
  | JudgeFailure
  | 'judge_failed'
  | 'judge_protocol_failed';
type MatrixSmokeFailureCode = (typeof MATRIX_SMOKE_FAILURE_CODES)[number];
type MatrixSmokeReportFailureCode = Exclude<MatrixSmokeFailureCode, JudgeInfrastructureCode>;

const ENDPOINT_REPORT_FAILURE_CODES = defineExhaustiveCodes<EndpointReportFailureCode>()([
  'missing_internal_auth',
  'endpoint_timeout',
  'endpoint_transport_failed',
  'endpoint_http_failed',
  'malformed_endpoint_response',
  'endpoint_correlation_failed',
  'identity_generation_failed',
  'endpoint_failed',
] as const satisfies readonly EndpointReportFailureCode[]);

const DETERMINISTIC_FAILURE_CODES = defineExhaustiveCodes<DeterministicFailureCode>()([
  'required_tool_count_mismatch',
  'forbidden_tool_called',
  'tool_argument_assertion_failed',
  'transition_mismatch',
  'session_status_mismatch',
  'session_field_mismatch',
  'required_timeline_event_missing',
  'forbidden_timeline_event_present',
  'timeline_payload_assertion_failed',
  'assistant_reply_missing',
  'assistant_reply_unexpected',
  'confirmation_button_unavailable',
] as const satisfies readonly DeterministicFailureCode[]);

const DETERMINISTIC_REPORT_FAILURE_CODES = defineExhaustiveCodes<DeterministicReportFailureCode>()([
  ...DETERMINISTIC_FAILURE_CODES,
  'deterministic_evaluator_failed',
] as const satisfies readonly DeterministicReportFailureCode[]);

function validateDeterministicFailurePath(
  failure: { code: DeterministicReportFailureCode; path?: string | undefined },
  context: z.RefinementCtx
): void {
  if (failure.path === undefined) return;
  const expectedPathSchema =
    failure.code === 'tool_argument_assertion_failed'
      ? ToolArgumentAssertionPathSchema
      : failure.code === 'timeline_payload_assertion_failed'
        ? TimelinePayloadAssertionPathSchema
        : undefined;
  if (expectedPathSchema === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'Only deterministic assertion failures may contain a path',
    });
    return;
  }
  if (!expectedPathSchema.safeParse(failure.path).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'Deterministic assertion path does not match its failure code',
    });
  }
}

const JUDGE_INFRASTRUCTURE_CODES = defineExhaustiveCodes<JudgeInfrastructureCode>()([
  'MINIMAX_JUDGE_KEY_MISSING',
  'MINIMAX_JUDGE_TIMEOUT',
  'MINIMAX_JUDGE_PROVIDER_FAILED',
  'MINIMAX_JUDGE_INVALID_OUTPUT',
  'MINIMAX_JUDGE_USAGE_INVALID',
] as const satisfies readonly JudgeInfrastructureCode[]);

const MATRIX_SMOKE_REPORT_FAILURE_CODES = excludeCodes(
  MATRIX_SMOKE_FAILURE_CODES,
  JUDGE_INFRASTRUCTURE_CODES
);

const JUDGE_BEHAVIOR_FAILURE_CODES = defineExhaustiveCodes<JudgeFailure>()([
  'misunderstood_intent',
  'missing_information',
  'unhelpful',
  'unclear',
  'bad_tone',
  'unsupported_claim',
] as const satisfies readonly JudgeFailure[]);

const JUDGE_REPORT_FAILURE_CODES = defineExhaustiveCodes<JudgeReportFailureCode>()([
  ...JUDGE_INFRASTRUCTURE_CODES,
  ...JUDGE_BEHAVIOR_FAILURE_CODES,
  'judge_failed',
  'judge_protocol_failed',
] as const satisfies readonly JudgeReportFailureCode[]);

const CLEANUP_FAILURE_CODES = defineExhaustiveCodes<CleanupFailureCode>()([
  'identity_not_created',
  'cleanup_failed',
  'cleanup_count_mismatch',
] as const satisfies readonly CleanupFailureCode[]);

type ReportFailureCode =
  | PreflightFailureCode
  | EndpointReportFailureCode
  | DeterministicReportFailureCode
  | JudgeReportFailureCode
  | CleanupFailureCode
  | MatrixSmokeReportFailureCode;

const REPORT_FAILURE_CODES = defineExhaustiveCodes<ReportFailureCode>()([
  ...PREFLIGHT_FAILURE_CODES,
  ...ENDPOINT_REPORT_FAILURE_CODES,
  ...DETERMINISTIC_REPORT_FAILURE_CODES,
  ...JUDGE_REPORT_FAILURE_CODES,
  ...CLEANUP_FAILURE_CODES,
  ...MATRIX_SMOKE_REPORT_FAILURE_CODES,
] as const satisfies readonly ReportFailureCode[]);

const NonNegativeSafeIntegerSchema = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ProviderCostSchema = z.number().finite().min(0);
const OffsetTimestampSchema = z.string().datetime({ offset: true });
const RunIdSchema = z.string().min(1).max(96).regex(RUN_ID_PATTERN);
const ScenarioIdSchema = z.string().regex(SCENARIO_ID_PATTERN);
const AccountAliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u)
  .refine((value) => value === value.trim())
  .refine((value) => /[A-Za-z]/u.test(value));

const SafeCheckResultSchema: z.ZodType<SafeCheckResult> = z.discriminatedUnion('status', [
  z.object({ check: z.enum(PREFLIGHT_CHECK_IDS), status: z.literal('passed') }).strict(),
  z
    .object({
      check: z.enum(PREFLIGHT_CHECK_IDS),
      status: z.literal('failed'),
      code: z.enum(PREFLIGHT_FAILURE_CODES),
    })
    .strict(),
]);

const PreflightReportSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('passed'),
        host: z.literal('home-dev'),
        ports: z
          .object({
            intexAgent: z.literal(8134),
            whatsappService: z.literal(8113),
            matrixAdapter: z.literal(8099),
          })
          .strict(),
        judgeModel: z.literal('or:minimax/minimax-m3'),
        scenarioCount: NonNegativeSafeIntegerSchema,
        accountAlias: AccountAliasSchema,
        checks: z.array(SafeCheckResultSchema),
      })
      .strict(),
    z
      .object({
        status: z.literal('failed'),
        code: z.enum(PREFLIGHT_FAILURE_CODES),
        checks: z.array(SafeCheckResultSchema),
      })
      .strict(),
  ])
  .superRefine((preflight, context) => {
    const hasCanonicalPrefix = preflight.checks.every(
      (check, index) => check.check === PREFLIGHT_CHECK_IDS[index]
    );
    if (preflight.status === 'passed') {
      if (
        preflight.checks.length !== PREFLIGHT_CHECK_IDS.length ||
        !hasCanonicalPrefix ||
        preflight.checks.some((check) => check.status !== 'passed')
      ) {
        addCustomIssue(context, ['checks'], 'Passed preflight check evidence is incoherent');
      }
      return;
    }

    const isRedactedUnexpectedFailure =
      preflight.code === 'UNEXPECTED_FAILURE' && preflight.checks.length === 0;
    const finalCheck = preflight.checks[preflight.checks.length - 1];
    const isCanonicalFailure =
      preflight.checks.length > 0 &&
      preflight.checks.length <= PREFLIGHT_CHECK_IDS.length &&
      hasCanonicalPrefix &&
      preflight.checks.slice(0, -1).every((check) => check.status === 'passed') &&
      finalCheck?.status === 'failed' &&
      finalCheck.code === preflight.code;
    if (!isRedactedUnexpectedFailure && !isCanonicalFailure) {
      addCustomIssue(context, ['checks'], 'Failed preflight check evidence is incoherent');
    }
  });

const JudgeCriteriaSchema = z
  .object({
    understoodIntent: z.boolean(),
    helpful: z.boolean(),
    conciseAndClear: z.boolean(),
    professionalTone: z.boolean(),
    noPassiveAggression: z.boolean(),
  })
  .strict();

function validateJudgeDecision(
  decision: {
    pass: boolean;
    criteria: z.infer<typeof JudgeCriteriaSchema>;
    failures: readonly JudgeFailure[];
  },
  context: z.RefinementCtx
): void {
  const criteriaPass = Object.values(decision.criteria).every((value) => value);
  if (decision.pass !== (criteriaPass && decision.failures.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pass'],
      message: 'Judge pass is incoherent',
    });
  }
  if (new Set(decision.failures).size !== decision.failures.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failures'],
      message: 'Judge failures are not unique',
    });
  }
}

const JudgeDecisionShape = {
  pass: z.boolean(),
  score: z.number().finite().int().min(1).max(5),
  criteria: JudgeCriteriaSchema,
  failures: z.array(z.enum(JUDGE_BEHAVIOR_FAILURE_CODES)),
} as const;

const JudgeVerdictReportV1Schema = z
  .object({
    scenarioId: ScenarioIdSchema,
    turnIndex: NonNegativeSafeIntegerSchema,
    replyIndex: NonNegativeSafeIntegerSchema,
    ...JudgeDecisionShape,
  })
  .strict()
  .superRefine(validateJudgeDecision);

const MatrixJudgeReportV1Schema = z
  .object(JudgeDecisionShape)
  .strict()
  .superRefine(validateJudgeDecision);

export const ReportJudgeUsageV1Schema = z
  .object({
    callCount: NonNegativeSafeIntegerSchema,
    repairCount: NonNegativeSafeIntegerSchema,
    inputTokens: NonNegativeSafeIntegerSchema,
    outputTokens: NonNegativeSafeIntegerSchema,
    totalTokens: NonNegativeSafeIntegerSchema,
    providerReportedUsd: ProviderCostSchema,
    providerReportedUsdComplete: z.boolean(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.repairCount > Math.floor(usage.callCount / 2)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repairCount'],
        message: 'Repair count is incoherent with logical call count',
      });
    }
    if (
      usage.callCount === 0 &&
      (usage.repairCount !== 0 ||
        usage.inputTokens !== 0 ||
        usage.outputTokens !== 0 ||
        usage.totalTokens !== 0 ||
        usage.providerReportedUsd !== 0 ||
        !usage.providerReportedUsdComplete)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['callCount'],
        message: 'Zero-call usage is incoherent',
      });
    }
  });

export type ReportJudgeUsageV1 = z.infer<typeof ReportJudgeUsageV1Schema>;

const ToolSummaryReportV1Schema = z
  .object({
    toolName: IntexAgentToolNameSchema,
    completedCount: NonNegativeSafeIntegerSchema,
    failedCount: NonNegativeSafeIntegerSchema,
  })
  .strict();

const DeterministicFailureReportV1Schema = z
  .object({
    code: z.enum(DETERMINISTIC_FAILURE_CODES),
    turnIndex: NonNegativeSafeIntegerSchema.optional(),
    replyIndex: NonNegativeSafeIntegerSchema.optional(),
    path: ScenarioAssertionPathSchema.optional(),
  })
  .strict()
  .superRefine(validateDeterministicFailurePath);

const CleanupReportV1Schema = z.union([
  z.object({ status: z.literal('not_required'), code: z.literal('identity_not_created') }).strict(),
  z
    .object({
      status: z.literal('passed'),
      deleted: NonNegativeSafeIntegerSchema,
      total: NonNegativeSafeIntegerSchema,
    })
    .strict()
    .refine((value) => value.deleted === value.total, { path: ['deleted'] }),
  z
    .object({
      status: z.literal('infrastructure_failure'),
      code: z.literal('cleanup_failed'),
      deleted: NonNegativeSafeIntegerSchema.optional(),
      total: NonNegativeSafeIntegerSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('infrastructure_failure'),
      code: z.literal('cleanup_count_mismatch'),
      deleted: NonNegativeSafeIntegerSchema,
      total: NonNegativeSafeIntegerSchema,
    })
    .strict()
    .refine((value) => value.deleted !== value.total, { path: ['deleted'] }),
]);

export const ScenarioReportV1Schema = z
  .object({
    scenarioId: ScenarioIdSchema,
    status: z.enum(['passed', 'behavioral_failure', 'infrastructure_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    durationMs: NonNegativeSafeIntegerSchema,
    turnCount: NonNegativeSafeIntegerSchema,
    replyCount: NonNegativeSafeIntegerSchema,
    toolCallCount: NonNegativeSafeIntegerSchema,
    toolSummaries: z.array(ToolSummaryReportV1Schema),
    deterministicFailures: z.array(DeterministicFailureReportV1Schema),
    judgeVerdicts: z.array(JudgeVerdictReportV1Schema),
    cleanup: CleanupReportV1Schema,
  })
  .strict()
  .superRefine((scenario, context) => {
    addStatusExitIssue(scenario, context);
    const summarizedToolCalls = scenario.toolSummaries.reduce(
      (total, summary) => total + summary.completedCount + summary.failedCount,
      0
    );
    if (summarizedToolCalls !== scenario.toolCallCount) {
      addCustomIssue(context, ['toolCallCount'], 'Tool total is incoherent');
    }
    if (
      new Set(scenario.toolSummaries.map((summary) => summary.toolName)).size !==
      scenario.toolSummaries.length
    ) {
      addCustomIssue(context, ['toolSummaries'], 'Tool summaries are not unique');
    }
    if (scenario.judgeVerdicts.length > scenario.replyCount) {
      addCustomIssue(context, ['judgeVerdicts'], 'Judge verdict count exceeds reply count');
    }
    const verdictReferences = new Set<string>();
    for (const [index, verdict] of scenario.judgeVerdicts.entries()) {
      if (verdict.scenarioId !== scenario.scenarioId) {
        addCustomIssue(
          context,
          ['judgeVerdicts', index, 'scenarioId'],
          'Scenario reference mismatch'
        );
      }
      if (verdict.turnIndex >= scenario.turnCount) {
        addCustomIssue(
          context,
          ['judgeVerdicts', index, 'turnIndex'],
          'Turn reference is out of range'
        );
      }
      if (verdict.replyIndex >= scenario.replyCount) {
        addCustomIssue(
          context,
          ['judgeVerdicts', index, 'replyIndex'],
          'Reply reference is out of range'
        );
      }
      const reference = `${verdict.scenarioId}:${String(verdict.turnIndex)}:${String(verdict.replyIndex)}`;
      if (verdictReferences.has(reference)) {
        addCustomIssue(context, ['judgeVerdicts', index], 'Judge verdict reference is not unique');
      }
      verdictReferences.add(reference);
    }
    for (const [index, failure] of scenario.deterministicFailures.entries()) {
      if (failure.code === 'confirmation_button_unavailable') {
        if (
          scenario.turnCount === 0 ||
          failure.turnIndex !== scenario.turnCount ||
          failure.replyIndex !== undefined
        ) {
          addCustomIssue(
            context,
            ['deterministicFailures', index],
            'Stopped confirmation reference is incoherent'
          );
        }
      } else if (failure.turnIndex !== undefined && failure.turnIndex >= scenario.turnCount) {
        addCustomIssue(
          context,
          ['deterministicFailures', index, 'turnIndex'],
          'Turn reference is out of range'
        );
      }
      if (failure.replyIndex !== undefined && failure.replyIndex >= scenario.replyCount) {
        addCustomIssue(
          context,
          ['deterministicFailures', index, 'replyIndex'],
          'Reply reference is out of range'
        );
      }
    }
    if (scenario.status !== 'infrastructure_failure' && scenario.cleanup.status !== 'passed') {
      addCustomIssue(context, ['cleanup'], 'Non-passed cleanup requires infrastructure status');
    }
    if (
      scenario.status === 'passed' &&
      (scenario.deterministicFailures.length !== 0 ||
        scenario.judgeVerdicts.some((verdict) => !verdict.pass) ||
        scenario.judgeVerdicts.length !== scenario.replyCount ||
        scenario.cleanup.status !== 'passed')
    ) {
      addCustomIssue(context, ['status'], 'Passed scenario is incoherent');
    }
    if (
      scenario.status === 'behavioral_failure' &&
      scenario.deterministicFailures.length === 0 &&
      scenario.judgeVerdicts.every((verdict) => verdict.pass)
    ) {
      addCustomIssue(context, ['status'], 'Behavioral scenario has no behavioral evidence');
    }
  });

export type ScenarioReportV1 = z.infer<typeof ScenarioReportV1Schema>;

export const MatrixSmokeReportV1Schema = z
  .object({
    status: z.enum(['passed', 'behavioral_failure', 'infrastructure_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    failureCodes: z.array(z.enum(MATRIX_SMOKE_FAILURE_CODES)),
    durationMs: NonNegativeSafeIntegerSchema,
    transportFacts: z
      .object({
        cursorCaptured: z.boolean(),
        outboundSent: z.boolean(),
        eligiblePuppetTextObserved: z.boolean(),
        hiddenToolAudit: z.literal('not_available'),
      })
      .strict(),
    judge: MatrixJudgeReportV1Schema.optional(),
    judgeUsage: ReportJudgeUsageV1Schema,
  })
  .strict()
  .superRefine((matrix, context) => {
    addStatusExitIssue(matrix, context);
    if (new Set(matrix.failureCodes).size !== matrix.failureCodes.length) {
      addCustomIssue(context, ['failureCodes'], 'Matrix failure codes are not unique');
    }
    if (
      matrix.status === 'passed' &&
      (matrix.judge?.pass !== true ||
        matrix.failureCodes.length !== 0 ||
        !matrix.transportFacts.cursorCaptured ||
        !matrix.transportFacts.outboundSent ||
        !matrix.transportFacts.eligiblePuppetTextObserved ||
        matrix.judgeUsage.callCount === 0 ||
        !matrix.judgeUsage.providerReportedUsdComplete)
    ) {
      addCustomIssue(context, ['status'], 'Passed Matrix smoke is incoherent');
    }
    if (
      matrix.status === 'behavioral_failure' &&
      (matrix.judge?.pass !== false || matrix.failureCodes.length !== 0)
    ) {
      addCustomIssue(context, ['status'], 'Behavioral Matrix smoke is incoherent');
    }
    if (matrix.status === 'infrastructure_failure' && matrix.judge !== undefined) {
      addCustomIssue(context, ['judge'], 'Infrastructure Matrix smoke cannot contain a verdict');
    }
  });

export type MatrixSmokeReportV1 = z.infer<typeof MatrixSmokeReportV1Schema>;

const FailureReferenceShape = {
  scenarioId: ScenarioIdSchema.optional(),
  turnIndex: NonNegativeSafeIntegerSchema.optional(),
  replyIndex: NonNegativeSafeIntegerSchema.optional(),
} as const;

export const SafeReportFailureCodeSchema = z.enum(REPORT_FAILURE_CODES);

const SafeReportFailureV1BaseSchema = z.discriminatedUnion('stage', [
  z
    .object({
      stage: z.literal('preflight'),
      code: z.enum(PREFLIGHT_FAILURE_CODES),
      ...FailureReferenceShape,
    })
    .strict(),
  z
    .object({
      stage: z.literal('endpoint'),
      code: z.enum(ENDPOINT_REPORT_FAILURE_CODES),
      ...FailureReferenceShape,
    })
    .strict(),
  z
    .object({
      stage: z.literal('deterministic'),
      code: z.enum(DETERMINISTIC_REPORT_FAILURE_CODES),
      ...FailureReferenceShape,
      path: ScenarioAssertionPathSchema.optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal('judge'),
      code: z.enum(JUDGE_REPORT_FAILURE_CODES),
      ...FailureReferenceShape,
    })
    .strict(),
  z
    .object({
      stage: z.literal('cleanup'),
      code: z.enum(CLEANUP_FAILURE_CODES),
      ...FailureReferenceShape,
    })
    .strict(),
  z
    .object({
      stage: z.literal('matrix_smoke'),
      code: z.enum(MATRIX_SMOKE_REPORT_FAILURE_CODES),
      ...FailureReferenceShape,
    })
    .strict(),
]);

export const SafeReportFailureV1Schema = SafeReportFailureV1BaseSchema.superRefine(
  (failure, context) => {
    if (failure.stage === 'deterministic') validateDeterministicFailurePath(failure, context);
  }
);

export type SafeReportFailureV1 = z.infer<typeof SafeReportFailureV1Schema>;

const TotalsReportV1Schema = z
  .object({
    scenarioCount: NonNegativeSafeIntegerSchema,
    scenarioPassed: NonNegativeSafeIntegerSchema,
    scenarioBehavioralFailed: NonNegativeSafeIntegerSchema,
    scenarioInfrastructureFailed: NonNegativeSafeIntegerSchema,
    turnCount: NonNegativeSafeIntegerSchema,
    replyCount: NonNegativeSafeIntegerSchema,
    toolCallCount: NonNegativeSafeIntegerSchema,
    judgeVerdictCount: NonNegativeSafeIntegerSchema,
  })
  .strict();

export const EvaluationReportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    command: z.enum(['endpoint', 'full', 'scenario', 'matrix-smoke']),
    startedAt: OffsetTimestampSchema,
    finishedAt: OffsetTimestampSchema,
    durationMs: NonNegativeSafeIntegerSchema,
    status: z.enum(['passed', 'behavioral_failure', 'infrastructure_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    preflight: PreflightReportSchema,
    totals: TotalsReportV1Schema,
    judgeUsage: ReportJudgeUsageV1Schema,
    scenarios: z.array(ScenarioReportV1Schema),
    matrixSmoke: MatrixSmokeReportV1Schema.optional(),
    failures: z.array(SafeReportFailureV1Schema),
  })
  .strict()
  .superRefine((report, context) => {
    addStatusExitIssue(report, context);
    const startedAtMs = Date.parse(report.startedAt);
    const finishedAtMs = Date.parse(report.finishedAt);
    if (finishedAtMs - startedAtMs !== report.durationMs) {
      addCustomIssue(context, ['durationMs'], 'Run duration is incoherent');
    }

    const scenarioIds = report.scenarios.map((scenario) => scenario.scenarioId);
    if (new Set(scenarioIds).size !== scenarioIds.length) {
      addCustomIssue(context, ['scenarios'], 'Scenario references are not unique');
    }

    const expectedTotals = {
      scenarioCount: report.scenarios.length,
      scenarioPassed: report.scenarios.filter((scenario) => scenario.status === 'passed').length,
      scenarioBehavioralFailed: report.scenarios.filter(
        (scenario) => scenario.status === 'behavioral_failure'
      ).length,
      scenarioInfrastructureFailed: report.scenarios.filter(
        (scenario) => scenario.status === 'infrastructure_failure'
      ).length,
      turnCount: sumScenarioField(report.scenarios, 'turnCount'),
      replyCount: sumScenarioField(report.scenarios, 'replyCount'),
      toolCallCount: sumScenarioField(report.scenarios, 'toolCallCount'),
      judgeVerdictCount: report.scenarios.reduce(
        (total, scenario) => total + scenario.judgeVerdicts.length,
        0
      ),
    };
    for (const [field, value] of Object.entries(expectedTotals)) {
      if (report.totals[field as keyof typeof expectedTotals] !== value) {
        addCustomIssue(context, ['totals', field], 'Report total is incoherent');
      }
    }

    const scenarioById = new Map(
      report.scenarios.map((scenario) => [scenario.scenarioId, scenario] as const)
    );
    validateFailureEvidence(report, scenarioById, context);
    validateScenarioEvidence(report, context);
    validateMatrixEvidence(report, context);

    const hasGlobalEndpointInterruption = report.failures.some(
      (failure) =>
        failure.stage === 'endpoint' &&
        failure.code === 'endpoint_failed' &&
        failure.scenarioId === undefined
    );
    const hasEndpointInterruption =
      hasGlobalEndpointInterruption ||
      report.scenarios.some((scenario) => scenario.status === 'infrastructure_failure');
    const hasEndpointBehavioralFailure = report.scenarios.some(
      (scenario) => scenario.status === 'behavioral_failure'
    );

    if (report.preflight.status === 'failed') {
      if (report.scenarios.length !== 0 || report.matrixSmoke !== undefined) {
        addCustomIssue(context, ['preflight'], 'Failed preflight projection is incoherent');
      }
    } else {
      if (report.scenarios.length > report.preflight.scenarioCount) {
        addCustomIssue(context, ['scenarios'], 'Scenario count exceeds the preflight catalog');
      }
      if (
        report.command === 'scenario' &&
        ((hasGlobalEndpointInterruption && report.scenarios.length !== 0) ||
          (!hasGlobalEndpointInterruption && report.scenarios.length !== 1))
      ) {
        addCustomIssue(context, ['scenarios'], 'Single-scenario result is incomplete');
      }
      if (
        (report.command === 'endpoint' || report.command === 'full') &&
        report.scenarios.length !== report.preflight.scenarioCount &&
        !hasEndpointInterruption
      ) {
        addCustomIssue(context, ['scenarios'], 'Endpoint corpus result is incomplete');
      }
    }

    if (
      (report.command === 'endpoint' || report.command === 'scenario') &&
      report.matrixSmoke !== undefined
    ) {
      addCustomIssue(context, ['matrixSmoke'], 'Command cannot contain Matrix smoke');
    }
    if (report.command === 'matrix-smoke' && report.scenarios.length !== 0) {
      addCustomIssue(context, ['scenarios'], 'Matrix-only command cannot contain scenarios');
    }
    if (
      report.preflight.status === 'passed' &&
      report.command === 'matrix-smoke' &&
      report.matrixSmoke === undefined
    ) {
      addCustomIssue(context, ['matrixSmoke'], 'Matrix-only command is missing its Matrix result');
    }
    if (
      report.preflight.status === 'passed' &&
      report.command === 'full' &&
      report.matrixSmoke === undefined &&
      !hasEndpointInterruption &&
      !hasEndpointBehavioralFailure
    ) {
      addCustomIssue(
        context,
        ['matrixSmoke'],
        'Full command is missing its authorized Matrix result'
      );
    }
    if (
      report.command === 'full' &&
      (hasEndpointInterruption || hasEndpointBehavioralFailure) &&
      report.matrixSmoke !== undefined
    ) {
      addCustomIssue(context, ['matrixSmoke'], 'Endpoint failure must stop before Matrix');
    }
    if (
      report.command === 'matrix-smoke' &&
      report.matrixSmoke !== undefined &&
      !sameJudgeUsage(report.judgeUsage, report.matrixSmoke.judgeUsage)
    ) {
      addCustomIssue(context, ['judgeUsage'], 'Matrix-only judge usage is not exact');
    }

    const requiredJudgeCalls =
      expectedTotals.judgeVerdictCount + (report.matrixSmoke?.judge === undefined ? 0 : 1);
    if (report.judgeUsage.callCount < requiredJudgeCalls) {
      addCustomIssue(context, ['judgeUsage', 'callCount'], 'Judge call evidence is incomplete');
    }

    const hasInfrastructureEvidence =
      report.preflight.status === 'failed' ||
      report.failures.some(isInfrastructureReportFailure) ||
      report.scenarios.some((scenario) => scenario.cleanup.status !== 'passed') ||
      (report.matrixSmoke?.failureCodes.length ?? 0) > 0;
    const hasBehavioralEvidence =
      report.failures.some((failure) => !isInfrastructureReportFailure(failure)) ||
      report.scenarios.some(
        (scenario) =>
          scenario.deterministicFailures.length > 0 ||
          scenario.judgeVerdicts.some((verdict) => !verdict.pass)
      ) ||
      report.matrixSmoke?.judge?.pass === false;
    const expectedStatus = hasInfrastructureEvidence
      ? 'infrastructure_failure'
      : hasBehavioralEvidence
        ? 'behavioral_failure'
        : 'passed';
    if (report.status !== expectedStatus) {
      addCustomIssue(context, ['status'], 'Report status does not match its evidence');
    }
    if (report.status === 'passed' && !report.judgeUsage.providerReportedUsdComplete) {
      addCustomIssue(context, ['judgeUsage'], 'Passed report has incomplete provider cost');
    }
  });

export type EvaluationReportV1 = z.infer<typeof EvaluationReportV1Schema>;

interface ReportEvidenceProjection {
  command: 'endpoint' | 'full' | 'scenario' | 'matrix-smoke';
  preflight: z.infer<typeof PreflightReportSchema>;
  scenarios: readonly ScenarioReportV1[];
  matrixSmoke?: MatrixSmokeReportV1 | undefined;
  failures: readonly SafeReportFailureV1[];
}

function validateFailureEvidence(
  report: ReportEvidenceProjection,
  scenarioById: ReadonlyMap<string, ScenarioReportV1>,
  context: z.RefinementCtx
): void {
  for (const [index, failure] of report.failures.entries()) {
    if (
      failure.scenarioId === undefined &&
      (failure.turnIndex !== undefined || failure.replyIndex !== undefined)
    ) {
      addCustomIssue(
        context,
        ['failures', index],
        'Turn and reply references require a scenario reference'
      );
    }

    const scenario =
      failure.scenarioId === undefined ? undefined : scenarioById.get(failure.scenarioId);
    if (failure.scenarioId !== undefined && scenario === undefined) {
      addCustomIssue(context, ['failures', index, 'scenarioId'], 'Scenario reference is missing');
    }
    if (scenario !== undefined) {
      if (failure.code === 'confirmation_button_unavailable') {
        if (
          scenario.turnCount === 0 ||
          failure.turnIndex !== scenario.turnCount ||
          failure.replyIndex !== undefined
        ) {
          addCustomIssue(
            context,
            ['failures', index],
            'Stopped confirmation reference is incoherent'
          );
        }
      } else if (failure.turnIndex !== undefined && failure.turnIndex >= scenario.turnCount) {
        addCustomIssue(context, ['failures', index, 'turnIndex'], 'Turn reference is out of range');
      }
      if (failure.replyIndex !== undefined && failure.replyIndex >= scenario.replyCount) {
        addCustomIssue(
          context,
          ['failures', index, 'replyIndex'],
          'Reply reference is out of range'
        );
      }
      if (isInfrastructureReportFailure(failure) && scenario.status !== 'infrastructure_failure') {
        addCustomIssue(
          context,
          ['failures', index],
          'Infrastructure failure does not match scenario status'
        );
      }
      if (!isInfrastructureReportFailure(failure) && scenario.status === 'passed') {
        addCustomIssue(
          context,
          ['failures', index],
          'Behavioral failure does not match scenario status'
        );
      }
    }

    validateFailureStageTuple(report, failure, scenario, index, context);
  }

  if (report.preflight.status === 'failed') {
    const preflightCode = report.preflight.code;
    if (
      !report.failures.some(
        (failure) =>
          failure.stage === 'preflight' &&
          failure.code === preflightCode &&
          failure.scenarioId === undefined
      )
    ) {
      addCustomIssue(context, ['failures'], 'Preflight failure projection is missing');
    }
  }
}

function validateFailureStageTuple(
  report: ReportEvidenceProjection,
  failure: SafeReportFailureV1,
  scenario: ScenarioReportV1 | undefined,
  index: number,
  context: z.RefinementCtx
): void {
  const path = ['failures', index] as const;
  switch (failure.stage) {
    case 'preflight':
      if (
        failure.scenarioId !== undefined ||
        failure.turnIndex !== undefined ||
        failure.replyIndex !== undefined ||
        report.preflight.status !== 'failed' ||
        report.preflight.code !== failure.code
      ) {
        addCustomIssue(context, [...path], 'Preflight failure tuple is incoherent');
      }
      return;
    case 'endpoint':
      if (failure.turnIndex !== undefined || failure.replyIndex !== undefined) {
        addCustomIssue(context, [...path], 'Endpoint failure cannot contain turn references');
      }
      if (report.preflight.status !== 'passed' || report.command === 'matrix-smoke') {
        addCustomIssue(context, [...path], 'Endpoint failure requires an endpoint command');
      }
      if (failure.scenarioId === undefined && failure.code !== 'endpoint_failed') {
        addCustomIssue(context, [...path], 'Only corpus endpoint failure may be global');
      }
      return;
    case 'deterministic':
      if (failure.scenarioId === undefined) {
        addCustomIssue(context, [...path], 'Deterministic failure requires a scenario');
        return;
      }
      if (failure.code === 'deterministic_evaluator_failed') {
        if (failure.turnIndex !== undefined || failure.replyIndex !== undefined) {
          addCustomIssue(context, [...path], 'Evaluator failure cannot contain reply references');
        }
        return;
      }
      if (
        scenario !== undefined &&
        !scenario.deterministicFailures.some(
          (candidate) =>
            candidate.code === failure.code &&
            candidate.turnIndex === failure.turnIndex &&
            candidate.replyIndex === failure.replyIndex &&
            candidate.path === failure.path
        )
      ) {
        addCustomIssue(context, [...path], 'Deterministic failure projection is missing');
      }
      return;
    case 'judge':
      validateJudgeFailureTuple(report, failure, scenario, index, context);
      return;
    case 'cleanup':
      if (
        failure.scenarioId === undefined ||
        failure.turnIndex !== undefined ||
        failure.replyIndex !== undefined ||
        scenario === undefined ||
        scenario.cleanup.status === 'passed' ||
        scenario.cleanup.code !== failure.code
      ) {
        addCustomIssue(context, [...path], 'Cleanup failure tuple is incoherent');
      }
      return;
    case 'matrix_smoke': {
      const hasMatchingMatrixFailure =
        report.matrixSmoke?.status === 'infrastructure_failure' &&
        report.matrixSmoke.failureCodes.includes(failure.code);
      if (
        failure.scenarioId !== undefined ||
        failure.turnIndex !== undefined ||
        failure.replyIndex !== undefined ||
        !hasMatchingMatrixFailure
      ) {
        addCustomIssue(context, [...path], 'Matrix failure tuple is incoherent');
      }
      return;
    }
    default:
      assertUnreachable(failure);
  }
}

function validateJudgeFailureTuple(
  report: ReportEvidenceProjection,
  failure: Extract<SafeReportFailureV1, { stage: 'judge' }>,
  scenario: ScenarioReportV1 | undefined,
  index: number,
  context: z.RefinementCtx
): void {
  const path = ['failures', index] as const;
  if (failure.scenarioId === undefined) {
    if (failure.turnIndex !== undefined || failure.replyIndex !== undefined) {
      addCustomIssue(context, [...path], 'Global judge failure cannot contain reply references');
    }
    if (report.matrixSmoke === undefined) {
      addCustomIssue(context, [...path], 'Global judge failure requires Matrix evidence');
      return;
    }
    if (isJudgeBehaviorFailureCode(failure.code)) {
      if (
        report.matrixSmoke.status !== 'behavioral_failure' ||
        report.matrixSmoke.judge?.failures.includes(failure.code) !== true
      ) {
        addCustomIssue(context, [...path], 'Matrix judge behavior projection is missing');
      }
      return;
    }
    if (
      !isJudgeProviderInfrastructureCode(failure.code) ||
      report.matrixSmoke.status !== 'infrastructure_failure'
    ) {
      addCustomIssue(context, [...path], 'Matrix judge infrastructure tuple is incoherent');
    }
    return;
  }

  if (scenario === undefined) return;
  if (isJudgeBehaviorFailureCode(failure.code)) {
    const behaviorCode = failure.code;
    if (
      failure.turnIndex === undefined ||
      failure.replyIndex === undefined ||
      !scenario.judgeVerdicts.some(
        (verdict) =>
          verdict.turnIndex === failure.turnIndex &&
          verdict.replyIndex === failure.replyIndex &&
          verdict.failures.includes(behaviorCode)
      )
    ) {
      addCustomIssue(context, [...path], 'Scenario judge behavior projection is missing');
    }
    return;
  }
  if (failure.code === 'judge_failed' || failure.code === 'judge_protocol_failed') {
    if (failure.turnIndex !== undefined || failure.replyIndex !== undefined) {
      addCustomIssue(context, [...path], 'Judge stage failure cannot contain reply references');
    }
    return;
  }
  if (failure.turnIndex === undefined || failure.replyIndex === undefined) {
    addCustomIssue(context, [...path], 'Judge infrastructure failure requires a reply reference');
  }
}

function validateScenarioEvidence(
  report: ReportEvidenceProjection,
  context: z.RefinementCtx
): void {
  for (const [scenarioIndex, scenario] of report.scenarios.entries()) {
    const scenarioFailures = report.failures.filter(
      (failure) => failure.scenarioId === scenario.scenarioId
    );
    const hasInfrastructureEvidence =
      scenario.cleanup.status !== 'passed' || scenarioFailures.some(isInfrastructureReportFailure);
    const hasBehavioralEvidence =
      scenario.deterministicFailures.length > 0 ||
      scenario.judgeVerdicts.some((verdict) => !verdict.pass);
    const expectedStatus = hasInfrastructureEvidence
      ? 'infrastructure_failure'
      : hasBehavioralEvidence
        ? 'behavioral_failure'
        : 'passed';
    if (scenario.status !== expectedStatus) {
      addCustomIssue(
        context,
        ['scenarios', scenarioIndex, 'status'],
        'Scenario status does not match its evidence'
      );
    }

    for (const [failureIndex, failure] of scenario.deterministicFailures.entries()) {
      if (
        !report.failures.some(
          (candidate) =>
            candidate.stage === 'deterministic' &&
            candidate.code === failure.code &&
            candidate.scenarioId === scenario.scenarioId &&
            candidate.turnIndex === failure.turnIndex &&
            candidate.replyIndex === failure.replyIndex &&
            candidate.path === failure.path
        )
      ) {
        addCustomIssue(
          context,
          ['scenarios', scenarioIndex, 'deterministicFailures', failureIndex],
          'Global deterministic projection is missing'
        );
      }
    }

    for (const [verdictIndex, verdict] of scenario.judgeVerdicts.entries()) {
      for (const code of verdict.failures) {
        if (
          !report.failures.some(
            (failure) =>
              failure.stage === 'judge' &&
              failure.code === code &&
              failure.scenarioId === scenario.scenarioId &&
              failure.turnIndex === verdict.turnIndex &&
              failure.replyIndex === verdict.replyIndex
          )
        ) {
          addCustomIssue(
            context,
            ['scenarios', scenarioIndex, 'judgeVerdicts', verdictIndex],
            'Global judge projection is missing'
          );
        }
      }
    }

    if (scenario.cleanup.status !== 'passed') {
      const cleanupCode = scenario.cleanup.code;
      if (
        !report.failures.some(
          (failure) =>
            failure.stage === 'cleanup' &&
            failure.code === cleanupCode &&
            failure.scenarioId === scenario.scenarioId
        )
      ) {
        addCustomIssue(
          context,
          ['scenarios', scenarioIndex, 'cleanup'],
          'Global cleanup projection is missing'
        );
      }
    }
  }
}

function validateMatrixEvidence(report: ReportEvidenceProjection, context: z.RefinementCtx): void {
  const matrix = report.matrixSmoke;
  if (matrix === undefined) return;

  const hasJudgeInfrastructureEvidence = report.failures.some(
    (failure) =>
      failure.stage === 'judge' &&
      failure.scenarioId === undefined &&
      isJudgeProviderInfrastructureCode(failure.code)
  );
  if (
    matrix.status === 'infrastructure_failure' &&
    matrix.failureCodes.length === 0 &&
    !hasJudgeInfrastructureEvidence
  ) {
    addCustomIssue(context, ['matrixSmoke', 'status'], 'Matrix infrastructure evidence is missing');
  }

  for (const [index, code] of matrix.failureCodes.entries()) {
    const hasGlobalProjection = isJudgeProviderInfrastructureCode(code)
      ? report.failures.some(
          (failure) =>
            failure.stage === 'judge' && failure.code === code && failure.scenarioId === undefined
        )
      : report.failures.some(
          (failure) =>
            failure.stage === 'matrix_smoke' &&
            failure.code === code &&
            failure.scenarioId === undefined
        );
    if (!hasGlobalProjection) {
      addCustomIssue(
        context,
        ['matrixSmoke', 'failureCodes', index],
        'Global Matrix failure projection is missing'
      );
    }
  }

  if (matrix.judge !== undefined) {
    for (const code of matrix.judge.failures) {
      if (
        !report.failures.some(
          (failure) =>
            failure.stage === 'judge' && failure.code === code && failure.scenarioId === undefined
        )
      ) {
        addCustomIssue(
          context,
          ['matrixSmoke', 'judge'],
          'Global Matrix judge projection is missing'
        );
      }
    }
  }
}

function isInfrastructureReportFailure(failure: SafeReportFailureV1): boolean {
  switch (failure.stage) {
    case 'preflight':
    case 'endpoint':
    case 'cleanup':
    case 'matrix_smoke':
      return true;
    case 'deterministic':
      return failure.code === 'deterministic_evaluator_failed';
    case 'judge':
      return !isJudgeBehaviorFailureCode(failure.code);
    default:
      return assertUnreachable(failure);
  }
}

function isJudgeBehaviorFailureCode(code: JudgeReportFailureCode): code is JudgeFailure {
  return (JUDGE_BEHAVIOR_FAILURE_CODES as readonly string[]).includes(code);
}

function isJudgeProviderInfrastructureCode(
  code: JudgeReportFailureCode | MatrixSmokeFailureCode
): code is JudgeInfrastructureCode {
  return (JUDGE_INFRASTRUCTURE_CODES as readonly string[]).includes(code);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unreachable report value: ${String(value)}`);
}

interface StatusExitProjection {
  status: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  exitCode: 0 | 1 | 2;
}

function addStatusExitIssue(projection: StatusExitProjection, context: z.RefinementCtx): void {
  const expectedExitCode =
    projection.status === 'passed' ? 0 : projection.status === 'behavioral_failure' ? 1 : 2;
  if (projection.exitCode !== expectedExitCode) {
    addCustomIssue(context, ['exitCode'], 'Status and exit code are incoherent');
  }
}

function addCustomIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function sumScenarioField(
  scenarios: readonly ScenarioReportV1[],
  field: 'turnCount' | 'replyCount' | 'toolCallCount'
): number {
  return scenarios.reduce((total, scenario) => total + scenario[field], 0);
}

function sameJudgeUsage(left: ReportJudgeUsageV1, right: ReportJudgeUsageV1): boolean {
  return (
    left.callCount === right.callCount &&
    left.repairCount === right.repairCount &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens &&
    left.providerReportedUsd === right.providerReportedUsd &&
    left.providerReportedUsdComplete === right.providerReportedUsdComplete
  );
}

export type ReportWriteResult =
  | { ok: true; relativeDirectory: string }
  | { ok: false; code: 'REPORTING_FAILED' };

export interface ReportFileStat {
  readonly mode: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface ReportFileHandle {
  writeFile(contents: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ReportFileSystem {
  lstat(path: string): Promise<ReportFileStat>;
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<string | undefined>;
  mkdtemp(prefix: string): Promise<string>;
  chmod(path: string, mode: number): Promise<void>;
  open(path: string, flags: typeof REPORT_FILE_FLAGS, mode: number): Promise<ReportFileHandle>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

export interface ReportWriterOptions {
  repositoryRoot?: string;
  fileSystem?: ReportFileSystem;
}

const NODE_FILE_SYSTEM: ReportFileSystem = {
  lstat: nodeLstat,
  mkdir: nodeMkdir,
  mkdtemp: nodeMkdtemp,
  chmod: nodeChmod,
  open: nodeOpen,
  rename: nodeRename,
  rm: nodeRm,
};

const PRODUCTION_REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function createReportWriter(
  options: ReportWriterOptions = {}
): (report: EvaluationReportV1) => Promise<ReportWriteResult> {
  return async (report): Promise<ReportWriteResult> => {
    const parsed = EvaluationReportV1Schema.safeParse(report);
    if (!parsed.success) return REPORTING_FAILURE;

    const json = `${JSON.stringify(parsed.data, null, 2)}\n`;
    const markdown = renderMarkdown(parsed.data);
    const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
    const repositoryRoot = resolve(options.repositoryRoot ?? PRODUCTION_REPOSITORY_ROOT);
    const artifactsParent = resolve(repositoryRoot, '.artifacts');
    const root = resolve(artifactsParent, 'intex-agent-evals');
    const finalPath = resolve(root, parsed.data.runId);
    const relativeDirectory = `.artifacts/intex-agent-evals/${parsed.data.runId}`;
    if (dirname(finalPath) !== root) return REPORTING_FAILURE;

    let temporaryPath: string | undefined;
    try {
      await ensureArtifactRoot(fileSystem, artifactsParent, root);
      await requireMissingPath(fileSystem, finalPath);

      const temporaryPrefix = join(root, `.tmp-${parsed.data.runId}-`);
      temporaryPath = await fileSystem.mkdtemp(temporaryPrefix);
      if (dirname(temporaryPath) !== root || !temporaryPath.startsWith(temporaryPrefix)) {
        throw new Error('Unsafe temporary directory');
      }
      await fileSystem.chmod(temporaryPath, PRIVATE_DIRECTORY_MODE);
      await requirePrivateDirectory(fileSystem, temporaryPath);

      await writePrivateFile(fileSystem, join(temporaryPath, 'report.json'), json);
      await writePrivateFile(fileSystem, join(temporaryPath, 'report.md'), markdown);

      await requireMissingPath(fileSystem, finalPath);
      await fileSystem.rename(temporaryPath, finalPath);
      temporaryPath = undefined;
      return { ok: true, relativeDirectory };
    } catch {
      if (temporaryPath !== undefined) {
        try {
          await fileSystem.rm(temporaryPath, { recursive: true, force: true });
        } catch {
          // Best-effort removal deliberately has no observable cause.
        }
      }
      return REPORTING_FAILURE;
    }
  };
}

async function ensureArtifactRoot(
  fileSystem: ReportFileSystem,
  artifactsParent: string,
  root: string
): Promise<void> {
  const parent = await optionalLstat(fileSystem, artifactsParent);
  if (parent === undefined) {
    await fileSystem.mkdir(artifactsParent, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const createdParent = await fileSystem.lstat(artifactsParent);
    if (createdParent.isSymbolicLink() || !createdParent.isDirectory()) {
      throw new Error('Unsafe artifact parent');
    }
  } else if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('Unsafe artifact parent');
  }

  const existingRoot = await optionalLstat(fileSystem, root);
  if (existingRoot === undefined) {
    await fileSystem.mkdir(root, { recursive: false, mode: PRIVATE_DIRECTORY_MODE });
    await fileSystem.chmod(root, PRIVATE_DIRECTORY_MODE);
  }
  await requirePrivateDirectory(fileSystem, root);
}

async function requirePrivateDirectory(fileSystem: ReportFileSystem, path: string): Promise<void> {
  const stat = await fileSystem.lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
  ) {
    throw new Error('Unsafe private directory');
  }
}

async function requireMissingPath(fileSystem: ReportFileSystem, path: string): Promise<void> {
  const stat = await optionalLstat(fileSystem, path);
  if (stat !== undefined) throw new Error('Final directory already exists');
}

async function optionalLstat(
  fileSystem: ReportFileSystem,
  path: string
): Promise<ReportFileStat | undefined> {
  try {
    return await fileSystem.lstat(path);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

async function writePrivateFile(
  fileSystem: ReportFileSystem,
  path: string,
  contents: string
): Promise<void> {
  const handle = await fileSystem.open(path, REPORT_FILE_FLAGS, PRIVATE_FILE_MODE);
  let failure: unknown;
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    throw failure instanceof Error ? failure : new Error('Report write failed');
  }
}

function renderMarkdown(report: EvaluationReportV1): string {
  const lines: string[] = [
    '# Intex Agent evaluation report',
    '',
    '## Run summary',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Run ID | ${code(report.runId)} |`,
    `| Command | ${code(report.command)} |`,
    `| Status | ${code(report.status)} |`,
    `| Exit code | ${String(report.exitCode)} |`,
    `| Started | ${code(report.startedAt)} |`,
    `| Finished | ${code(report.finishedAt)} |`,
    `| Duration (ms) | ${String(report.durationMs)} |`,
    `| Preflight | ${code(report.preflight.status)} |`,
  ];
  if (report.preflight.status === 'passed') {
    lines.push(`| Host | ${code(report.preflight.host)} |`);
    lines.push(`| Account alias | ${code(report.preflight.accountAlias)} |`);
    lines.push(`| Judge model | ${code(report.preflight.judgeModel)} |`);
  } else {
    lines.push(`| Preflight failure | ${code(report.preflight.code)} |`);
  }

  lines.push(
    '',
    '## Totals',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Scenarios | ${String(report.totals.scenarioCount)} |`,
    `| Passed scenarios | ${String(report.totals.scenarioPassed)} |`,
    `| Behavioral failures | ${String(report.totals.scenarioBehavioralFailed)} |`,
    `| Infrastructure failures | ${String(report.totals.scenarioInfrastructureFailed)} |`,
    `| Turns | ${String(report.totals.turnCount)} |`,
    `| Replies | ${String(report.totals.replyCount)} |`,
    `| Tool calls | ${String(report.totals.toolCallCount)} |`,
    `| Judge verdicts | ${String(report.totals.judgeVerdictCount)} |`,
    '',
    '## Judge usage',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Calls | ${String(report.judgeUsage.callCount)} |`,
    `| Repairs | ${String(report.judgeUsage.repairCount)} |`,
    `| Input tokens | ${String(report.judgeUsage.inputTokens)} |`,
    `| Output tokens | ${String(report.judgeUsage.outputTokens)} |`,
    `| Provider total tokens | ${String(report.judgeUsage.totalTokens)} |`,
    `| Provider-reported USD | ${String(report.judgeUsage.providerReportedUsd)} |`,
    `| Provider cost complete | ${String(report.judgeUsage.providerReportedUsdComplete)} |`,
    '',
    '## Scenarios',
    '',
    '| Scenario | Status | Exit | Duration (ms) | Turns | Replies | Tool calls |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
  );
  if (report.scenarios.length === 0) {
    lines.push('| _none_ | _none_ | - | - | - | - | - |');
  } else {
    for (const scenario of report.scenarios) {
      lines.push(
        `| ${code(scenario.scenarioId)} | ${code(scenario.status)} | ${String(scenario.exitCode)} | ${String(scenario.durationMs)} | ${String(scenario.turnCount)} | ${String(scenario.replyCount)} | ${String(scenario.toolCallCount)} |`
      );
    }
  }

  lines.push(
    '',
    '## Tool summaries',
    '',
    '| Scenario | Tool | Completed | Failed |',
    '| --- | --- | ---: | ---: |'
  );
  const toolRows = report.scenarios.flatMap((scenario) =>
    scenario.toolSummaries.map(
      (summary) =>
        `| ${code(scenario.scenarioId)} | ${code(summary.toolName)} | ${String(summary.completedCount)} | ${String(summary.failedCount)} |`
    )
  );
  lines.push(...(toolRows.length === 0 ? ['| _none_ | _none_ | - | - |'] : toolRows));

  lines.push(
    '',
    '## Deterministic failures',
    '',
    '| Scenario | Code | Path | Turn | Reply |',
    '| --- | --- | --- | ---: | ---: |'
  );
  const deterministicRows = report.scenarios.flatMap((scenario) =>
    scenario.deterministicFailures.map(
      (failure) =>
        `| ${code(scenario.scenarioId)} | ${code(failure.code)} | ${optionalCode(failure.path)} | ${optionalNumber(failure.turnIndex)} | ${optionalNumber(failure.replyIndex)} |`
    )
  );
  lines.push(
    ...(deterministicRows.length === 0 ? ['| _none_ | _none_ | - | - | - |'] : deterministicRows)
  );

  lines.push(
    '',
    '## Judge verdicts',
    '',
    '| Scenario | Turn | Reply | Pass | Score | Intent | Helpful | Clear | Professional | No passive aggression | Failures |',
    '| --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |'
  );
  const verdictRows = report.scenarios.flatMap((scenario) =>
    scenario.judgeVerdicts.map(
      (verdict) =>
        `| ${code(verdict.scenarioId)} | ${String(verdict.turnIndex)} | ${String(verdict.replyIndex)} | ${String(verdict.pass)} | ${String(verdict.score)} | ${String(verdict.criteria.understoodIntent)} | ${String(verdict.criteria.helpful)} | ${String(verdict.criteria.conciseAndClear)} | ${String(verdict.criteria.professionalTone)} | ${String(verdict.criteria.noPassiveAggression)} | ${formatCodeList(verdict.failures)} |`
    )
  );
  lines.push(
    ...(verdictRows.length === 0
      ? ['| _none_ | - | - | - | - | - | - | - | - | - | _none_ |']
      : verdictRows)
  );

  lines.push(
    '',
    '## Cleanup',
    '',
    '| Scenario | Status | Code | Deleted | Total |',
    '| --- | --- | --- | ---: | ---: |'
  );
  if (report.scenarios.length === 0) {
    lines.push('| _none_ | _none_ | _none_ | - | - |');
  } else {
    for (const scenario of report.scenarios) {
      lines.push(
        `| ${code(scenario.scenarioId)} | ${code(scenario.cleanup.status)} | ${'code' in scenario.cleanup ? code(scenario.cleanup.code) : '_none_'} | ${'deleted' in scenario.cleanup && scenario.cleanup.deleted !== undefined ? String(scenario.cleanup.deleted) : '-'} | ${'total' in scenario.cleanup && scenario.cleanup.total !== undefined ? String(scenario.cleanup.total) : '-'} |`
      );
    }
  }

  lines.push(
    '',
    '## Failures',
    '',
    '| Stage | Code | Path | Scenario | Turn | Reply |',
    '| --- | --- | --- | --- | ---: | ---: |'
  );
  if (report.failures.length === 0) {
    lines.push('| _none_ | _none_ | - | _none_ | - | - |');
  } else {
    for (const failure of report.failures) {
      lines.push(
        `| ${code(failure.stage)} | ${code(failure.code)} | ${failure.stage === 'deterministic' ? optionalCode(failure.path) : '-'} | ${failure.scenarioId === undefined ? '_none_' : code(failure.scenarioId)} | ${optionalNumber(failure.turnIndex)} | ${optionalNumber(failure.replyIndex)} |`
      );
    }
  }

  if (report.matrixSmoke !== undefined) {
    const matrix = report.matrixSmoke;
    lines.push(
      '',
      '## Matrix smoke',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Status | ${code(matrix.status)} |`,
      `| Exit code | ${String(matrix.exitCode)} |`,
      `| Duration (ms) | ${String(matrix.durationMs)} |`,
      `| Failure codes | ${formatCodeList(matrix.failureCodes)} |`,
      `| Cursor captured | ${String(matrix.transportFacts.cursorCaptured)} |`,
      `| Outbound sent | ${String(matrix.transportFacts.outboundSent)} |`,
      `| Eligible puppet text observed | ${String(matrix.transportFacts.eligiblePuppetTextObserved)} |`,
      `| Hidden tool audit | ${code(matrix.transportFacts.hiddenToolAudit)} |`,
      `| Judge pass | ${matrix.judge === undefined ? '_not_run_' : String(matrix.judge.pass)} |`,
      `| Judge score | ${matrix.judge === undefined ? '-' : String(matrix.judge.score)} |`,
      `| Judge intent | ${matrix.judge === undefined ? '-' : String(matrix.judge.criteria.understoodIntent)} |`,
      `| Judge helpful | ${matrix.judge === undefined ? '-' : String(matrix.judge.criteria.helpful)} |`,
      `| Judge clear | ${matrix.judge === undefined ? '-' : String(matrix.judge.criteria.conciseAndClear)} |`,
      `| Judge professional | ${matrix.judge === undefined ? '-' : String(matrix.judge.criteria.professionalTone)} |`,
      `| Judge no passive aggression | ${matrix.judge === undefined ? '-' : String(matrix.judge.criteria.noPassiveAggression)} |`,
      `| Judge failures | ${matrix.judge === undefined ? '_none_' : formatCodeList(matrix.judge.failures)} |`,
      `| Judge calls | ${String(matrix.judgeUsage.callCount)} |`,
      `| Judge repairs | ${String(matrix.judgeUsage.repairCount)} |`,
      `| Judge input tokens | ${String(matrix.judgeUsage.inputTokens)} |`,
      `| Judge output tokens | ${String(matrix.judgeUsage.outputTokens)} |`,
      `| Judge provider total tokens | ${String(matrix.judgeUsage.totalTokens)} |`,
      `| Judge provider-reported USD | ${String(matrix.judgeUsage.providerReportedUsd)} |`,
      `| Judge provider cost complete | ${String(matrix.judgeUsage.providerReportedUsdComplete)} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function code(value: string): string {
  return `\`${value}\``;
}

function optionalCode(value: string | undefined): string {
  return value === undefined ? '-' : code(value);
}

function optionalNumber(value: number | undefined): string {
  return value === undefined ? '-' : String(value);
}

function formatCodeList(values: readonly string[]): string {
  return values.length === 0 ? '_none_' : values.map(code).join(', ');
}
