import type { Logger } from '@intexuraos/common-core';
import type { LogForwarder } from '../log-forwarder.js';

/**
 * Formats a date as `HH:mm:ss.mmm` in local time. Used to tag orchestrator log
 * lines appended to the per-task log forwarder stream.
 */
export function formatLocalTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Appends a tagged log line to the per-task log forwarder. Each line is
 * prefixed with the local time and an explicit tag, so the web UI can route
 * orchestrator vs. prompt vs. instruction messages into distinct tracks.
 */
export function appendTaggedTaskLog(
  logForwarder: LogForwarder,
  taskId: string,
  tag: string,
  message: string
): void {
  logForwarder.appendChunk(taskId, `${formatLocalTime(new Date())} [${tag}] ${message}\n`);
}

/** Convenience wrapper that tags the line as `orchestrator`. */
export function appendOrchestratorTaskLog(
  logForwarder: LogForwarder,
  taskId: string,
  message: string
): void {
  appendTaggedTaskLog(logForwarder, taskId, 'orchestrator', message);
}

/**
 * Flushes pending log chunks for a task. Best-effort — logs a warning on
 * failure so the caller can continue the finalize/teardown path.
 */
export async function flushTaskLogs(
  logForwarder: LogForwarder,
  logger: Logger,
  taskId: string
): Promise<void> {
  try {
    await logForwarder.flush(taskId);
  } catch (error) {
    logger.warn({ taskId, error }, 'Failed to flush task logs');
  }
}

/**
 * Flushes and closes the log forwarder for a task after the compliance
 * validation tail has finished. Used when finalizeTask was called with
 * `keepLogForwarderOpen=true` to keep the stream alive for the compliance
 * report.
 */
export async function flushAndCloseLogForwarder(
  logForwarder: LogForwarder,
  logger: Logger,
  taskId: string
): Promise<void> {
  await flushTaskLogs(logForwarder, logger, taskId);
  try {
    logForwarder.close(taskId);
  } catch (error) {
    logger.warn({ taskId, error }, 'Failed to close log forwarder after compliance validation');
  }
}
