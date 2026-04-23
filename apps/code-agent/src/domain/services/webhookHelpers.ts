/**
 * Webhook-related domain helpers extracted from routes/webhookRoutes.ts.
 *
 * These helpers are pure (or best-effort fire-and-forget) utilities shared by
 * the webhook route handlers and the task-completion use case. They were
 * originally inline in `webhookRoutes.ts`; moving them here keeps the route
 * file thin and allows unit testing independently of Fastify.
 */
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';
import { isMemoryEligibleAgent } from '../utils/memoryEligibility.js';
import {
  createFormatterState,
  flushLogChunkFormatterForRuntime,
  type FormatterState,
  type LogRuntime,
} from './logFormatter.js';

/**
 * Per-task formatter state bookkeeping used by the log-chunk webhook. The
 * state map persists tool_use_id→name mappings across HTTP requests so Read
 * suppression works even when assistant + tool_result land in different
 * chunks.
 */
export interface TaskFormatterEntry {
  runtime: LogRuntime;
  state: FormatterState;
  lastSequence: number;
}

/**
 * Classify a task's runtime from its worker type. Codex workers produce a
 * different stream-JSON shape than Claude workers, so callers need to pick
 * the right formatter.
 */
export function resolveLogRuntime(workerType: string): LogRuntime {
  return workerType.startsWith('codex') ? 'codex' : 'claude';
}

/**
 * Initialize a fresh formatter entry for a task at sequence 0. Extracted so
 * both the log-chunk handler and tests can build entries identically.
 */
export function createTaskFormatterEntry(workerType: string): TaskFormatterEntry {
  return {
    runtime: resolveLogRuntime(workerType),
    state: createFormatterState(),
    lastSequence: 0,
  };
}

/**
 * Decide whether an execution-memory post-run block should be queued when a
 * task completes. Mirrors the original inline predicate and is exported so
 * the handleTaskCompletion use case + tests can share the decision logic.
 */
export function shouldQueueExecutionMemoryPostRun(params: {
  agentType: string | undefined; // @allow-undefined-type -- required parameter, not optional property
  existingStatus: string | undefined; // @allow-undefined-type -- required parameter, not optional property
}): boolean {
  return (
    loadConfig().executionMemoryEnabled
    && isMemoryEligibleAgent(params.agentType)
    && params.existingStatus === undefined
  );
}

/**
 * Best-effort: record a task_failed automation log event for PR-linked tasks.
 * Encapsulates the repeated guard + fire-and-forget pattern used across
 * enforcement checks.
 */
export function recordTaskFailed(params: {
  task: { repository: string; prNumber?: number; dispatchedAt?: Timestamp; userId: string };
  taskId: string;
  completedAt: Date;
  error: string;
  errorCode: string;
}): void {
  if (params.task.prNumber === undefined) return;
  getServices().automationLog.record(
    { repository: params.task.repository, prNumber: params.task.prNumber },
    {
      type: 'task_failed',
      taskId: params.taskId,
      error: params.error,
      errorCode: params.errorCode,
      /* v8 ignore start -- test-infra: FakeFirestore cannot simulate Firestore Timestamp for dispatchedAt in task_failed scenarios @preserve */
      ...(params.task.dispatchedAt !== undefined && {
        duration: params.completedAt.getTime() - new Date(params.task.dispatchedAt.toDate()).getTime(),
      }),
      /* v8 ignore stop @preserve */
    },
    params.task.userId,
  ).catch((e: unknown) => {
    getServices().logger.warn({ error: e, taskId: params.taskId }, 'Failed to record automation log for task failure');
  });
}

/**
 * Best-effort: record a remediation_decision automation log event. Called
 * from the review-complete path in handleTaskCompletion for both positive
 * (remediation required) and negative (all clear) signals.
 */
export function recordRemediationDecision(params: {
  repository: string;
  prNumber: number;
  userId: string;
  required: boolean;
  signal: '0' | '1' | 'missing';
  taskId?: string;
}): void {
  getServices().automationLog.record(
    { repository: params.repository, prNumber: params.prNumber },
    {
      type: 'remediation_decision',
      required: params.required,
      source: 'review_result',
      signal: params.signal,
      ...(params.taskId !== undefined && { taskId: params.taskId }),
    },
    params.userId,
  ).catch((e: unknown) => {
    getServices().logger.warn(
      { error: e, repository: params.repository, prNumber: params.prNumber },
      'Failed to record remediation decision automation log',
    );
  });
}

/**
 * Flush any pending log lines still buffered in the per-task formatter state
 * and delete the entry from the provided state map. Returns nothing (the
 * repository error is logged, not thrown, because this runs during terminal
 * status transitions).
 */
export async function flushPendingTaskLogLines(
  taskFormatterStates: Map<string, TaskFormatterEntry>,
  taskId: string,
  logger: Logger,
): Promise<void> {
  const formatterEntry = taskFormatterStates.get(taskId);
  if (formatterEntry === undefined) return;

  taskFormatterStates.delete(taskId);

  const pendingLines = flushLogChunkFormatterForRuntime(
    formatterEntry.runtime,
    formatterEntry.lastSequence + 1,
    Timestamp.now(),
    formatterEntry.state,
  );

  if (pendingLines.length === 0) {
    return;
  }

  const lineResult = await getServices().logLineRepo.storeBatch(taskId, pendingLines);
  if (!lineResult.ok) {
    logger.error(
      { taskId, error: lineResult.error },
      'Failed to flush pending log lines on task completion',
    );
  }
}
