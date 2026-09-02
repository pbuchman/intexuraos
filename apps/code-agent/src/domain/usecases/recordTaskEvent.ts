/**
 * Use case: Record a task event (log chunks or turn metrics) and fan out the
 * required downstream effects.
 *
 * Previously inline inside `POST /internal/logs` and `POST /internal/turn-metrics`
 * handlers in `webhookRoutes.ts`, this use case groups the "task event"
 * processing so routes become thin:
 *   - storeLogChunks:   stores a batch of log chunks, triggers dispatched→running
 *                       transition on first delivery, formats + stores log lines
 *   - recordTurnMetrics: stores turn metrics + appends formatted log lines
 *
 * Both accept the established use-case `logger: Logger` dependency.
 */
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import {
  createFormatterState,
  formatLogChunkForRuntime,
} from '../services/logFormatter.js';
import { formatMetricsLogLines } from '../formatters/metricsLogFormatter.js';
import {
  createTaskFormatterEntry,
  type TaskFormatterEntry,
} from '../services/webhookHelpers.js';
import type { TurnMetrics } from '../models/turnMetrics.js';

export interface StoreLogChunksBody {
  taskId: string;
  chunks: { sequence: number; content: string; timestamp: string }[];
}

export type StoreLogChunksResult =
  | { kind: 'received'; acknowledgedSequences: number[]; count: number }
  | { kind: 'fail'; code: string; message: string };

export interface StoreLogChunksInput {
  body: StoreLogChunksBody;
  requestLog: Logger;
  traceId: string;
  taskFormatterStates: Map<string, TaskFormatterEntry>;
}

/**
 * Store log chunks, emit status transition (dispatched→running) on first
 * delivery, and produce formatted log lines for the UI.
 */
export async function storeLogChunks(
  logger: Logger,
  input: StoreLogChunksInput,
): Promise<StoreLogChunksResult> {
  // `logger` is the use-case-scoped logger; the route-scoped `requestLog`
  // is kept for per-request context logs (preserves pre-existing log shape
  // exactly).
  const { body, requestLog, taskFormatterStates } = input;
  const { logChunkRepo, logLineRepo, codeTaskRepo } = getServices();
  const { taskId, chunks } = body;

  logger.debug({ taskId, count: chunks.length }, 'storeLogChunks: processing batch');
  requestLog.debug({ taskId, count: chunks.length }, 'Storing log chunks');

  // First log delivery for this task — task might still be dispatched.
  // Update to running so the task list reflects active execution.
  let formatterEntry = taskFormatterStates.get(taskId);
  if (formatterEntry === undefined) {
    const taskResult = await codeTaskRepo.findById(taskId);
    if (taskResult.ok && taskResult.value.status === 'dispatched') {
      await codeTaskRepo.update(taskId, { status: 'running' });
    }
    if (taskResult.ok) {
      const resolvedFormatterEntry = createTaskFormatterEntry(taskResult.value.workerType);
      formatterEntry = resolvedFormatterEntry;
      taskFormatterStates.set(taskId, resolvedFormatterEntry);
    } else {
      requestLog.warn(
        { taskId, error: taskResult.error },
        'Could not resolve task for log-chunk delivery; proceeding with default formatter',
      );
    }
  }

  // Store chunks in Firestore subcollection
  const logChunks = chunks.map((chunk) => ({
    id: '',
    sequence: chunk.sequence,
    content: chunk.content,
    timestamp: Timestamp.fromDate(new Date(chunk.timestamp)),
    size: Buffer.byteLength(chunk.content, 'utf-8'),
  }));

  const storeResult = await logChunkRepo.storeBatch(taskId, logChunks);

  if (!storeResult.ok) {
    requestLog.error({ taskId, error: storeResult.error }, 'Failed to store log chunks');
    return { kind: 'fail', code: 'INTERNAL_ERROR', message: storeResult.error.message };
  }

  const formatter = formatterEntry ?? {
    runtime: 'claude' as const,
    state: createFormatterState(),
    lastSequence: chunks[chunks.length - 1]?.sequence ?? 0,
  };
  const allLines = chunks.flatMap((chunk) => {
    const chunkTimestamp = Timestamp.fromDate(new Date(chunk.timestamp));
    return formatLogChunkForRuntime(formatter.runtime, chunk.content, chunk.sequence, chunkTimestamp, formatter.state);
  });
  formatter.lastSequence = chunks[chunks.length - 1]?.sequence ?? formatter.lastSequence;
  if (formatterEntry !== undefined) {
    taskFormatterStates.set(taskId, formatter);
  }

  if (allLines.length > 0) {
    const lineResult = await logLineRepo.storeBatch(taskId, allLines);
    if (!lineResult.ok) {
      requestLog.error({ taskId, error: lineResult.error }, 'Failed to store log lines (chunks stored OK)');
    }
  }

  const acknowledgedSequences = chunks.map((c) => c.sequence);
  requestLog.debug({ taskId, count: chunks.length, lines: allLines.length }, 'Log chunks stored successfully');
  return { kind: 'received', acknowledgedSequences, count: acknowledgedSequences.length };
}

export type RecordTurnMetricsResult =
  | { kind: 'received' }
  | { kind: 'fail'; code: string; message: string };

export interface RecordTurnMetricsInput {
  body: TurnMetrics;
  requestLog: Logger;
}

/**
 * Store a turn-metrics event and append formatted log lines. Failures to
 * append log lines are non-fatal (metrics remain stored).
 */
export async function recordTurnMetrics(
  logger: Logger,
  input: RecordTurnMetricsInput,
): Promise<RecordTurnMetricsResult> {
  const { body: metrics, requestLog } = input;
  const { turnMetricsRepo, logLineRepo } = getServices();

  logger.debug(
    { taskId: metrics.taskId, attempt: metrics.attempt },
    'recordTurnMetrics: processing',
  );

  const storeResult = await turnMetricsRepo.store(metrics.taskId, metrics.attempt, metrics);

  if (!storeResult.ok) {
    requestLog.error({ taskId: metrics.taskId, error: storeResult.error }, 'Failed to store turn metrics');
    return { kind: 'fail', code: 'INTERNAL_ERROR', message: storeResult.error.message };
  }

  // Append formatted metrics as log lines (non-fatal)
  const metricsLines = formatMetricsLogLines(metrics);
  const now = Date.now();
  const formattedLines = metricsLines.map((text, i) => ({
    sequence: now * 1000 + i,
    text,
    timestamp: Timestamp.fromDate(new Date(metrics.timestamp)),
  }));

  const lineResult = await logLineRepo.storeBatch(metrics.taskId, formattedLines);
  if (!lineResult.ok) {
    requestLog.warn(
      { taskId: metrics.taskId, error: lineResult.error },
      'Failed to store metrics log lines (non-fatal, metrics stored OK)',
    );
  }

  requestLog.info(
    { taskId: metrics.taskId, attempt: metrics.attempt, logLines: metricsLines.length },
    'Turn metrics stored with log lines',
  );
  return { kind: 'received' };
}
