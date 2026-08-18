import { describe, expect, it } from 'vitest';

import {
  projectMatrixCorpusUsage,
  usdDecimalToNanoUsd,
  type MatrixCorpusOwnedProviderCallV1,
} from '../../../domain/matrixCorpus/usageProjection.js';

const identity = {
  runId: 'run_1',
  scenarioId: 'scenario_001',
  sessionId: 'session_1',
  turnIndex: 0,
  modelId: 'or:deepseek/deepseek-v4-flash',
} as const;

describe('Matrix corpus usage projection', () => {
  it('projects classifier, multi-iteration generation, and repair calls with exact totals', () => {
    const calls = [
      call('intent_classification', 1, 10, 2, '0.0000000014'),
      call('agent_generation', 1, 20, 3, '0.0000000025'),
      call('agent_generation', 2, 30, 4, '0.0000000035'),
      call('response_schema_repair', 1, 40, 5, '0.0000000044'),
    ];

    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: calls.map(({ context }) => ({
          stage: context.stage,
          callOrdinal: context.callOrdinal,
        })),
        calls,
      })
    ).toEqual({
      ok: true,
      records: [
        record('intent_classification', 1, 10, 2, 1),
        record('agent_generation', 1, 20, 3, 3),
        record('agent_generation', 2, 30, 4, 4),
        record('response_schema_repair', 1, 40, 5, 4),
      ],
      totals: { inputTokens: 100, outputTokens: 14, totalTokens: 114, costNanoUsd: 12 },
    });
  });

  it.each([
    {
      name: 'duplicate',
      expectedCalls: [expected('agent_generation', 1)],
      calls: [call('agent_generation', 1), call('agent_generation', 1)],
      code: 'DUPLICATE_CALL',
    },
    {
      name: 'missing',
      expectedCalls: [expected('agent_generation', 1), expected('agent_generation', 2)],
      calls: [call('agent_generation', 1)],
      code: 'CALL_SET_MISMATCH',
    },
    {
      name: 'non-contiguous ordinal',
      expectedCalls: [expected('agent_generation', 2)],
      calls: [call('agent_generation', 2)],
      code: 'NON_CONTIGUOUS_ORDINAL',
    },
    {
      name: 'wrong model',
      expectedCalls: [expected('agent_generation', 1)],
      calls: [{ ...call('agent_generation', 1), modelId: 'or:google/gemini-3.6-flash' }],
      code: 'WRONG_MODEL',
    },
    {
      name: 'foreign run',
      expectedCalls: [expected('agent_generation', 1)],
      calls: [
        {
          ...call('agent_generation', 1),
          context: { ...call('agent_generation', 1).context, runId: 'global_usage_other_run' },
        },
      ],
      code: 'CORRELATION_MISMATCH',
    },
    {
      name: 'missing provider cost',
      expectedCalls: [expected('agent_generation', 1)],
      calls: [{ ...call('agent_generation', 1), providerReportedUsd: undefined }],
      code: 'MISSING_PROVIDER_COST',
    },
    {
      name: 'token mismatch',
      expectedCalls: [expected('agent_generation', 1)],
      calls: [{ ...call('agent_generation', 1), totalTokens: 999 }],
      code: 'INVALID_USAGE',
    },
  ])('rejects $name usage', ({ expectedCalls, calls, code }) => {
    expect(
      projectMatrixCorpusUsage({ identity, phase: 'natural', expectedCalls, calls })
    ).toEqual({ ok: false, code });
  });

  it('accepts confirmations only when they have exactly zero provider calls', () => {
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'confirmation',
        expectedCalls: [],
        calls: [],
      })
    ).toEqual({
      ok: true,
      records: [],
      totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 },
    });
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'confirmation',
        expectedCalls: [],
        calls: [call('agent_generation', 1)],
      })
    ).toEqual({ ok: false, code: 'CONFIRMATION_USAGE_FORBIDDEN' });
  });

  it('rejects duplicate expected calls and either bounded-call overflow', () => {
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1), expected('agent_generation', 1)],
        calls: [call('agent_generation', 1)],
      })
    ).toEqual({ ok: false, code: 'DUPLICATE_CALL' });
    const excessiveCalls = Array.from({ length: 61 }, (_, index) =>
      call('agent_generation', index + 1)
    );
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [],
        calls: excessiveCalls,
      })
    ).toEqual({ ok: false, code: 'TOO_MANY_CALLS' });
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: excessiveCalls.map(({ context }) => expected(context.stage, context.callOrdinal)),
        calls: [],
      })
    ).toEqual({ ok: false, code: 'TOO_MANY_CALLS' });
  });

  it('rejects equal-sized but different call sets', () => {
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1)],
        calls: [call('intent_classification', 1)],
      })
    ).toEqual({ ok: false, code: 'CALL_SET_MISMATCH' });
  });

  it.each([
    ['scenario', { scenarioId: 'other' }],
    ['session', { sessionId: 'other' }],
    ['turn', { turnIndex: 1 }],
  ] as const)('rejects foreign %s correlation', (_name, contextOverrides) => {
    const owned = call('agent_generation', 1);
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1)],
        calls: [{ ...owned, context: { ...owned.context, ...contextOverrides } }],
      })
    ).toEqual({ ok: false, code: 'CORRELATION_MISMATCH' });
  });

  it.each([
    ['input', { inputTokens: -1 }],
    ['fractional input', { inputTokens: 1.5 }],
    ['output', { outputTokens: -1 }],
    ['unsafe total', { totalTokens: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)('rejects invalid %s token usage', (_name, overrides) => {
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1)],
        calls: [{ ...call('agent_generation', 1), ...overrides }],
      })
    ).toEqual({ ok: false, code: 'INVALID_USAGE' });
  });

  it('rejects provider decimal conversion and aggregate integer overflow', () => {
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1)],
        calls: [call('agent_generation', 1, 1, 1, 'invalid')],
      })
    ).toEqual({ ok: false, code: 'INVALID_USD_DECIMAL' });

    const first = call('agent_generation', 1, 1, 1, '9007199.254740991');
    const second = call('agent_generation', 2, 1, 1, '9007199.254740991');
    expect(
      projectMatrixCorpusUsage({
        identity,
        phase: 'natural',
        expectedCalls: [expected('agent_generation', 1), expected('agent_generation', 2)],
        calls: [first, second],
      })
    ).toEqual({ ok: false, code: 'INVALID_USAGE' });
  });
});

describe('usdDecimalToNanoUsd', () => {
  it.each([
    ['0', 0],
    ['0.0000000004', 0],
    ['0.0000000005', 1],
    ['1.2345678904', 1_234_567_890],
    ['1.2345678905', 1_234_567_891],
    ['2.5e-9', 3],
  ])('rounds %s half-up once', (value, expectedNanoUsd) => {
    expect(usdDecimalToNanoUsd(value)).toEqual({ ok: true, value: expectedNanoUsd });
  });

  it.each(['-1', 'NaN', 'Infinity', '', '1e100', 'not-a-number'])(
    'rejects invalid or unsafe decimal %s',
    (value) => {
      expect(usdDecimalToNanoUsd(value)).toEqual({ ok: false, code: 'INVALID_USD_DECIMAL' });
    }
  );

  it.each([
    [1, 1_000_000_000],
    ['1.', 1_000_000_000],
    ['001', 1_000_000_000],
    ['1e2', 100_000_000_000],
  ] as const)('accepts canonical numeric shape %s', (value, expectedNanoUsd) => {
    expect(usdDecimalToNanoUsd(value)).toEqual({ ok: true, value: expectedNanoUsd });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1e-101', '9007199.254740992'])(
    'rejects unsafe numeric value %s',
    (value) => {
      expect(usdDecimalToNanoUsd(value)).toEqual({ ok: false, code: 'INVALID_USD_DECIMAL' });
    }
  );
});

function call(
  stage: MatrixCorpusOwnedProviderCallV1['context']['stage'],
  callOrdinal: number,
  inputTokens = 1,
  outputTokens = 1,
  providerReportedUsd: string | number | undefined = '0.000000001'
): MatrixCorpusOwnedProviderCallV1 {
  return {
    context: {
      version: 1,
      runId: identity.runId,
      scenarioId: identity.scenarioId,
      sessionId: identity.sessionId,
      turnIndex: identity.turnIndex,
      stage,
      callOrdinal,
    },
    modelId: identity.modelId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    providerReportedUsd,
  };
}

function expected(
  stage: MatrixCorpusOwnedProviderCallV1['context']['stage'],
  callOrdinal: number
): Readonly<{ stage: MatrixCorpusOwnedProviderCallV1['context']['stage']; callOrdinal: number }> {
  return { stage, callOrdinal };
}

function record(
  stage: MatrixCorpusOwnedProviderCallV1['context']['stage'],
  callOrdinal: number,
  inputTokens: number,
  outputTokens: number,
  costNanoUsd: number
): Readonly<Record<string, unknown>> {
  return {
    turnIndex: 0,
    stage,
    callOrdinal,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costNanoUsd,
  };
}
