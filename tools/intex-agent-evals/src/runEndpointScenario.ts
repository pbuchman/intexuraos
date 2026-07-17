import {
  EndpointClientError,
  type EndpointClient,
  type EndpointConversationResponse,
  type EndpointFailureCode,
  type SyntheticRunIdentity,
} from './endpointClient.js';
import {
  evaluateDeterministically,
  type DeterministicEvaluation,
  type ReplyEvaluationInput,
} from './deterministicEvaluator.js';
import type { IntexEvalScenario } from './scenarioSchema.js';

export type JudgeFailure =
  | 'misunderstood_intent'
  | 'missing_information'
  | 'unhelpful'
  | 'unclear'
  | 'bad_tone'
  | 'unsupported_claim';

export interface JudgeReplyVerdict {
  scenarioId: string;
  turnIndex: number;
  replyIndex: number;
  pass: boolean;
  score: number;
  criteria: {
    understoodIntent: boolean;
    helpful: boolean;
    conciseAndClear: boolean;
    professionalTone: boolean;
    noPassiveAggression: boolean;
  };
  failures: JudgeFailure[];
  rationale: string;
}

export interface JudgeUsageSummary {
  logicalCalls: number;
  repairCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerReportedUsd: number;
  providerReportedUsdComplete: boolean;
}

export type JudgeInfrastructureCode =
  | 'MINIMAX_JUDGE_KEY_MISSING'
  | 'MINIMAX_JUDGE_TIMEOUT'
  | 'MINIMAX_JUDGE_PROVIDER_FAILED'
  | 'MINIMAX_JUDGE_INVALID_OUTPUT'
  | 'MINIMAX_JUDGE_USAGE_INVALID';

export type JudgeRepliesResult =
  | {
      ok: true;
      verdicts: readonly JudgeReplyVerdict[];
      usage: JudgeUsageSummary;
    }
  | {
      ok: false;
      code: JudgeInfrastructureCode;
      failedReply: {
        scenarioId: string;
        turnIndex: number;
        replyIndex: number;
      };
      completedVerdicts: readonly JudgeReplyVerdict[];
      usage: JudgeUsageSummary;
    };

export type JudgeReplies = (inputs: readonly ReplyEvaluationInput[]) => Promise<JudgeRepliesResult>;

export interface CleanupPort {
  cleanup(identity: SyntheticRunIdentity): Promise<{ deleted: number; total: number }>;
}

export type StageResult<T> =
  | { status: 'not_run' }
  | { status: 'completed'; value: T }
  | { status: 'infrastructure_failure'; code: ScenarioInfrastructureCode };

export type ScenarioInfrastructureCode =
  | EndpointFailureCode
  | 'identity_generation_failed'
  | 'endpoint_failed'
  | 'deterministic_evaluator_failed'
  | 'judge_failed'
  | 'judge_protocol_failed';

export interface ScenarioPrimaryResult {
  kind: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  endpoint: StageResult<EndpointConversationResponse>;
  deterministic: StageResult<DeterministicEvaluation>;
  judge: StageResult<JudgeRepliesResult>;
}

export type CleanupResult =
  | { status: 'not_required'; code: 'identity_not_created' }
  | { status: 'passed'; deleted: number; total: number }
  | {
      status: 'infrastructure_failure';
      code: 'cleanup_failed' | 'cleanup_count_mismatch';
      deleted?: number;
      total?: number;
    };

export interface ScenarioLifecycleResult {
  scenarioId: string;
  identity: StageResult<SyntheticRunIdentity>;
  primary: ScenarioPrimaryResult;
  cleanup: CleanupResult;
  effectiveKind: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  exitCode: 0 | 1 | 2;
}

export interface RunEndpointScenarioDeps {
  endpoint: EndpointClient;
  evaluateDeterministically: typeof evaluateDeterministically;
  judgeReplies: JudgeReplies;
  cleanup: CleanupPort;
  createIdentity: (scenarioId: string) => SyntheticRunIdentity;
}

export interface CleanupModule {
  parseArgs(argv: string[]): unknown;
  runCleanup(
    input: unknown,
    output?: { writeLine(line: string): void }
  ): Promise<{ deleted: number; total: number }>;
}

export type CleanupModuleLoader = () => Promise<CleanupModule>;

const NOT_RUN = { status: 'not_run' } as const;

export async function runEndpointScenario(
  scenario: IntexEvalScenario,
  deps: RunEndpointScenarioDeps
): Promise<ScenarioLifecycleResult> {
  let identity: SyntheticRunIdentity;
  try {
    identity = deps.createIdentity(scenario.id);
  } catch {
    return {
      scenarioId: scenario.id,
      identity: { status: 'infrastructure_failure', code: 'identity_generation_failed' },
      primary: {
        kind: 'infrastructure_failure',
        endpoint: NOT_RUN,
        deterministic: NOT_RUN,
        judge: NOT_RUN,
      },
      cleanup: { status: 'not_required', code: 'identity_not_created' },
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
    };
  }

  let primary: ScenarioPrimaryResult;
  let cleanup: CleanupResult = { status: 'infrastructure_failure', code: 'cleanup_failed' };
  try {
    primary = await executePrimary(scenario, identity, deps);
  } finally {
    cleanup = await captureCleanup(identity, deps.cleanup);
  }

  const effectiveKind =
    primary.kind === 'infrastructure_failure' || cleanup.status === 'infrastructure_failure'
      ? 'infrastructure_failure'
      : primary.kind;
  const exitCode =
    effectiveKind === 'infrastructure_failure' ? 2 : effectiveKind === 'behavioral_failure' ? 1 : 0;

  return {
    scenarioId: scenario.id,
    identity: { status: 'completed', value: identity },
    primary,
    cleanup,
    effectiveKind,
    exitCode,
  };
}

export function createCleanupPort(
  loadModule: CleanupModuleLoader = loadDefaultCleanupModule
): CleanupPort {
  return {
    async cleanup(identity: SyntheticRunIdentity): Promise<{ deleted: number; total: number }> {
      const cleanupModule = await loadModule();
      const parsed = cleanupModule.parseArgs([
        '--user-id',
        identity.userId,
        '--run-id',
        identity.runId,
        '--execute',
      ]);
      return await cleanupModule.runCleanup(parsed, {
        writeLine(): void {
          return undefined;
        },
      });
    },
  };
}

async function executePrimary(
  scenario: IntexEvalScenario,
  identity: SyntheticRunIdentity,
  deps: RunEndpointScenarioDeps
): Promise<ScenarioPrimaryResult> {
  let endpointResponse: EndpointConversationResponse;
  try {
    endpointResponse = await deps.endpoint.runScenario(scenario, identity);
  } catch (error) {
    return {
      kind: 'infrastructure_failure',
      endpoint: {
        status: 'infrastructure_failure',
        code: error instanceof EndpointClientError ? error.code : 'endpoint_failed',
      },
      deterministic: NOT_RUN,
      judge: NOT_RUN,
    };
  }

  let deterministic: DeterministicEvaluation;
  try {
    deterministic = deps.evaluateDeterministically(scenario, endpointResponse);
  } catch {
    return {
      kind: 'infrastructure_failure',
      endpoint: { status: 'completed', value: endpointResponse },
      deterministic: {
        status: 'infrastructure_failure',
        code: 'deterministic_evaluator_failed',
      },
      judge: NOT_RUN,
    };
  }

  let judgeResult: JudgeRepliesResult;
  try {
    judgeResult = await deps.judgeReplies(deterministic.repliesForJudge);
  } catch {
    return {
      kind: 'infrastructure_failure',
      endpoint: { status: 'completed', value: endpointResponse },
      deterministic: { status: 'completed', value: deterministic },
      judge: { status: 'infrastructure_failure', code: 'judge_failed' },
    };
  }

  if (!judgeProtocolMatches(deterministic.repliesForJudge, judgeResult)) {
    return {
      kind: 'infrastructure_failure',
      endpoint: { status: 'completed', value: endpointResponse },
      deterministic: { status: 'completed', value: deterministic },
      judge: { status: 'infrastructure_failure', code: 'judge_protocol_failed' },
    };
  }

  const infrastructureFailure = !judgeResult.ok;
  const behavioralFailure =
    !deterministic.passed ||
    (judgeResult.ok && judgeResult.verdicts.some((verdict) => !verdict.pass));
  return {
    kind: infrastructureFailure
      ? 'infrastructure_failure'
      : behavioralFailure
        ? 'behavioral_failure'
        : 'passed',
    endpoint: { status: 'completed', value: endpointResponse },
    deterministic: { status: 'completed', value: deterministic },
    judge: { status: 'completed', value: judgeResult },
  };
}

async function captureCleanup(
  identity: SyntheticRunIdentity,
  cleanupPort: CleanupPort
): Promise<CleanupResult> {
  try {
    const result = await cleanupPort.cleanup(identity);
    if (result.deleted !== result.total) {
      return {
        status: 'infrastructure_failure',
        code: 'cleanup_count_mismatch',
        deleted: result.deleted,
        total: result.total,
      };
    }
    return { status: 'passed', deleted: result.deleted, total: result.total };
  } catch {
    return { status: 'infrastructure_failure', code: 'cleanup_failed' };
  }
}

function judgeProtocolMatches(
  inputs: readonly ReplyEvaluationInput[],
  result: JudgeRepliesResult
): boolean {
  if (result.ok) {
    if (result.verdicts.length !== inputs.length) return false;
    const expected = new Set(inputs.map(referenceKey));
    const observed = new Set(result.verdicts.map(referenceKey));
    return observed.size === result.verdicts.length && setsEqual(expected, observed);
  }

  if (result.completedVerdicts.length >= inputs.length) return false;
  for (const [index, verdict] of result.completedVerdicts.entries()) {
    const input = inputs[index];
    if (input === undefined || referenceKey(verdict) !== referenceKey(input)) return false;
  }
  const failedInput = inputs[result.completedVerdicts.length];
  return (
    failedInput !== undefined && referenceKey(result.failedReply) === referenceKey(failedInput)
  );
}

function referenceKey(reference: {
  scenarioId: string;
  turnIndex: number;
  replyIndex: number;
}): string {
  return `${reference.scenarioId}\u0000${String(reference.turnIndex)}\u0000${String(reference.replyIndex)}`;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

async function loadDefaultCleanupModule(): Promise<CleanupModule> {
  const moduleUrl = new URL(
    '../../../scripts/cleanup-intex-agent-test-conversations.mjs',
    import.meta.url
  ).href;
  return (await import(moduleUrl)) as CleanupModule;
}
