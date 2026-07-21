import { createHash } from 'node:crypto';

import type { MatrixCorpusSessionRepository } from '../ports/sessionRepository.js';
import type { IntexAgentSessionEvent } from '../sessions/types.js';
import type { MatrixCorpusIngestReceipt } from './ports/ingestReceiptRepository.js';
import type { SafeAgentUsageTotalsV1 } from './usageProjection.js';

export type MatrixCorpusTurnTerminalRecordResult = Readonly<{
  ok: boolean;
  disposition: 'applied' | 'already_applied' | 'not_applicable' | 'rejected';
}>;

export interface MatrixCorpusTurnTerminalRecorder {
  recordTerminal(
    input: Readonly<{
      receipt: MatrixCorpusIngestReceipt;
      userId: string;
    }>
  ): Promise<MatrixCorpusTurnTerminalRecordResult>;
}

export function createMatrixCorpusTurnTerminalRecorder(
  deps: Readonly<{
    sessionRepository: MatrixCorpusSessionRepository;
  }>
): MatrixCorpusTurnTerminalRecorder {
  return {
    async recordTerminal(input): Promise<MatrixCorpusTurnTerminalRecordResult> {
      const terminal = input.receipt.publication.terminal;
      if (
        input.receipt.state === 'failed' &&
        (input.receipt.failureCode === 'MATRIX_CORPUS_NOT_READY' ||
          input.receipt.failureCode === 'MATRIX_CORPUS_PREPARATION_REJECTED')
      ) {
        return { ok: true, disposition: 'not_applicable' };
      }
      if (
        terminal === null ||
        (input.receipt.state === 'completed' && terminal.kind !== 'completed') ||
        (input.receipt.state === 'failed' && terminal.kind !== 'failed') ||
        (input.receipt.state !== 'completed' && input.receipt.state !== 'failed')
      ) {
        return { ok: false, disposition: 'rejected' };
      }
      const identity = {
        runId: input.receipt.runId,
        scenarioId: input.receipt.scenarioId,
        sessionId: input.receipt.sessionId,
        userId: input.userId,
        leaseFence: input.receipt.leaseFence,
      };
      const completed = terminal.kind === 'completed';
      if (
        !(await ensureUsageSummary({
          sessionRepository: deps.sessionRepository,
          identity,
          receipt: input.receipt,
          userId: input.userId,
          completed,
          closedAt: terminal.closedAt,
        }))
      )
        return { ok: false, disposition: 'rejected' };
      const appended = await deps.sessionRepository.appendMatrixCorpusEvent({
        identity,
        event: {
          id: terminalEventId(input.receipt.ingestReceiptId, terminal.kind),
          sessionId: input.receipt.sessionId,
          userId: input.userId,
          type: completed ? 'turn_processing_completed' : 'turn_processing_failed',
          payload: completed
            ? {
                turnIndex: input.receipt.turnIndex,
                status: 'completed',
                replyCount: terminal.replyCount,
                replyDigests: [...terminal.replyDigests],
              }
            : {
                turnIndex: input.receipt.turnIndex,
                status: 'failed',
                failureCode: terminal.code,
              },
          createdAt: terminal.closedAt,
        },
        now: terminal.closedAt,
      });
      return appended.ok
        ? { ok: true, disposition: appended.disposition }
        : { ok: false, disposition: 'rejected' };
    },
  };
}

async function ensureUsageSummary(
  input: Readonly<{
    sessionRepository: MatrixCorpusSessionRepository;
    identity: Parameters<MatrixCorpusSessionRepository['listMatrixCorpusEventsExact']>[0];
    receipt: MatrixCorpusIngestReceipt;
    userId: string;
    completed: boolean;
    closedAt: string;
  }>
): Promise<boolean> {
  const listed = await input.sessionRepository.listMatrixCorpusEventsExact(input.identity);
  if (!listed.ok) return false;
  const existingSummaries = listed.events.filter(
    (event) =>
      event.type === 'llm_usage_summary' && event.payload['turnIndex'] === input.receipt.turnIndex
  );
  if (existingSummaries.length > 1) return false;
  if (existingSummaries.length === 1) return true;
  if (input.completed) return false;

  const usage = listed.events
    .filter(
      (event) =>
        event.type === 'llm_call_usage' && event.payload['turnIndex'] === input.receipt.turnIndex
    )
    .map(readUsageEvent);
  if (usage.some((record) => record === null)) return false;
  const totals = usage.reduce<SafeAgentUsageTotalsV1>(
    (sum, record) => ({
      /* v8 ignore start -- ts-type: prior null check guarantees every mapped usage record is present; optional access and nullish coalescing remain because Array.some does not narrow the element type @preserve */
      inputTokens: sum.inputTokens + (record?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (record?.outputTokens ?? 0),
      totalTokens: sum.totalTokens + (record?.totalTokens ?? 0),
      costNanoUsd: sum.costNanoUsd + (record?.costNanoUsd ?? 0),
      /* v8 ignore stop @preserve */
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 }
  );
  if (!Object.values(totals).every(Number.isSafeInteger)) return false;
  const appended = await input.sessionRepository.appendMatrixCorpusEvent({
    identity: input.identity,
    event: {
      id: usageSummaryEventId(input.receipt.ingestReceiptId),
      sessionId: input.receipt.sessionId,
      userId: input.userId,
      type: 'llm_usage_summary',
      payload: {
        turnIndex: input.receipt.turnIndex,
        status: 'failed',
        expectedCallCount: usage.length,
        reportedCallCount: usage.length,
        ...totals,
      },
      createdAt: input.closedAt,
    },
    now: input.closedAt,
  });
  return appended.ok;
}

function readUsageEvent(event: IntexAgentSessionEvent): SafeAgentUsageTotalsV1 | null {
  const payload = event.payload;
  const keys = Object.keys(payload).sort();
  const expectedKeys = [
    'callOrdinal',
    'costNanoUsd',
    'inputTokens',
    'outputTokens',
    'stage',
    'totalTokens',
    'turnIndex',
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key) ||
    !isSafeIndex(payload['inputTokens']) ||
    !isSafeIndex(payload['outputTokens']) ||
    !isSafeIndex(payload['totalTokens']) ||
    payload['totalTokens'] !== payload['inputTokens'] + payload['outputTokens'] ||
    !isSafeIndex(payload['costNanoUsd']) ||
    !isSafeIndex(payload['callOrdinal'], 1) ||
    (payload['stage'] !== 'intent_classification' &&
      payload['stage'] !== 'agent_generation' &&
      payload['stage'] !== 'response_schema_repair')
  )
    return null;
  return {
    inputTokens: payload['inputTokens'],
    outputTokens: payload['outputTokens'],
    totalTokens: payload['totalTokens'],
    costNanoUsd: payload['costNanoUsd'],
  };
}

function isSafeIndex(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function usageSummaryEventId(ingestReceiptId: string): string {
  const digest = createHash('sha256')
    .update(`${ingestReceiptId}:turn`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `imc_usage_summary_${digest}`;
}

function terminalEventId(ingestReceiptId: string, terminalKind: 'completed' | 'failed'): string {
  const digest = createHash('sha256')
    .update(`matrix-corpus-turn-terminal-v1\0${ingestReceiptId}\0${terminalKind}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `imc_terminal_${digest}`;
}
