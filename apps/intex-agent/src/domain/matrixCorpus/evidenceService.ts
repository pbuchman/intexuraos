import { createHash } from 'node:crypto';

import {
  intexAgentToolNameV1Schema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  type IntexAgentToolNameV1,
} from '@intexuraos/http-contracts';

import type {
  MatrixCorpusSessionIdentity,
  MatrixCorpusSessionRepository,
} from '../ports/sessionRepository.js';
import type {
  IntexAgentSessionEvent,
  IntexAgentSessionStartReason,
  IntexAgentSessionStatus,
} from '../sessions/types.js';
import type { SafeToolFactNameV1, SafeToolFactV1 } from './safeEvidence.js';
import type { SafeAgentUsageTotalsV1, SafeAgentUsageV1 } from './usageProjection.js';

export interface SafeToolEvidenceV1 {
  event: 'selected' | 'mock_completed' | 'mock_failed' | 'unexpected_known_no_execution';
  toolName: IntexAgentToolNameV1;
  turnIndex: number;
  ordinal: number;
  facts: SafeToolFactV1[];
}

export interface MatrixCorpusSafeEvidenceV1 {
  version: 1;
  eventRevision: number;
  toolEvidence: SafeToolEvidenceV1[];
  agentUsage: SafeAgentUsageV1[];
  agentUsageTotals: SafeAgentUsageTotalsV1;
  sessionProof: {
    status: IntexAgentSessionStatus;
    startReason: IntexAgentSessionStartReason;
    userMessageCount: number;
    sessionStartedCount: number;
    supersededSessionCount: number;
  };
  turnTerminals: SafeTurnTerminalV1[];
  strictMockProof: {
    version: 1;
    status: 'passed';
    executionMode: 'strict_mock_tools';
    mockProfileDigest: string;
    productionExecutorResolutions: 0;
    productionExecutorAdmissions: 0;
  };
}

interface SafeTurnUsageSummaryV1 extends SafeAgentUsageTotalsV1 {
  turnIndex: number;
  status: 'complete' | 'failed';
  expectedCallCount: number;
  reportedCallCount: number;
}

interface SafeExecutionBoundaryV1 {
  turnIndex: number;
  resolution: 'strict_mock_executor_resolved' | 'no_executor_required';
}

export type SafeTurnTerminalV1 =
  | Readonly<{
      status: 'completed';
      turnIndex: number;
      replyCount: number;
      replyDigests: string[];
      terminalMarkerDigest: string;
      recordedAt: string;
    }>
  | Readonly<{
      status: 'failed';
      turnIndex: number;
      failureCode:
        | 'AMBIGUOUS_EXTERNAL_EFFECT'
        | 'REPLY_PUBLICATION_REJECTED'
        | 'EXECUTION_REJECTED';
      terminalMarkerDigest: string;
      recordedAt: string;
    }>;

type SafeTurnFailureCode = Extract<
  SafeTurnTerminalV1,
  Readonly<{ status: 'failed' }>
>['failureCode'];

export type MatrixCorpusEvidenceResult =
  | Readonly<{ ok: true; evidence: MatrixCorpusSafeEvidenceV1 }>
  | Readonly<{ ok: false; code: 'NOT_FOUND' | 'REVISION_MISMATCH' | 'CORRUPT_EVIDENCE' }>;

export interface MatrixCorpusEvidenceService {
  getExact(
    input: Readonly<{
      identity: MatrixCorpusSessionIdentity;
      expectedEventRevision: number;
    }>
  ): Promise<MatrixCorpusEvidenceResult>;
}

export function createMatrixCorpusEvidenceService(
  deps: Readonly<{
    sessionRepository: Pick<
      MatrixCorpusSessionRepository,
      'getMatrixCorpusSessionExact' | 'listMatrixCorpusEventsExact'
    >;
  }>
): MatrixCorpusEvidenceService {
  return {
    async getExact(input): Promise<MatrixCorpusEvidenceResult> {
      if (!isSafeIndex(input.expectedEventRevision)) return failure('REVISION_MISMATCH');
      const [sessionResult, eventsResult] = await Promise.all([
        deps.sessionRepository.getMatrixCorpusSessionExact(input.identity),
        deps.sessionRepository.listMatrixCorpusEventsExact(input.identity),
      ]);
      if (!sessionResult.ok || !eventsResult.ok) return failure('NOT_FOUND');
      if (sessionResult.session.lastEventSequence !== input.expectedEventRevision)
        return failure('REVISION_MISMATCH');
      const events = [...eventsResult.events].sort(
        (left, right) =>
          (left.eventSequence ?? Number.MAX_SAFE_INTEGER) -
          (right.eventSequence ?? Number.MAX_SAFE_INTEGER)
      );
      if (
        events.length !== input.expectedEventRevision ||
        events.some((event, index) => event.eventSequence !== index + 1)
      )
        return failure('CORRUPT_EVIDENCE');
      const lifecycleProof = buildSessionLifecycleProof(
        events,
        sessionResult.session.startReason
      );
      if (lifecycleProof === null)
        return failure('CORRUPT_EVIDENCE');

      const toolEvidence: SafeToolEvidenceV1[] = [];
      const agentUsage: SafeAgentUsageV1[] = [];
      const usageSummaries: SafeTurnUsageSummaryV1[] = [];
      const turnTerminals: SafeTurnTerminalV1[] = [];
      const executionBoundaries: SafeExecutionBoundaryV1[] = [];
      for (const event of events) {
        if (isToolEvidenceEvent(event)) {
          const mapped = mapToolEvidence(event);
          if (mapped === null) return failure('CORRUPT_EVIDENCE');
          toolEvidence.push(mapped);
        } else if (event.type === 'llm_call_usage') {
          const mapped = mapUsage(event.payload);
          if (mapped === null) return failure('CORRUPT_EVIDENCE');
          agentUsage.push(mapped);
        } else if (event.type === 'llm_usage_summary') {
          const mapped = mapUsageSummary(event.payload);
          if (mapped === null) return failure('CORRUPT_EVIDENCE');
          usageSummaries.push(mapped);
        } else if (event.type === 'matrix_corpus_execution_boundary') {
          const mapped = mapExecutionBoundary(
            event.payload,
            sessionResult.session.matrixCorpusProfile.mockProfileDigest
          );
          if (mapped === null) return failure('CORRUPT_EVIDENCE');
          executionBoundaries.push(mapped);
        } else if (
          event.type === 'turn_processing_completed' ||
          event.type === 'turn_processing_failed'
        ) {
          const mapped = mapTurnTerminal(event);
          if (mapped === null) return failure('CORRUPT_EVIDENCE');
          turnTerminals.push(mapped);
        }
      }
      if (
        toolEvidence.length > 100 ||
        agentUsage.length > 60 ||
        usageSummaries.length > 20 ||
        turnTerminals.length > 20 ||
        executionBoundaries.length > 20
      )
        return failure('CORRUPT_EVIDENCE');
      const toolKeys = toolEvidence.map(
        (item) => `${item.event}:${String(item.turnIndex)}:${item.toolName}:${String(item.ordinal)}`
      );
      const usageKeys = agentUsage.map(
        (item) => `${item.stage}:${String(item.callOrdinal)}:${String(item.turnIndex)}`
      );
      const terminalKeys = turnTerminals.map((item) => item.turnIndex);
      const summaryKeys = usageSummaries.map((item) => item.turnIndex);
      const boundaryKeys = executionBoundaries.map((item) => item.turnIndex);
      if (
        new Set(toolKeys).size !== toolKeys.length ||
        new Set(usageKeys).size !== usageKeys.length ||
        new Set(terminalKeys).size !== terminalKeys.length ||
        new Set(summaryKeys).size !== summaryKeys.length ||
        new Set(boundaryKeys).size !== boundaryKeys.length ||
        !hasContiguousUsageOrdinals(agentUsage)
      )
        return failure('CORRUPT_EVIDENCE');
      if (!usageSummariesMatchCalls(usageSummaries, agentUsage, turnTerminals))
        return failure('CORRUPT_EVIDENCE');
      if (!executionBoundariesMatchTerminals(executionBoundaries, turnTerminals))
        return failure('CORRUPT_EVIDENCE');
      if (
        sessionResult.session.startReason === 'user_requested_new_session' &&
        events.every((event) => event.type !== 'user_message') &&
        (executionBoundaries.length !== 1 ||
          executionBoundaries[0]?.turnIndex !== 0 ||
          executionBoundaries[0].resolution !== 'no_executor_required' ||
          toolEvidence.length !== 0 ||
          agentUsage.length !== 0)
      )
        return failure('CORRUPT_EVIDENCE');
      const agentUsageTotals = sumAgentUsage(agentUsage);
      if (agentUsageTotals === null) return failure('CORRUPT_EVIDENCE');
      const userMessageCount = events.filter((event) => event.type === 'user_message').length;
      if (userMessageCount > 20) return failure('CORRUPT_EVIDENCE');
      return {
        ok: true,
        evidence: {
          version: 1,
          eventRevision: input.expectedEventRevision,
          toolEvidence,
          agentUsage,
          agentUsageTotals,
          sessionProof: {
            status: sessionResult.session.status,
            startReason: sessionResult.session.startReason,
            userMessageCount,
            ...lifecycleProof,
          },
          turnTerminals,
          strictMockProof: {
            version: 1,
            status: 'passed',
            executionMode: sessionResult.session.matrixCorpusProfile.executionMode,
            mockProfileDigest: sessionResult.session.matrixCorpusProfile.mockProfileDigest,
            productionExecutorResolutions: 0,
            productionExecutorAdmissions: 0,
          },
        },
      };
    },
  };
}

function buildSessionLifecycleProof(
  events: readonly IntexAgentSessionEvent[],
  startReason: IntexAgentSessionStartReason
): Readonly<{
  sessionStartedCount: number;
  supersededSessionCount: number;
}> | null {
  const starts = events.filter((event) => event.type === 'session_started');
  const closed = events.filter((event) => event.type === 'session_closed');
  if (starts.length === 0)
    return startReason === 'user_requested_new_session' || closed.length > 0
      ? null
      : { sessionStartedCount: 0, supersededSessionCount: 0 };
  if (
    starts.length !== closed.length + 1 ||
    starts[0]?.eventSequence !== 1 ||
    starts.some(
      (event) =>
        !hasExactKeys(event.payload, ['reason', 'explicit']) ||
        !SESSION_START_REASONS.has(event.payload['reason']) ||
        event.payload['explicit'] !==
          (event.payload['reason'] === 'user_requested_new_session')
    ) ||
    closed.some(
      (event) =>
        !hasExactKeys(event.payload, ['reason', 'status']) ||
        event.payload['reason'] !== 'superseded_by_user' ||
        event.payload['status'] !== 'superseded'
    )
  )
    return null;
  for (let index = 0; index < closed.length; index += 1) {
    const before = starts[index]?.eventSequence;
    const closing = closed[index]?.eventSequence;
    const after = starts[index + 1]?.eventSequence;
    if (
      before === undefined ||
      closing === undefined ||
      after === undefined ||
      closing <= before ||
      after !== closing + 1 ||
      starts[index + 1]?.payload['reason'] !== 'user_requested_new_session'
    )
      return null;
  }
  if (starts.at(-1)?.payload['reason'] !== startReason) return null;
  return {
    sessionStartedCount: starts.length,
    supersededSessionCount: closed.length,
  };
}

const SESSION_START_REASONS = new Set<unknown>([
  'no_active_session',
  'previous_completed',
  'previous_expired',
  'previous_superseded',
  'user_requested_new_session',
]);

function mapExecutionBoundary(
  payload: Readonly<Record<string, unknown>>,
  expectedMockProfileDigest: string
): SafeExecutionBoundaryV1 | null {
  if (
    !hasExactKeys(payload, [
      'version',
      'turnIndex',
      'resolution',
      'executionMode',
      'mockProfileDigest',
      'productionExecutorResolutions',
      'productionExecutorAdmissions',
    ]) ||
    payload['version'] !== 1 ||
    !isBoundedIndex(payload['turnIndex'], 19) ||
    (payload['resolution'] !== 'strict_mock_executor_resolved' &&
      payload['resolution'] !== 'no_executor_required') ||
    payload['executionMode'] !== 'strict_mock_tools' ||
    payload['mockProfileDigest'] !== expectedMockProfileDigest ||
    typeof payload['mockProfileDigest'] !== 'string' ||
    !SHA_256_PATTERN.test(payload['mockProfileDigest']) ||
    payload['productionExecutorResolutions'] !== 0 ||
    payload['productionExecutorAdmissions'] !== 0
  )
    return null;
  return { turnIndex: payload['turnIndex'], resolution: payload['resolution'] };
}

function executionBoundariesMatchTerminals(
  boundaries: readonly SafeExecutionBoundaryV1[],
  terminals: readonly SafeTurnTerminalV1[]
): boolean {
  return (
    boundaries.length === terminals.length &&
    terminals.every((terminal) =>
      boundaries.some((boundary) => boundary.turnIndex === terminal.turnIndex)
    )
  );
}

function mapUsageSummary(
  payload: Readonly<Record<string, unknown>>
): SafeTurnUsageSummaryV1 | null {
  if (
    !hasExactKeys(payload, [
      'turnIndex',
      'status',
      'expectedCallCount',
      'reportedCallCount',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'costNanoUsd',
    ]) ||
    (payload['status'] !== 'complete' && payload['status'] !== 'failed') ||
    !isBoundedIndex(payload['turnIndex'], 19) ||
    !isBoundedIndex(payload['expectedCallCount'], 60) ||
    !isBoundedIndex(payload['reportedCallCount'], 60) ||
    (payload['status'] === 'complete' &&
      payload['expectedCallCount'] !== payload['reportedCallCount']) ||
    (payload['status'] === 'failed' &&
      payload['reportedCallCount'] > payload['expectedCallCount']) ||
    !isSafeIndex(payload['inputTokens']) ||
    !isSafeIndex(payload['outputTokens']) ||
    !isSafeIndex(payload['totalTokens']) ||
    payload['totalTokens'] !== payload['inputTokens'] + payload['outputTokens'] ||
    !isSafeIndex(payload['costNanoUsd'])
  )
    return null;
  return {
    turnIndex: payload['turnIndex'],
    status: payload['status'],
    expectedCallCount: payload['expectedCallCount'],
    reportedCallCount: payload['reportedCallCount'],
    inputTokens: payload['inputTokens'],
    outputTokens: payload['outputTokens'],
    totalTokens: payload['totalTokens'],
    costNanoUsd: payload['costNanoUsd'],
  };
}

function usageSummariesMatchCalls(
  summaries: readonly SafeTurnUsageSummaryV1[],
  calls: readonly SafeAgentUsageV1[],
  terminals: readonly SafeTurnTerminalV1[]
): boolean {
  if (
    summaries.length !== terminals.length ||
    calls.some(
      (call) => !summaries.some((summary) => summary.turnIndex === call.turnIndex)
    )
  )
    return false;
  for (const terminal of terminals) {
    const summary = summaries.find((candidate) => candidate.turnIndex === terminal.turnIndex);
    if (summary === undefined) return false;
    if (terminal.status === 'completed' && summary.status !== 'complete') return false;
  }
  return summaries.every((summary) => {
    /* v8 ignore start -- schema: equal unique summary and terminal sets are guaranteed by the preceding cardinality, duplicate, and terminal-lookup guards @preserve */
    if (!terminals.some((terminal) => terminal.turnIndex === summary.turnIndex)) return false;
    /* v8 ignore stop @preserve */
    const owned = calls.filter((call) => call.turnIndex === summary.turnIndex);
    const totals = owned.reduce<SafeAgentUsageTotalsV1>(
      (sum, call) => ({
        inputTokens: sum.inputTokens + call.inputTokens,
        outputTokens: sum.outputTokens + call.outputTokens,
        totalTokens: sum.totalTokens + call.totalTokens,
        costNanoUsd: sum.costNanoUsd + call.costNanoUsd,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 }
    );
    return (
      summary.reportedCallCount === owned.length &&
      totals.inputTokens === summary.inputTokens &&
      totals.outputTokens === summary.outputTokens &&
      totals.totalTokens === summary.totalTokens &&
      totals.costNanoUsd === summary.costNanoUsd &&
      Object.values(totals).every(Number.isSafeInteger)
    );
  });
}

function sumAgentUsage(calls: readonly SafeAgentUsageV1[]): SafeAgentUsageTotalsV1 | null {
  const totals = calls.reduce<SafeAgentUsageTotalsV1>(
    (sum, call) => ({
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      totalTokens: sum.totalTokens + call.totalTokens,
      costNanoUsd: sum.costNanoUsd + call.costNanoUsd,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 }
  );
  return Object.values(totals).every(Number.isSafeInteger) ? totals : null;
}

function mapTurnTerminal(event: IntexAgentSessionEvent): SafeTurnTerminalV1 | null {
  const payload = event.payload;
  if (
    !isBoundedIndex(payload['turnIndex'], 19) ||
    !matrixCorpusSafeIdSchema.safeParse(event.id).success ||
    !matrixCorpusRfc3339TimestampSchema.safeParse(event.createdAt).success
  )
    return null;
  const terminalMarkerDigest = digestTurnTerminalMarker(event);
  if (event.type === 'turn_processing_completed') {
    if (
      !hasExactKeys(payload, ['turnIndex', 'status', 'replyCount', 'replyDigests']) ||
      payload['status'] !== 'completed' ||
      !isBoundedIndex(payload['replyCount'], 5, 1) ||
      !isDigestArray(payload['replyDigests'], payload['replyCount'])
    )
      return null;
    return {
      status: 'completed',
      turnIndex: payload['turnIndex'],
      replyCount: payload['replyCount'],
      replyDigests: [...payload['replyDigests']],
      terminalMarkerDigest,
      recordedAt: event.createdAt,
    };
  }
  if (
    !hasExactKeys(payload, ['turnIndex', 'status', 'failureCode']) ||
    payload['status'] !== 'failed' ||
    !TERMINAL_FAILURE_CODES.has(payload['failureCode'] as SafeTurnFailureCode)
  )
    return null;
  return {
    status: 'failed',
    turnIndex: payload['turnIndex'],
    failureCode: payload['failureCode'] as SafeTurnFailureCode,
    terminalMarkerDigest,
    recordedAt: event.createdAt,
  };
}

function digestTurnTerminalMarker(event: IntexAgentSessionEvent): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        eventId: event.id,
        type: event.type,
        payload: event.payload,
        recordedAt: event.createdAt,
      }),
      'utf8'
    )
    .digest('hex');
}

function isDigestArray(value: unknown, expectedLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((digest) => typeof digest === 'string' && SHA_256_PATTERN.test(digest)) &&
    new Set(value).size === value.length
  );
}

function isToolEvidenceEvent(event: IntexAgentSessionEvent): boolean {
  return (
    event.type === 'tool_call_started' ||
    event.type === 'tool_call_completed' ||
    event.type === 'tool_call_failed'
  );
}

function mapToolEvidence(event: IntexAgentSessionEvent): SafeToolEvidenceV1 | null {
  const payload = event.payload;
  const common = readCommonToolFields(payload);
  if (common === null) return null;
  if (event.type === 'tool_call_started') {
    if (
      !hasExactKeys(payload, [
        'runId',
        'scenarioId',
        'turnIndex',
        'toolName',
        'ordinal',
        'status',
        'facts',
      ]) ||
      payload['status'] !== 'started'
    )
      return null;
    return { event: 'selected', ...common };
  }
  if (event.type === 'tool_call_completed') {
    if (
      !hasExactKeys(payload, ['toolName', 'turnIndex', 'ordinal', 'status', 'facts']) ||
      payload['status'] !== 'mock_completed'
    )
      return null;
    return { event: 'mock_completed', ...common };
  }
  if (
    !hasExactKeys(payload, [
      'toolName',
      'turnIndex',
      'ordinal',
      'status',
      'failureCode',
      'facts',
    ]) ||
    (payload['status'] !== 'mock_failed' &&
      payload['status'] !== 'unexpected_known_no_execution') ||
    typeof payload['failureCode'] !== 'string' ||
    payload['failureCode'].length === 0 ||
    payload['failureCode'].length > 64
  )
    return null;
  return { event: payload['status'], ...common };
}

function readCommonToolFields(
  payload: Readonly<Record<string, unknown>>
): Omit<SafeToolEvidenceV1, 'event'> | null {
  const parsedTool = intexAgentToolNameV1Schema.safeParse(payload['toolName']);
  const facts = readFacts(payload['facts']);
  return parsedTool.success &&
    isBoundedIndex(payload['turnIndex'], 19) &&
    isBoundedIndex(payload['ordinal'], 20, 1) &&
    facts !== null
    ? {
        toolName: parsedTool.data,
        turnIndex: payload['turnIndex'],
        ordinal: payload['ordinal'],
        facts,
      }
    : null;
}

function readFacts(value: unknown): SafeToolFactV1[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const facts: SafeToolFactV1[] = [];
  for (const candidate of value) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !hasExactKeys(candidate as Record<string, unknown>, ['name', 'value'])
    )
      return null;
    const record = candidate as Record<string, unknown>;
    const name = record['name'];
    const factValue = record['value'];
    if (
      typeof name !== 'string' ||
      !SAFE_FACT_NAMES.has(name as SafeToolFactNameV1) ||
      !isSafeFactValue(factValue)
    )
      return null;
    facts.push({ name: name as SafeToolFactNameV1, value: factValue });
  }
  return facts;
}

function mapUsage(payload: Readonly<Record<string, unknown>>): SafeAgentUsageV1 | null {
  if (
    !hasExactKeys(payload, [
      'turnIndex',
      'stage',
      'callOrdinal',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'costNanoUsd',
    ]) ||
    !isBoundedIndex(payload['turnIndex'], 19) ||
    !USAGE_STAGES.has(payload['stage'] as SafeAgentUsageV1['stage']) ||
    !isBoundedIndex(payload['callOrdinal'], 60, 1) ||
    !isSafeIndex(payload['inputTokens']) ||
    !isSafeIndex(payload['outputTokens']) ||
    !isSafeIndex(payload['totalTokens']) ||
    payload['totalTokens'] !== payload['inputTokens'] + payload['outputTokens'] ||
    !isSafeIndex(payload['costNanoUsd'])
  )
    return null;
  return {
    turnIndex: payload['turnIndex'],
    stage: payload['stage'] as SafeAgentUsageV1['stage'],
    callOrdinal: payload['callOrdinal'],
    inputTokens: payload['inputTokens'],
    outputTokens: payload['outputTokens'],
    totalTokens: payload['totalTokens'],
    costNanoUsd: payload['costNanoUsd'],
  };
}

function hasContiguousUsageOrdinals(records: readonly SafeAgentUsageV1[]): boolean {
  for (const turnIndex of new Set(records.map((record) => record.turnIndex))) {
    for (const stage of USAGE_STAGES) {
      const ordinals = records
        .filter((record) => record.turnIndex === turnIndex && record.stage === stage)
        .map((record) => record.callOrdinal)
        .sort((left, right) => left - right);
      if (ordinals.some((ordinal, index) => ordinal !== index + 1)) return false;
    }
  }
  return true;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isBoundedIndex(value: unknown, max: number, min = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isSafeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeFactValue(value: unknown): value is SafeToolFactV1['value'] {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    typeof value === 'boolean' ||
    SAFE_FACT_ENUMS.has(value as SafeToolFactV1['value'])
  );
}

const SAFE_FACT_NAMES = new Set<SafeToolFactNameV1>([
  'contentLength',
  'titleLength',
  'summaryLength',
  'promptLength',
  'queryLength',
  'originalMessageLength',
  'locationLength',
  'descriptionLength',
  'messageLength',
  'textLength',
  'tagsCount',
  'sourceMessageIdsCount',
  'attendeesCount',
  'resultCount',
  'maxResults',
  'expectedVersion',
  'currentVersion',
  'hasUrl',
  'hasSourceUrl',
  'hasCalendarId',
  'hasItemId',
  'hasLinearIssueId',
  'startMatchesCatalog',
  'endMatchesCatalog',
  'timeZoneMatchesCatalog',
  'mode',
  'workerType',
  'taskMode',
]);
const SAFE_FACT_ENUMS = new Set<SafeToolFactV1['value']>([
  'list',
  'count',
  'codex',
  'codex-xhigh',
  'minimax',
  'planning',
  'execution',
]);
const USAGE_STAGES = new Set<SafeAgentUsageV1['stage']>([
  'intent_classification',
  'agent_generation',
  'response_schema_repair',
]);
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const TERMINAL_FAILURE_CODES = new Set<SafeTurnFailureCode>([
  'AMBIGUOUS_EXTERNAL_EFFECT',
  'REPLY_PUBLICATION_REJECTED',
  'EXECUTION_REJECTED',
]);

function failure(
  code: 'NOT_FOUND' | 'REVISION_MISMATCH' | 'CORRUPT_EVIDENCE'
): Extract<MatrixCorpusEvidenceResult, Readonly<{ ok: false }>> {
  return { ok: false as const, code };
}
