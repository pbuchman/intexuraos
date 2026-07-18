import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateDeterministically } from './deterministicEvaluator.js';
import {
  createEndpointClient,
  createSyntheticRunIdentity,
  type EndpointToolCall,
} from './endpointClient.js';
import { createMatrixClient, type MatrixClient } from './live/matrixClient.js';
import {
  MATRIX_SMOKE_FAILURE_CODES,
  createProductionMatrixSmokeRunner,
  type MatrixSmokeFailureCode,
  type MatrixSmokeResult,
} from './live/runMatrixSmoke.js';
import { createMiniMaxEvaluator, type MiniMaxEvaluator } from './minimaxJudge.js';
import type { PreflightResult, SafeCheckResult, SetupResult } from './preflight.js';
import {
  createProductionPreflightPorts,
  createProductionSetupPorts,
  runPreflight,
  setupEvaluatorConfig,
} from './preflight.js';
import {
  createReportWriter,
  type EvaluationReportV1,
  type MatrixSmokeReportV1,
  type ReportJudgeUsageV1,
  type ReportWriteResult,
  type SafeReportFailureV1,
  type ScenarioReportV1,
} from './reportWriter.js';
import { runEndpointCorpus, type EndpointCorpusResult } from './runEndpointCorpus.js';
import {
  createCleanupPort,
  runEndpointScenario,
  type CleanupResult,
  type JudgeInfrastructureCode,
  type JudgeReplyVerdict,
  type JudgeUsageSummary,
  type ScenarioInfrastructureCode,
  type ScenarioLifecycleResult,
} from './runEndpointScenario.js';
import { loadScenarioCatalog } from './scenarioCatalog.js';
import type { IntexEvalScenario } from './scenarioSchema.js';
import type { IntexAgentToolName } from './types.js';

export type ExitCode = 0 | 1 | 2;

export type CliCommand =
  | { kind: 'setup' }
  | { kind: 'preflight' }
  | { kind: 'endpoint' }
  | { kind: 'full' }
  | { kind: 'scenario'; scenarioId: string }
  | { kind: 'matrix-smoke' };

export type CliParseResult =
  | { ok: true; command: CliCommand }
  | { ok: false; code: 'INVALID_COMMAND' };

export interface CliTextOutput {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface SetupInputPort {
  isInteractive(): boolean;
  readVisible(prompt: SetupPrompt): Promise<string>;
  readHidden(prompt: SetupPrompt): Promise<string>;
  close(): Promise<void>;
}

export type SetupPrompt =
  | 'account_alias'
  | 'canonical_user_id'
  | 'matrix_user_id'
  | 'matrix_access_token_file'
  | 'matrix_targets_file';

export interface ClockPort {
  now(): Date;
}

export interface TimedEndpointCorpusResult {
  result: EndpointCorpusResult;
  scenarioDurationMs: Readonly<Record<string, number>>;
}

export interface CliDependencies {
  output: CliTextOutput;
  setupInput: SetupInputPort;
  clock: ClockPort;
  createReportRunId(): string;
  loadScenarios(): Promise<readonly IntexEvalScenario[]>;
  setup(candidate: unknown): Promise<SetupResult>;
  preflight(): Promise<PreflightResult>;
  runEndpoint(scenarios: readonly IntexEvalScenario[]): Promise<TimedEndpointCorpusResult>;
  runMatrixSmoke(): Promise<MatrixSmokeResult>;
  writeReport(report: EvaluationReportV1): Promise<ReportWriteResult>;
}

type SetupTtyInput = NodeJS.ReadableStream & {
  readonly isRaw?: boolean;
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
};

type SetupTtyOutput = NodeJS.WritableStream & {
  readonly isTTY?: boolean;
};

export interface NodeSetupInputOptions {
  input?: SetupTtyInput;
  output?: SetupTtyOutput;
}

interface ActiveSetupRead {
  abort(): void;
  settled: Promise<void>;
}

const HIDDEN_OUTPUT = new Writable({
  write(_chunk, _encoding, callback): void {
    callback();
  },
});

export const PRODUCTION_ENDPOINT_SCENARIO_TIMEOUT_MS = 300_000;

const REPORT_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const JUDGE_INFRASTRUCTURE_CODES = [
  'MINIMAX_JUDGE_KEY_MISSING',
  'MINIMAX_JUDGE_TIMEOUT',
  'MINIMAX_JUDGE_PROVIDER_FAILED',
  'MINIMAX_JUDGE_INVALID_OUTPUT',
  'MINIMAX_JUDGE_USAGE_INVALID',
] as const satisfies readonly JudgeInfrastructureCode[];
const MATRIX_SMOKE_FAILURE_CODE_SET = new Set<string>(MATRIX_SMOKE_FAILURE_CODES);

export function createNodeSetupInputPort(options: NodeSetupInputOptions = {}): SetupInputPort {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let activeRead: ActiveSetupRead | undefined;

  async function readQuestion(hidden: boolean): Promise<string> {
    if (activeRead !== undefined) {
      throw new Error('SETUP_INPUT_ABORTED');
    }

    const controller = new AbortController();
    const wasRaw = input.isRaw === true;
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    let readline: ReturnType<typeof createInterface> | undefined;
    let closeListener: (() => void) | undefined;
    let sigintListener: (() => void) | undefined;

    activeRead = {
      abort(): void {
        controller.abort();
        readline?.close();
      },
      settled,
    };

    try {
      readline = createInterface({
        input,
        // Keep every raw TTY answer off the framed SSH output. The safe alias is
        // rendered only after setup validation in the closed result line.
        output: HIDDEN_OUTPUT,
        terminal: true,
      });
      const closed = new Promise<never>((_resolve, reject) => {
        closeListener = (): void => {
          reject(new Error('SETUP_INPUT_ABORTED'));
        };
        readline?.once('close', closeListener);
      });
      sigintListener = (): void => {
        controller.abort();
      };
      readline.once('SIGINT', sigintListener);
      return await Promise.race([readline.question('', { signal: controller.signal }), closed]);
    } catch {
      throw new Error('SETUP_INPUT_ABORTED');
    } finally {
      if (readline !== undefined) {
        if (closeListener !== undefined) readline.off('close', closeListener);
        if (sigintListener !== undefined) readline.off('SIGINT', sigintListener);
        controller.abort();
        readline.close();
      }
      if (input.isRaw !== wasRaw && input.setRawMode !== undefined) {
        try {
          input.setRawMode(wasRaw);
        } catch {
          // The caller receives the closed setup failure; raw-mode restoration was attempted.
        }
      }
      if (hidden) {
        output.write('\n');
      }
      activeRead = undefined;
      resolveSettled();
    }
  }

  return {
    isInteractive: () => input.isTTY === true && output.isTTY === true,
    readVisible: async (_prompt): Promise<string> => await readQuestion(false),
    readHidden: async (_prompt): Promise<string> => await readQuestion(true),
    async close(): Promise<void> {
      const current = activeRead;
      if (current === undefined) return;
      current.abort();
      await current.settled;
    },
  };
}

export function parseCliArgs(argv: readonly string[]): CliParseResult {
  if (argv.length === 0) {
    return { ok: true, command: { kind: 'full' } };
  }

  if (argv.length === 1) {
    const selector = argv[0];
    if (
      selector === 'setup' ||
      selector === 'preflight' ||
      selector === 'endpoint' ||
      selector === 'full' ||
      selector === 'matrix-smoke'
    ) {
      return { ok: true, command: { kind: selector } };
    }
  }

  const scenarioId = argv[1];
  if (
    argv.length === 2 &&
    (argv[0] === 'scenario' || argv[0] === '--scenario') &&
    scenarioId !== undefined &&
    scenarioId !== ''
  ) {
    return { ok: true, command: { kind: 'scenario', scenarioId } };
  }

  return { ok: false, code: 'INVALID_COMMAND' };
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies
): Promise<ExitCode> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    dependencies.output.stderr('cli result FAIL INVALID_COMMAND');
    return 2;
  }

  try {
    switch (parsed.command.kind) {
      case 'setup':
        return await runSetup(dependencies);
      case 'preflight':
        return await runPreflightCommand(dependencies);
      case 'scenario': {
        const scenarioId = parsed.command.scenarioId;
        const scenarios = await dependencies.loadScenarios();
        const selected = scenarios.find((scenario) => scenario.id === scenarioId);
        if (selected === undefined) {
          dependencies.output.stderr('cli result FAIL INVALID_SCENARIO');
          return 2;
        }
        return await runEvaluationCommand(parsed.command, [selected], dependencies);
      }
      case 'endpoint':
      case 'full': {
        const scenarios = await dependencies.loadScenarios();
        return await runEvaluationCommand(parsed.command, scenarios, dependencies);
      }
      case 'matrix-smoke':
        return await runEvaluationCommand(parsed.command, [], dependencies);
    }
  } catch {
    dependencies.output.stderr('cli result FAIL UNEXPECTED_FAILURE');
    return 2;
  }
}

async function runSetup(dependencies: CliDependencies): Promise<ExitCode> {
  let setupResult: SetupResult | undefined;
  let interactive = false;
  let unexpectedFailure = false;
  try {
    interactive = dependencies.setupInput.isInteractive();
    if (interactive) {
      const accountAlias = await readSetupInput(dependencies, 'account_alias', false);
      const userId = await readSetupInput(dependencies, 'canonical_user_id', true);
      const matrixUserId = await readSetupInput(dependencies, 'matrix_user_id', true);
      const matrixAccessTokenFile = await readSetupInput(
        dependencies,
        'matrix_access_token_file',
        true
      );
      const matrixTargetsFile = await readSetupInput(dependencies, 'matrix_targets_file', true);
      setupResult = await dependencies.setup({
        schemaVersion: 1,
        accountAlias,
        userId,
        matrixUserId,
        matrixAccessTokenFile,
        matrixTargetsFile,
      });
    }
  } catch {
    unexpectedFailure = true;
  } finally {
    try {
      await dependencies.setupInput.close();
    } catch {
      unexpectedFailure = true;
    }
  }

  if (unexpectedFailure) {
    dependencies.output.stderr('cli result FAIL UNEXPECTED_FAILURE');
    return 2;
  }
  if (!interactive) {
    dependencies.output.stderr('setup result FAIL SETUP_TTY_REQUIRED');
    return 2;
  }
  if (setupResult === undefined) {
    dependencies.output.stderr('cli result FAIL UNEXPECTED_FAILURE');
    return 2;
  }

  renderChecks('setup', setupResult.checks, dependencies.output);
  if (!setupResult.ok) {
    dependencies.output.stderr(`setup result FAIL ${setupResult.code}`);
    return 2;
  }
  dependencies.output.stdout(
    `setup result PASS ${setupResult.state} account ${setupResult.accountAlias}`
  );
  return 0;
}

async function readSetupInput(
  dependencies: CliDependencies,
  prompt: SetupPrompt,
  hidden: boolean
): Promise<string> {
  dependencies.output.stdout(`setup input ${prompt}`);
  return hidden
    ? await dependencies.setupInput.readHidden(prompt)
    : await dependencies.setupInput.readVisible(prompt);
}

async function runPreflightCommand(dependencies: CliDependencies): Promise<ExitCode> {
  const result = await dependencies.preflight();
  renderPreflightResult(result, dependencies.output);
  return result.ok ? 0 : 2;
}

function renderPreflightResult(result: PreflightResult, output: CliTextOutput): void {
  renderChecks('preflight', result.checks, output);
  if (!result.ok) {
    output.stderr(`preflight result FAIL ${result.code}`);
    return;
  }
  output.stdout(
    'preflight result PASS host home-dev intex-agent 8134 whatsapp-service 8113 ' +
      `matrix-adapter 8099 judge or:minimax/minimax-m3 scenarios ${String(result.summary.scenarioCount)} ` +
      `account ${result.summary.accountAlias}`
  );
}

function renderChecks(
  prefix: 'setup' | 'preflight',
  checks: readonly SafeCheckResult[],
  output: CliTextOutput
): void {
  for (const check of checks) {
    if (check.status === 'passed') {
      output.stdout(`${prefix} check ${check.check} PASS`);
    } else {
      output.stderr(`${prefix} check ${check.check} FAIL ${check.code}`);
    }
  }
}

type EvaluationCommand = Exclude<CliCommand, { kind: 'setup' } | { kind: 'preflight' }>;
type EvaluationStatus = EvaluationReportV1['status'];

interface ClockReading {
  milliseconds: number;
  timestamp: string;
}

interface EvaluationProjectionInput {
  command: EvaluationCommand;
  runId: string;
  started: ClockReading;
  finished: ClockReading;
  preflight: PreflightResult;
  endpoint?: TimedEndpointCorpusResult;
  matrixSmoke?: MatrixSmokeResult;
  orchestrationFailures: readonly SafeReportFailureV1[];
}

async function runEvaluationCommand(
  command: EvaluationCommand,
  scenarios: readonly IntexEvalScenario[],
  dependencies: CliDependencies
): Promise<ExitCode> {
  const runId = dependencies.createReportRunId();
  if (!REPORT_RUN_ID_PATTERN.test(runId)) {
    throw new Error('Invalid report run ID');
  }
  const started = readClock(dependencies.clock);
  dependencies.output.stdout(`evaluation run ${runId} command ${command.kind}`);

  let preflight: PreflightResult;
  try {
    preflight = await dependencies.preflight();
  } catch {
    preflight = {
      ok: false,
      exitCode: 2,
      code: 'UNEXPECTED_FAILURE',
      checks: [],
    };
  }
  renderPreflightResult(preflight, dependencies.output);

  let endpoint: TimedEndpointCorpusResult | undefined;
  let matrixSmoke: MatrixSmokeResult | undefined;
  const orchestrationFailures: SafeReportFailureV1[] = [];
  if (preflight.ok) {
    if (command.kind === 'endpoint' || command.kind === 'scenario' || command.kind === 'full') {
      try {
        endpoint = await dependencies.runEndpoint(scenarios);
      } catch {
        orchestrationFailures.push({ stage: 'endpoint', code: 'endpoint_failed' });
      }
      if (endpoint !== undefined) {
        renderScenarioResults(endpoint.result.scenarios, dependencies.output);
      }
    }

    const endpointAllowsMatrix =
      command.kind === 'matrix-smoke' ||
      (command.kind === 'full' && endpoint?.result.effectiveKind === 'passed');
    if (endpointAllowsMatrix) {
      try {
        matrixSmoke = await dependencies.runMatrixSmoke();
      } catch {
        matrixSmoke = unexpectedMatrixSmokeResult();
      }
      renderMatrixSmokeResult(matrixSmoke, dependencies.output);
    }
  }

  let report: EvaluationReportV1;
  try {
    report = projectEvaluationReport({
      command,
      runId,
      started,
      finished: readClock(dependencies.clock),
      preflight,
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(matrixSmoke !== undefined ? { matrixSmoke } : {}),
      orchestrationFailures,
    });
  } catch {
    renderEvaluationResult('infrastructure_failure', dependencies.output);
    dependencies.output.stderr('evaluation report FAIL REPORTING_FAILED');
    return 2;
  }

  let reportResult: ReportWriteResult;
  try {
    reportResult = await dependencies.writeReport(report);
  } catch {
    reportResult = { ok: false, code: 'REPORTING_FAILED' };
  }
  if (!reportResult.ok) {
    renderEvaluationResult('infrastructure_failure', dependencies.output);
    dependencies.output.stderr('evaluation report FAIL REPORTING_FAILED');
    return 2;
  }

  renderEvaluationResult(report.status, dependencies.output);
  dependencies.output.stdout(`evaluation report .artifacts/intex-agent-evals/${runId}`);
  return report.exitCode;
}

function readClock(clock: ClockPort): ClockReading {
  const date = clock.now();
  const milliseconds = date.getTime();
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error('Invalid clock value');
  }
  return { milliseconds, timestamp: date.toISOString() };
}

function renderScenarioResults(
  scenarios: readonly ScenarioLifecycleResult[],
  output: CliTextOutput
): void {
  for (const scenario of scenarios) {
    if (scenario.effectiveKind === 'passed') {
      output.stdout(`scenario ${scenario.scenarioId} PASS`);
    } else if (scenario.effectiveKind === 'behavioral_failure') {
      output.stdout(`scenario ${scenario.scenarioId} BEHAVIORAL_FAILURE`);
    } else {
      output.stderr(`scenario ${scenario.scenarioId} INFRASTRUCTURE_FAILURE`);
    }
  }
}

function renderMatrixSmokeResult(result: MatrixSmokeResult, output: CliTextOutput): void {
  if (result.effectiveKind === 'passed') {
    output.stdout('matrix-smoke PASS');
  } else if (result.effectiveKind === 'behavioral_failure') {
    output.stdout('matrix-smoke BEHAVIORAL_FAILURE');
  } else {
    output.stderr('matrix-smoke INFRASTRUCTURE_FAILURE');
  }
}

function renderEvaluationResult(status: EvaluationStatus, output: CliTextOutput): void {
  if (status === 'passed') {
    output.stdout('evaluation result PASS exit 0');
  } else if (status === 'behavioral_failure') {
    output.stdout('evaluation result BEHAVIORAL_FAILURE exit 1');
  } else {
    output.stderr('evaluation result INFRASTRUCTURE_FAILURE exit 2');
  }
}

function unexpectedMatrixSmokeResult(): MatrixSmokeResult {
  return {
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
    transportFacts: {
      cursorCaptured: false,
      outboundSent: false,
      eligiblePuppetTextObserved: false,
      hiddenToolAudit: 'not_available',
    },
    judge: { status: 'not_run' },
    durationMs: 0,
  };
}

function projectEvaluationReport(input: EvaluationProjectionInput): EvaluationReportV1 {
  const durationMs = input.finished.milliseconds - input.started.milliseconds;
  requireNonNegativeSafeInteger(durationMs);
  const scenarios =
    input.endpoint?.result.scenarios.map((scenario) =>
      projectScenario(scenario, input.endpoint?.scenarioDurationMs)
    ) ?? [];
  const matrixSmoke =
    input.matrixSmoke === undefined ? undefined : projectMatrixSmoke(input.matrixSmoke);
  const status = effectiveEvaluationStatus(
    input.preflight,
    input.endpoint?.result,
    input.matrixSmoke,
    input.orchestrationFailures
  );
  const failures: SafeReportFailureV1[] = [
    ...(input.preflight.ok ? [] : [{ stage: 'preflight', code: input.preflight.code } as const]),
    ...input.orchestrationFailures,
    ...(input.endpoint?.result.scenarios.flatMap(projectScenarioFailures) ?? []),
    ...(input.matrixSmoke === undefined ? [] : projectMatrixFailures(input.matrixSmoke)),
  ];
  const judgeUsage = aggregateJudgeUsage(input.endpoint?.result.scenarios ?? [], input.matrixSmoke);
  const report: EvaluationReportV1 = {
    schemaVersion: 1,
    runId: input.runId,
    command: input.command.kind,
    startedAt: input.started.timestamp,
    finishedAt: input.finished.timestamp,
    durationMs,
    status,
    exitCode: exitCodeForStatus(status),
    preflight: projectPreflight(input.preflight),
    totals: {
      scenarioCount: scenarios.length,
      scenarioPassed: scenarios.filter((scenario) => scenario.status === 'passed').length,
      scenarioBehavioralFailed: scenarios.filter(
        (scenario) => scenario.status === 'behavioral_failure'
      ).length,
      scenarioInfrastructureFailed: scenarios.filter(
        (scenario) => scenario.status === 'infrastructure_failure'
      ).length,
      turnCount: sumScenarioCount(scenarios, 'turnCount'),
      replyCount: sumScenarioCount(scenarios, 'replyCount'),
      toolCallCount: sumScenarioCount(scenarios, 'toolCallCount'),
      judgeVerdictCount: scenarios.reduce(
        (total, scenario) => checkedIntegerSum(total, scenario.judgeVerdicts.length),
        0
      ),
    },
    judgeUsage,
    scenarios,
    ...(matrixSmoke !== undefined ? { matrixSmoke } : {}),
    failures,
  };
  return report;
}

function effectiveEvaluationStatus(
  preflight: PreflightResult,
  endpoint: EndpointCorpusResult | undefined,
  matrixSmoke: MatrixSmokeResult | undefined,
  orchestrationFailures: readonly SafeReportFailureV1[]
): EvaluationStatus {
  if (
    !preflight.ok ||
    orchestrationFailures.length > 0 ||
    endpoint?.effectiveKind === 'infrastructure_failure' ||
    matrixSmoke?.effectiveKind === 'infrastructure_failure'
  ) {
    return 'infrastructure_failure';
  }
  if (
    endpoint?.effectiveKind === 'behavioral_failure' ||
    matrixSmoke?.effectiveKind === 'behavioral_failure'
  ) {
    return 'behavioral_failure';
  }
  return 'passed';
}

function exitCodeForStatus(status: EvaluationStatus): ExitCode {
  return status === 'passed' ? 0 : status === 'behavioral_failure' ? 1 : 2;
}

function projectPreflight(result: PreflightResult): EvaluationReportV1['preflight'] {
  if (!result.ok) {
    return { status: 'failed', code: result.code, checks: [...result.checks] };
  }
  return {
    status: 'passed',
    host: 'home-dev',
    ports: {
      intexAgent: 8134,
      whatsappService: 8113,
      matrixAdapter: 8099,
    },
    judgeModel: 'or:minimax/minimax-m3',
    scenarioCount: result.summary.scenarioCount,
    accountAlias: result.summary.accountAlias,
    checks: [...result.checks],
  };
}

function projectScenario(
  result: ScenarioLifecycleResult,
  durationByScenario: Readonly<Record<string, number>> | undefined
): ScenarioReportV1 {
  const durationMs = durationByScenario?.[result.scenarioId];
  if (durationMs === undefined) {
    throw new Error('Missing scenario duration');
  }
  requireNonNegativeSafeInteger(durationMs);
  const response =
    result.primary.endpoint.status === 'completed' ? result.primary.endpoint.value : undefined;
  const turns = response?.turns ?? [];
  const toolCalls = turns.flatMap((turn) => turn.toolCalls);
  const deterministicFailures =
    result.primary.deterministic.status === 'completed'
      ? result.primary.deterministic.value.failures.map((failure) => ({
          code: failure.code,
          ...(failure.turnIndex !== undefined ? { turnIndex: failure.turnIndex } : {}),
          ...(failure.replyIndex !== undefined ? { replyIndex: failure.replyIndex } : {}),
        }))
      : [];
  const judgeVerdicts = projectScenarioVerdicts(result);
  return {
    scenarioId: result.scenarioId,
    status: result.effectiveKind,
    exitCode: result.exitCode,
    durationMs,
    turnCount: turns.length,
    replyCount: turns.reduce(
      (total, turn) => checkedIntegerSum(total, turn.assistantReplies.length),
      0
    ),
    toolCallCount: toolCalls.length,
    toolSummaries: summarizeTools(toolCalls),
    deterministicFailures,
    judgeVerdicts,
    cleanup: projectCleanup(result.cleanup),
  };
}

function summarizeTools(toolCalls: readonly EndpointToolCall[]): ScenarioReportV1['toolSummaries'] {
  const summaries = new Map<
    IntexAgentToolName,
    { toolName: IntexAgentToolName; completedCount: number; failedCount: number }
  >();
  for (const toolCall of toolCalls) {
    const summary = summaries.get(toolCall.toolName) ?? {
      toolName: toolCall.toolName,
      completedCount: 0,
      failedCount: 0,
    };
    if (toolCall.status === 'completed') {
      summary.completedCount = checkedIntegerSum(summary.completedCount, 1);
    } else {
      summary.failedCount = checkedIntegerSum(summary.failedCount, 1);
    }
    summaries.set(toolCall.toolName, summary);
  }
  return [...summaries.values()].sort((left, right) => left.toolName.localeCompare(right.toolName));
}

function projectScenarioVerdicts(
  result: ScenarioLifecycleResult
): ScenarioReportV1['judgeVerdicts'] {
  if (result.primary.judge.status !== 'completed') return [];
  const judge = result.primary.judge.value;
  const verdicts = judge.ok ? judge.verdicts : judge.completedVerdicts;
  return verdicts.map(projectJudgeVerdict);
}

function projectJudgeVerdict(
  verdict: JudgeReplyVerdict
): ScenarioReportV1['judgeVerdicts'][number] {
  return {
    scenarioId: verdict.scenarioId,
    turnIndex: verdict.turnIndex,
    replyIndex: verdict.replyIndex,
    pass: verdict.pass,
    score: verdict.score,
    criteria: { ...verdict.criteria },
    failures: [...verdict.failures],
  };
}

function projectCleanup(cleanup: CleanupResult): ScenarioReportV1['cleanup'] {
  if (cleanup.status === 'not_required') {
    return { status: 'not_required', code: cleanup.code };
  }
  if (cleanup.status === 'passed') {
    return { status: 'passed', deleted: cleanup.deleted, total: cleanup.total };
  }
  if (cleanup.code === 'cleanup_count_mismatch') {
    if (cleanup.deleted === undefined || cleanup.total === undefined) {
      throw new Error('Invalid cleanup count mismatch');
    }
    return {
      status: 'infrastructure_failure',
      code: cleanup.code,
      deleted: cleanup.deleted,
      total: cleanup.total,
    };
  }
  return {
    status: 'infrastructure_failure',
    code: 'cleanup_failed',
    ...(cleanup.deleted !== undefined ? { deleted: cleanup.deleted } : {}),
    ...(cleanup.total !== undefined ? { total: cleanup.total } : {}),
  };
}

function projectMatrixSmoke(result: MatrixSmokeResult): MatrixSmokeReportV1 {
  for (const code of result.failureCodes) {
    if (!MATRIX_SMOKE_FAILURE_CODE_SET.has(code)) {
      throw new Error('Invalid Matrix smoke failure code');
    }
  }
  const usage =
    result.judge.status === 'not_run'
      ? emptyReportJudgeUsage()
      : projectJudgeUsage(result.judge.usage);
  return {
    status: result.effectiveKind,
    exitCode: result.exitCode,
    failureCodes: [...result.failureCodes],
    durationMs: result.durationMs,
    transportFacts: { ...result.transportFacts },
    ...(result.judge.status === 'completed'
      ? {
          judge: {
            pass: result.judge.verdict.pass,
            score: result.judge.verdict.score,
            criteria: { ...result.judge.verdict.criteria },
            failures: [...result.judge.verdict.failures],
          },
        }
      : {}),
    judgeUsage: usage,
  };
}

function projectScenarioFailures(result: ScenarioLifecycleResult): SafeReportFailureV1[] {
  const failures: SafeReportFailureV1[] = [];
  if (result.identity.status === 'infrastructure_failure') {
    failures.push(projectScenarioInfrastructureCode(result.identity.code, result.scenarioId));
  }
  for (const stage of [
    result.primary.endpoint,
    result.primary.deterministic,
    result.primary.judge,
  ]) {
    if (stage.status === 'infrastructure_failure') {
      failures.push(projectScenarioInfrastructureCode(stage.code, result.scenarioId));
    }
  }
  if (result.primary.deterministic.status === 'completed') {
    for (const failure of result.primary.deterministic.value.failures) {
      failures.push({
        stage: 'deterministic',
        code: failure.code,
        scenarioId: result.scenarioId,
        ...(failure.turnIndex !== undefined ? { turnIndex: failure.turnIndex } : {}),
        ...(failure.replyIndex !== undefined ? { replyIndex: failure.replyIndex } : {}),
      });
    }
  }
  if (result.primary.judge.status === 'completed') {
    const judge = result.primary.judge.value;
    const verdicts = judge.ok ? judge.verdicts : judge.completedVerdicts;
    for (const verdict of verdicts) {
      for (const code of verdict.failures) {
        failures.push({
          stage: 'judge',
          code,
          scenarioId: verdict.scenarioId,
          turnIndex: verdict.turnIndex,
          replyIndex: verdict.replyIndex,
        });
      }
    }
    if (!judge.ok) {
      failures.push({
        stage: 'judge',
        code: judge.code,
        scenarioId: judge.failedReply.scenarioId,
        turnIndex: judge.failedReply.turnIndex,
        replyIndex: judge.failedReply.replyIndex,
      });
    }
  }
  if (result.cleanup.status === 'not_required') {
    failures.push({
      stage: 'cleanup',
      code: result.cleanup.code,
      scenarioId: result.scenarioId,
    });
  } else if (result.cleanup.status === 'infrastructure_failure') {
    failures.push({
      stage: 'cleanup',
      code: result.cleanup.code,
      scenarioId: result.scenarioId,
    });
  }
  return failures;
}

function projectScenarioInfrastructureCode(
  code: ScenarioInfrastructureCode,
  scenarioId: string
): SafeReportFailureV1 {
  switch (code) {
    case 'missing_internal_auth':
    case 'endpoint_timeout':
    case 'endpoint_transport_failed':
    case 'endpoint_http_failed':
    case 'malformed_endpoint_response':
    case 'endpoint_correlation_failed':
    case 'identity_generation_failed':
    case 'endpoint_failed':
      return { stage: 'endpoint', code, scenarioId };
    case 'deterministic_evaluator_failed':
      return { stage: 'deterministic', code, scenarioId };
    case 'judge_failed':
    case 'judge_protocol_failed':
      return { stage: 'judge', code, scenarioId };
  }
}

function projectMatrixFailures(result: MatrixSmokeResult): SafeReportFailureV1[] {
  const failures: SafeReportFailureV1[] = [];
  for (const code of result.failureCodes) {
    const failure: SafeReportFailureV1 = isJudgeInfrastructureCode(code)
      ? { stage: 'judge', code }
      : { stage: 'matrix_smoke', code };
    pushUniqueFailure(failures, failure);
  }
  if (result.judge.status === 'infrastructure_failure') {
    pushUniqueFailure(failures, { stage: 'judge', code: result.judge.code });
  } else if (result.judge.status === 'completed') {
    for (const code of result.judge.verdict.failures) {
      pushUniqueFailure(failures, { stage: 'judge', code });
    }
  }
  return failures;
}

function isJudgeInfrastructureCode(code: MatrixSmokeFailureCode): code is JudgeInfrastructureCode {
  return (JUDGE_INFRASTRUCTURE_CODES as readonly string[]).includes(code);
}

function pushUniqueFailure(failures: SafeReportFailureV1[], candidate: SafeReportFailureV1): void {
  if (
    failures.some(
      (failure) =>
        failure.stage === candidate.stage &&
        failure.code === candidate.code &&
        failure.scenarioId === candidate.scenarioId &&
        failure.turnIndex === candidate.turnIndex &&
        failure.replyIndex === candidate.replyIndex
    )
  ) {
    return;
  }
  failures.push(candidate);
}

function aggregateJudgeUsage(
  scenarios: readonly ScenarioLifecycleResult[],
  matrixSmoke: MatrixSmokeResult | undefined
): ReportJudgeUsageV1 {
  const usages: JudgeUsageSummary[] = [];
  for (const scenario of scenarios) {
    if (scenario.primary.judge.status === 'completed') {
      usages.push(scenario.primary.judge.value.usage);
    }
  }
  if (
    matrixSmoke?.judge.status === 'completed' ||
    matrixSmoke?.judge.status === 'infrastructure_failure'
  ) {
    usages.push(matrixSmoke.judge.usage);
  }
  return usages.reduce(addJudgeUsage, emptyReportJudgeUsage());
}

function emptyReportJudgeUsage(): ReportJudgeUsageV1 {
  return {
    callCount: 0,
    repairCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    providerReportedUsd: 0,
    providerReportedUsdComplete: true,
  };
}

function projectJudgeUsage(usage: JudgeUsageSummary): ReportJudgeUsageV1 {
  return addJudgeUsage(emptyReportJudgeUsage(), usage);
}

function addJudgeUsage(total: ReportJudgeUsageV1, usage: JudgeUsageSummary): ReportJudgeUsageV1 {
  const providerReportedUsd = total.providerReportedUsd + usage.providerReportedUsd;
  if (!Number.isFinite(providerReportedUsd) || providerReportedUsd < 0) {
    throw new Error('Invalid provider-reported cost');
  }
  return {
    callCount: checkedIntegerSum(total.callCount, usage.logicalCalls),
    repairCount: checkedIntegerSum(total.repairCount, usage.repairCount),
    inputTokens: checkedIntegerSum(total.inputTokens, usage.inputTokens),
    outputTokens: checkedIntegerSum(total.outputTokens, usage.outputTokens),
    totalTokens: checkedIntegerSum(total.totalTokens, usage.totalTokens),
    providerReportedUsd,
    providerReportedUsdComplete:
      total.providerReportedUsdComplete && usage.providerReportedUsdComplete,
  };
}

function sumScenarioCount(
  scenarios: readonly ScenarioReportV1[],
  key: 'turnCount' | 'replyCount' | 'toolCallCount'
): number {
  return scenarios.reduce((total, scenario) => checkedIntegerSum(total, scenario[key]), 0);
}

function checkedIntegerSum(left: number, right: number): number {
  requireNonNegativeSafeInteger(left);
  requireNonNegativeSafeInteger(right);
  const sum = left + right;
  requireNonNegativeSafeInteger(sum);
  return sum;
}

function requireNonNegativeSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid non-negative integer');
  }
}

export function createProductionCliDependencies(): CliDependencies {
  const output: CliTextOutput = {
    stdout(line): void {
      process.stdout.write(`${line}\n`);
    },
    stderr(line): void {
      process.stdout.write(`${line}\n`);
    },
  };
  const setupInput = createNodeSetupInputPort();
  const clock: ClockPort = { now: () => new Date() };
  let matrix: MatrixClient | undefined;
  let miniMax: MiniMaxEvaluator | undefined;
  let matrixSmokeRunner: (() => Promise<MatrixSmokeResult>) | undefined;
  let reportWriter: ((report: EvaluationReportV1) => Promise<ReportWriteResult>) | undefined;

  function getMatrix(): MatrixClient {
    matrix ??= createMatrixClient();
    return matrix;
  }

  function getMiniMax(): MiniMaxEvaluator {
    miniMax ??= createMiniMaxEvaluator({
      apiKey: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
    });
    return miniMax;
  }

  function getMatrixSmokeRunner(): () => Promise<MatrixSmokeResult> {
    matrixSmokeRunner ??= createProductionMatrixSmokeRunner({
      matrix: getMatrix(),
      judgeMatrixSmokeReply: getMiniMax().judgeMatrixSmokeReply,
    });
    return matrixSmokeRunner;
  }

  function getReportWriter(): (report: EvaluationReportV1) => Promise<ReportWriteResult> {
    reportWriter ??= createReportWriter();
    return reportWriter;
  }

  const dependencies: CliDependencies = {
    output,
    setupInput,
    clock,
    createReportRunId: () => `eval-${randomUUID().toLowerCase()}`,
    loadScenarios: async () =>
      await loadScenarioCatalog(fileURLToPath(new URL('../scenarios/', import.meta.url))),
    setup: async (candidate) =>
      await setupEvaluatorConfig(candidate, createProductionSetupPorts({ matrix: getMatrix() })),
    preflight: async () =>
      await runPreflight(
        createProductionPreflightPorts({
          matrix: getMatrix(),
          miniMaxProbe: getMiniMax(),
        })
      ),
    async runEndpoint(scenarios): Promise<TimedEndpointCorpusResult> {
      const evaluator = getMiniMax();
      const endpoint = createEndpointClient({
        internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
        timeoutMs: PRODUCTION_ENDPOINT_SCENARIO_TIMEOUT_MS,
      });
      const cleanup = createCleanupPort();
      const scenarioDurationMs: Record<string, number> = {};
      const result = await runEndpointCorpus(scenarios, {
        runScenario: async (scenario) => {
          const startedAt = readClock(clock).milliseconds;
          try {
            return await runEndpointScenario(scenario, {
              endpoint,
              evaluateDeterministically,
              judgeReplies: evaluator.judgeReplies,
              cleanup,
              createIdentity: createSyntheticRunIdentity,
            });
          } finally {
            const durationMs = readClock(clock).milliseconds - startedAt;
            requireNonNegativeSafeInteger(durationMs);
            scenarioDurationMs[scenario.id] = durationMs;
          }
        },
      });
      return { result, scenarioDurationMs };
    },
    runMatrixSmoke: async () => await getMatrixSmokeRunner()(),
    writeReport: async (report) => await getReportWriter()(report),
  };
  return dependencies;
}

function isDirectModule(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectModule()) {
  try {
    process.exitCode = await runCli(process.argv.slice(2), createProductionCliDependencies());
  } catch {
    process.stdout.write('cli result FAIL UNEXPECTED_FAILURE\n');
    process.exitCode = 2;
  }
}
