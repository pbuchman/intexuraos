import type {
  MatrixCorpusLlmCallContextV1,
  MatrixCorpusLlmStageV1,
} from '@intexuraos/llm-contract';

export type { MatrixCorpusLlmCallContextV1, MatrixCorpusLlmStageV1 };

export interface MatrixCorpusOwnedProviderCallV1 {
  context: MatrixCorpusLlmCallContextV1;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerReportedUsd: string | number | undefined;
}

export interface SafeAgentUsageV1 {
  turnIndex: number;
  stage: MatrixCorpusLlmStageV1;
  callOrdinal: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costNanoUsd: number;
}

export interface SafeAgentUsageTotalsV1 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costNanoUsd: number;
}

export type MatrixCorpusUsageProjectionFailureCode =
  | 'CONFIRMATION_USAGE_FORBIDDEN'
  | 'TOO_MANY_CALLS'
  | 'DUPLICATE_CALL'
  | 'CALL_SET_MISMATCH'
  | 'NON_CONTIGUOUS_ORDINAL'
  | 'CORRELATION_MISMATCH'
  | 'WRONG_MODEL'
  | 'MISSING_PROVIDER_COST'
  | 'INVALID_USAGE'
  | 'INVALID_USD_DECIMAL';

export type MatrixCorpusUsageProjectionResult =
  | Readonly<{
      ok: true;
      records: SafeAgentUsageV1[];
      totals: SafeAgentUsageTotalsV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusUsageProjectionFailureCode }>;

export function projectMatrixCorpusUsage(input: Readonly<{
  identity: Readonly<{
    runId: string;
    scenarioId: string;
    sessionId: string;
    turnIndex: number;
    modelId: string;
  }>;
  phase: 'natural' | 'confirmation';
  expectedCalls: readonly Readonly<{
    stage: MatrixCorpusLlmStageV1;
    callOrdinal: number;
  }>[];
  calls: readonly MatrixCorpusOwnedProviderCallV1[];
}>): MatrixCorpusUsageProjectionResult {
  const zeroTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 };
  if (input.phase === 'confirmation') {
    return input.expectedCalls.length === 0 && input.calls.length === 0
      ? { ok: true, records: [], totals: zeroTotals }
      : failure('CONFIRMATION_USAGE_FORBIDDEN');
  }
  if (input.calls.length > 60 || input.expectedCalls.length > 60)
    return failure('TOO_MANY_CALLS');

  const actualKeys = input.calls.map((call) => usageKey(call.context));
  if (new Set(actualKeys).size !== actualKeys.length) return failure('DUPLICATE_CALL');
  const expectedKeys = input.expectedCalls.map(usageKey);
  if (new Set(expectedKeys).size !== expectedKeys.length) return failure('DUPLICATE_CALL');
  if (!sameKeySet(actualKeys, expectedKeys)) return failure('CALL_SET_MISMATCH');

  for (const stage of STAGE_ORDER) {
    const ordinals = input.calls
      .filter((call) => call.context.stage === stage)
      .map((call) => call.context.callOrdinal)
      .sort((left, right) => left - right);
    if (ordinals.some((ordinal, index) => ordinal !== index + 1))
      return failure('NON_CONTIGUOUS_ORDINAL');
  }

  const records: SafeAgentUsageV1[] = [];
  for (const call of input.calls) {
    if (
      call.context.runId !== input.identity.runId ||
      call.context.scenarioId !== input.identity.scenarioId ||
      call.context.sessionId !== input.identity.sessionId ||
      call.context.turnIndex !== input.identity.turnIndex
    )
      return failure('CORRELATION_MISMATCH');
    if (call.modelId !== input.identity.modelId) return failure('WRONG_MODEL');
    if (call.providerReportedUsd === undefined) return failure('MISSING_PROVIDER_COST');
    if (
      !isTokenCount(call.inputTokens) ||
      !isTokenCount(call.outputTokens) ||
      !isTokenCount(call.totalTokens) ||
      call.totalTokens !== call.inputTokens + call.outputTokens
    )
      return failure('INVALID_USAGE');
    const converted = usdDecimalToNanoUsd(call.providerReportedUsd);
    if (!converted.ok) return failure(converted.code);
    records.push({
      turnIndex: call.context.turnIndex,
      stage: call.context.stage,
      callOrdinal: call.context.callOrdinal,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      totalTokens: call.totalTokens,
      costNanoUsd: converted.value,
    });
  }

  records.sort(
    (left, right) =>
      STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage) ||
      left.callOrdinal - right.callOrdinal
  );
  const totals = records.reduce<SafeAgentUsageTotalsV1>(
    (sum, record) => ({
      inputTokens: safeAdd(sum.inputTokens, record.inputTokens),
      outputTokens: safeAdd(sum.outputTokens, record.outputTokens),
      totalTokens: safeAdd(sum.totalTokens, record.totalTokens),
      costNanoUsd: safeAdd(sum.costNanoUsd, record.costNanoUsd),
    }),
    zeroTotals
  );
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value)))
    return failure('INVALID_USAGE');
  return { ok: true, records, totals };
}

/** Converts a decimal USD value into integer nano-USD, rounding half-up exactly once. */
export function usdDecimalToNanoUsd(
  input: string | number
): Readonly<{ ok: true; value: number }> | Readonly<{ ok: false; code: 'INVALID_USD_DECIMAL' }> {
  const raw = typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : input;
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(raw);
  if (match === null) return { ok: false, code: 'INVALID_USD_DECIMAL' };
  /* v8 ignore start -- regex: successful regex match guarantees capture group 1; nullish fallback is required by indexed access typing @preserve */
  const integer = match[1] ?? '';
  /* v8 ignore stop @preserve */
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    return { ok: false, code: 'INVALID_USD_DECIMAL' };
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, '');
  let nanoUsd = BigInt(digits);
  const nanoExponent = exponent - fraction.length + 9;
  if (nanoExponent >= 0) {
    nanoUsd *= 10n ** BigInt(nanoExponent);
  } else {
    const divisor = 10n ** BigInt(-nanoExponent);
    const quotient = nanoUsd / divisor;
    const remainder = nanoUsd % divisor;
    nanoUsd = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }
  if (nanoUsd > BigInt(Number.MAX_SAFE_INTEGER))
    return { ok: false, code: 'INVALID_USD_DECIMAL' };
  return { ok: true, value: Number(nanoUsd) };
}

const STAGE_ORDER: readonly MatrixCorpusLlmStageV1[] = [
  'intent_classification',
  'agent_generation',
  'calendar_update_planning',
  'response_schema_repair',
];

function usageKey(input: Readonly<{
  stage: MatrixCorpusLlmStageV1;
  callOrdinal: number;
}>): string {
  return `${input.stage}:${String(input.callOrdinal)}`;
}

function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((key) => expected.has(key));
}

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeAdd(left: number, right: number): number {
  return left + right;
}

function failure(code: MatrixCorpusUsageProjectionFailureCode): MatrixCorpusUsageProjectionResult {
  return { ok: false, code };
}
