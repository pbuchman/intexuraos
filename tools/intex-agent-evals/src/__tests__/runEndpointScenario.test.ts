import { describe, expect, it, vi } from 'vitest';
import type { IntexEvalScenario } from '../scenarioSchema.js';
import { IntexEvalScenarioSchema } from '../scenarioSchema.js';
import {
  EndpointClientError,
  type EndpointConversationResponse,
  type SyntheticRunIdentity,
} from '../endpointClient.js';
import type {
  DeterministicEvaluation,
  ReplyEvaluationInput,
  ReplyTechnicalFacts,
} from '../deterministicEvaluator.js';
import {
  createCleanupPort,
  runEndpointScenario,
  type JudgeRepliesResult,
  type JudgeReplyVerdict,
  type JudgeUsageSummary,
  type RunEndpointScenarioDeps,
} from '../runEndpointScenario.js';
import { createScenario } from './scenarioFixtures.js';

const IDENTITY: SyntheticRunIdentity = {
  runId: 'intex-eval-001-123e4567-e89b-12d3-a456-426614174000',
  userId: 'test-intex-agent-intex-eval-001-123e4567-e89b-12d3-a456-426614174000',
};
const ENDPOINT_RESPONSE = { runId: IDENTITY.runId } as EndpointConversationResponse;

describe('run endpoint scenario lifecycle', () => {
  it('preserves all completed stages for a passing scenario', async () => {
    const deps = depsFor();

    const result = await runEndpointScenario(scenario(), deps);

    expect(result).toMatchObject({
      scenarioId: 'intex-eval-001',
      identity: { status: 'completed', value: IDENTITY },
      primary: {
        kind: 'passed',
        endpoint: { status: 'completed', value: ENDPOINT_RESPONSE },
        deterministic: { status: 'completed', value: { passed: true } },
        judge: { status: 'completed', value: { ok: true } },
      },
      cleanup: { status: 'passed', deleted: 2, total: 2 },
      effectiveKind: 'passed',
      exitCode: 0,
    });
    expect(deps.cleanup.cleanup).toHaveBeenCalledOnce();
    expect(deps.cleanup.cleanup).toHaveBeenCalledWith(IDENTITY);
  });

  it('keeps a deterministic failure behavioral and still judges every exact reply', async () => {
    const evaluation = evaluationFor(2, false);
    const deps = depsFor({ evaluateDeterministically: vi.fn(() => evaluation) });

    const result = await runEndpointScenario(scenario(), deps);

    expect(deps.judgeReplies).toHaveBeenCalledOnce();
    expect(deps.judgeReplies).toHaveBeenCalledWith(evaluation.repliesForJudge);
    expect(result.primary.kind).toBe('behavioral_failure');
    expect(result.effectiveKind).toBe('behavioral_failure');
    expect(result.exitCode).toBe(1);
    expect(deps.cleanup.cleanup).toHaveBeenCalledOnce();
  });

  it('classifies a valid judge rejection as behavioral', async () => {
    const evaluation = evaluationFor(1);
    const judgeResult = successfulJudge(evaluation.repliesForJudge, [false]);
    const deps = depsFor({
      evaluateDeterministically: vi.fn(() => evaluation),
      judgeReplies: vi.fn(async () => judgeResult),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary.kind).toBe('behavioral_failure');
    expect(result.primary.judge).toEqual({ status: 'completed', value: judgeResult });
    expect(result.exitCode).toBe(1);
  });

  it('preserves coherent partial judge evidence while classifying judge failure as infrastructure', async () => {
    const evaluation = evaluationFor(2);
    const judgeResult: JudgeRepliesResult = {
      ok: false,
      code: 'MINIMAX_JUDGE_TIMEOUT',
      failedReply: reference(requiredItem(evaluation.repliesForJudge, 1)),
      completedVerdicts: [verdictFor(requiredItem(evaluation.repliesForJudge, 0), true)],
      usage: usage(1),
    };
    const deps = depsFor({
      evaluateDeterministically: vi.fn(() => evaluation),
      judgeReplies: vi.fn(async () => judgeResult),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary).toMatchObject({
      kind: 'infrastructure_failure',
      judge: { status: 'completed', value: judgeResult },
    });
    expect(result.effectiveKind).toBe('infrastructure_failure');
    expect(result.exitCode).toBe(2);
    expect(deps.cleanup.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    [new EndpointClientError('endpoint_timeout'), 'endpoint_timeout'],
    [new Error('private-endpoint-error-sentinel'), 'endpoint_failed'],
  ] as const)('captures endpoint failure without raw error evidence', async (error, code) => {
    const deps = depsFor({
      endpoint: { runScenario: vi.fn(async () => await Promise.reject(error)) },
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary).toMatchObject({
      kind: 'infrastructure_failure',
      endpoint: { status: 'infrastructure_failure', code },
      deterministic: { status: 'not_run' },
      judge: { status: 'not_run' },
    });
    expect(JSON.stringify(result)).not.toContain('private-endpoint-error-sentinel');
    expect(deps.cleanup.cleanup).toHaveBeenCalledOnce();
  });

  it('captures an evaluator throw and does not call the judge', async () => {
    const deps = depsFor({
      evaluateDeterministically: vi.fn(() => {
        throw new Error('private-evaluator-error-sentinel');
      }),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary).toMatchObject({
      kind: 'infrastructure_failure',
      deterministic: {
        status: 'infrastructure_failure',
        code: 'deterministic_evaluator_failed',
      },
      judge: { status: 'not_run' },
    });
    expect(deps.judgeReplies).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-evaluator-error-sentinel');
  });

  it('captures a judge throw without erasing completed endpoint and deterministic evidence', async () => {
    const deps = depsFor({
      judgeReplies: vi.fn(async () => {
        throw new Error('private-judge-error-sentinel');
      }),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary).toMatchObject({
      kind: 'infrastructure_failure',
      endpoint: { status: 'completed' },
      deterministic: { status: 'completed' },
      judge: { status: 'infrastructure_failure', code: 'judge_failed' },
    });
    expect(JSON.stringify(result)).not.toContain('private-judge-error-sentinel');
  });

  it.each([
    [
      'success reference mismatch',
      (inputs: readonly ReplyEvaluationInput[]): JudgeRepliesResult =>
        successfulJudge(inputs, [true], 9),
    ],
    [
      'success duplicate reference',
      (inputs: readonly ReplyEvaluationInput[]): JudgeRepliesResult => ({
        ...successfulJudge(inputs, [true, true]),
        verdicts: [
          verdictFor(requiredItem(inputs, 0), true),
          verdictFor(requiredItem(inputs, 0), true),
        ],
      }),
    ],
    [
      'failed reference is not next',
      (inputs: readonly ReplyEvaluationInput[]): JudgeRepliesResult => ({
        ok: false,
        code: 'MINIMAX_JUDGE_PROVIDER_FAILED',
        failedReply: reference(requiredItem(inputs, 0)),
        completedVerdicts: [verdictFor(requiredItem(inputs, 0), true)],
        usage: usage(1),
      }),
    ],
  ] as const)('rejects judge protocol mismatch: %s', async (_label, makeResult) => {
    const evaluation = evaluationFor(2);
    const deps = depsFor({
      evaluateDeterministically: vi.fn(() => evaluation),
      judgeReplies: vi.fn(async () => makeResult(evaluation.repliesForJudge)),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result.primary).toMatchObject({
      kind: 'infrastructure_failure',
      judge: { status: 'infrastructure_failure', code: 'judge_protocol_failed' },
    });
  });

  it('does not run endpoint or cleanup when identity creation fails', async () => {
    const deps = depsFor({
      createIdentity: vi.fn(() => {
        throw new Error('private-identity-error-sentinel');
      }),
    });

    const result = await runEndpointScenario(scenario(), deps);

    expect(result).toMatchObject({
      identity: { status: 'infrastructure_failure', code: 'identity_generation_failed' },
      primary: {
        kind: 'infrastructure_failure',
        endpoint: { status: 'not_run' },
        deterministic: { status: 'not_run' },
        judge: { status: 'not_run' },
      },
      cleanup: { status: 'not_required', code: 'identity_not_created' },
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
    });
    expect(deps.endpoint.runScenario).not.toHaveBeenCalled();
    expect(deps.cleanup.cleanup).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-identity-error-sentinel');
  });

  it.each([
    ['pass', {}],
    ['behavior', { evaluateDeterministically: vi.fn(() => evaluationFor(1, false)) }],
    [
      'endpoint failure',
      {
        endpoint: {
          runScenario: vi.fn(
            async () => await Promise.reject(new EndpointClientError('endpoint_timeout'))
          ),
        },
      },
    ],
    [
      'evaluator failure',
      {
        evaluateDeterministically: vi.fn(() => {
          throw new Error('private-evaluator-sentinel');
        }),
      },
    ],
    [
      'judge failure',
      {
        judgeReplies: vi.fn(async () => {
          throw new Error('private-judge-sentinel');
        }),
      },
    ],
  ] as const)('calls cleanup exactly once after %s', async (_label, overrides) => {
    const deps = depsFor(overrides as Partial<RunEndpointScenarioDeps>);

    await runEndpointScenario(scenario(), deps);

    expect(deps.cleanup.cleanup).toHaveBeenCalledOnce();
    expect(deps.cleanup.cleanup).toHaveBeenCalledWith(IDENTITY);
  });

  it.each([
    [
      'pass plus cleanup throw',
      {},
      vi.fn(async () => await Promise.reject(new Error('private-cleanup-error-sentinel'))),
      'passed',
      'cleanup_failed',
    ],
    [
      'behavior plus count mismatch',
      { evaluateDeterministically: vi.fn(() => evaluationFor(1, false)) },
      vi.fn(async () => ({ deleted: 1, total: 2 })),
      'behavioral_failure',
      'cleanup_count_mismatch',
    ],
    [
      'endpoint failure plus cleanup throw',
      {
        endpoint: {
          runScenario: vi.fn(
            async () => await Promise.reject(new EndpointClientError('endpoint_timeout'))
          ),
        },
      },
      vi.fn(async () => await Promise.reject(new Error('private-cleanup-error-sentinel'))),
      'infrastructure_failure',
      'cleanup_failed',
    ],
    [
      'judge failure plus count mismatch',
      {
        judgeReplies: vi.fn(async () => {
          throw new Error('private-judge-error-sentinel');
        }),
      },
      vi.fn(async () => ({ deleted: 0, total: 1 })),
      'infrastructure_failure',
      'cleanup_count_mismatch',
    ],
  ] as const)(
    'keeps primary evidence and gives cleanup infrastructure precedence: %s',
    async (_label, overrides, cleanup, primaryKind, cleanupCode) => {
      const deps = depsFor({
        ...(overrides as Partial<RunEndpointScenarioDeps>),
        cleanup: { cleanup },
      });

      const result = await runEndpointScenario(scenario(), deps);

      expect(result.primary.kind).toBe(primaryKind);
      expect(result.cleanup).toMatchObject({
        status: 'infrastructure_failure',
        code: cleanupCode,
      });
      expect(result.effectiveKind).toBe('infrastructure_failure');
      expect(result.exitCode).toBe(2);
      expect(JSON.stringify(result)).not.toMatch(
        /private-cleanup-error-sentinel|private-judge-error-sentinel/u
      );
    }
  );
});

describe('cleanup production adapter', () => {
  it('passes exact parse argv and parsed object with a no-op writer without output', async () => {
    const parsed = { complete: 'parse-result' };
    const parseArgs = vi.fn(() => parsed);
    const runCleanup = vi.fn(
      async (_input: unknown, output?: { writeLine(line: string): void }) => {
        output?.writeLine('private-cleanup-output-sentinel');
        return { deleted: 3, total: 3 };
      }
    );
    const loader = vi.fn(async () => ({ parseArgs, runCleanup }));
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await createCleanupPort(loader).cleanup(IDENTITY);

    expect(result).toEqual({ deleted: 3, total: 3 });
    expect(loader).toHaveBeenCalledOnce();
    expect(parseArgs).toHaveBeenCalledWith([
      '--user-id',
      IDENTITY.userId,
      '--run-id',
      IDENTITY.runId,
      '--execute',
    ]);
    expect(runCleanup).toHaveBeenCalledOnce();
    expect(runCleanup.mock.calls[0]?.[0]).toBe(parsed);
    expect(runCleanup.mock.calls[0]?.[1]).toEqual({ writeLine: expect.any(Function) });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

function scenario(): IntexEvalScenario {
  return IntexEvalScenarioSchema.parse(createScenario());
}

function depsFor(overrides: Partial<RunEndpointScenarioDeps> = {}): RunEndpointScenarioDeps {
  const evaluation = evaluationFor(1);
  return {
    endpoint: {
      runScenario: vi.fn(async () => ENDPOINT_RESPONSE),
    },
    evaluateDeterministically: vi.fn(() => evaluation),
    judgeReplies: vi.fn(async (inputs) =>
      successfulJudge(
        inputs,
        inputs.map(() => true)
      )
    ),
    cleanup: { cleanup: vi.fn(async () => ({ deleted: 2, total: 2 })) },
    createIdentity: vi.fn(() => IDENTITY),
    ...overrides,
  };
}

function evaluationFor(replyCount: number, passed = true): DeterministicEvaluation {
  return {
    passed,
    failures: passed
      ? []
      : [{ code: 'required_tool_count_mismatch', scenarioId: 'intex-eval-001', turnIndex: 0 }],
    repliesForJudge: Array.from({ length: replyCount }, (_, replyIndex) => ({
      scenarioId: 'intex-eval-001',
      turnIndex: 0,
      replyIndex,
      assistantText: `Sanitized reply ${String(replyIndex)}`,
      semanticCriteria: ['Synthetic criterion.'],
      technicalFacts: emptyFacts(passed),
    })),
  };
}

function emptyFacts(passed: boolean): ReplyTechnicalFacts {
  return {
    turnPassed: passed,
    failureCodes: passed ? [] : ['required_tool_count_mismatch'],
    tools: [],
    transition: { expectedAction: 'started', actualAction: 'started', outcome: 'passed' },
    session: { allowedStatuses: ['waiting_for_user'], outcome: 'passed' },
    timeline: { required: [], forbidden: [], payloadGroups: [] },
    confirmationAction: 'none',
    toolOutcome: null,
  };
}

function successfulJudge(
  inputs: readonly ReplyEvaluationInput[],
  passes: readonly boolean[],
  turnIndexOffset = 0
): Extract<JudgeRepliesResult, { ok: true }> {
  return {
    ok: true,
    verdicts: inputs.map((input, index) =>
      verdictFor({ ...input, turnIndex: input.turnIndex + turnIndexOffset }, passes[index] ?? true)
    ),
    usage: usage(inputs.length),
  };
}

function verdictFor(input: ReplyEvaluationInput, pass: boolean): JudgeReplyVerdict {
  return {
    ...reference(input),
    pass,
    score: pass ? 1 : 0,
    criteria: {
      understoodIntent: pass,
      helpful: pass,
      conciseAndClear: pass,
      professionalTone: true,
      noPassiveAggression: true,
    },
    failures: pass ? [] : ['unhelpful'],
    rationale: 'Synthetic judge rationale.',
  };
}

function reference(
  input: ReplyEvaluationInput
): Pick<JudgeReplyVerdict, 'scenarioId' | 'turnIndex' | 'replyIndex'> {
  return {
    scenarioId: input.scenarioId,
    turnIndex: input.turnIndex,
    replyIndex: input.replyIndex,
  };
}

function usage(logicalCalls: number): JudgeUsageSummary {
  return {
    logicalCalls,
    repairCount: 0,
    inputTokens: logicalCalls * 10,
    outputTokens: logicalCalls * 5,
    totalTokens: logicalCalls * 15,
    providerReportedUsd: 0,
    providerReportedUsdComplete: true,
  };
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Expected fixture item');
  return item;
}
