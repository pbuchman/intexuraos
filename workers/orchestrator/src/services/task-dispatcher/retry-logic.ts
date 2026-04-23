import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { withTimeout } from '../../with-timeout.js';
import type { ActivityTimeoutManager } from '../activity-timeout-manager.js';
import type { IsolationProvider } from '../isolation/types.js';
import type { Task, TaskError } from '../../types/task.js';

export const TASK_TIMEOUT_WARNING_MS = 295 * 60 * 1000; // 4h 55m
export const TASK_TIMEOUT_KILL_MS = 300 * 60 * 1000; // 5h
export const COMPLETION_CHECK_INTERVAL_MS = 30 * 1000; // 30s
export const ACTIVITY_HEARTBEAT_THRESHOLD_MS = 30 * 1000; // 30s
export const IMAGE_PULL_TIMEOUT_MS = 900_000; // 15 minutes — image pulls are network-bound
export const CONTAINER_CREATE_TIMEOUT_MS = 120_000; // 2 minutes
export const ZOMBIE_CLEANUP_TIMEOUT_MS = 30_000; // 30s — generous limit for best-effort destroy
export const EVIDENCE_CAPTURE_TIMEOUT_MS = 30_000; // 30s — copyOut/statsSnapshot are best-effort pre-kill telemetry
export const WORKER_DESTROY_TIMEOUT_MS = 30_000; // 30s — bound destroyWorker so docker unresponsiveness cannot wedge the task in 'running'
export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — no output triggers kill+restart
export const MAX_INACTIVITY_RESTARTS = 3; // max consecutive restarts before task is failed

/**
 * Clears all scheduled timers for a task (warning, kill, completion monitor),
 * stops the activity timeout manager, and clears any transient completion
 * tracking flags. Called after finalize and cancel paths so leftover timers
 * cannot fire on a completed task.
 */
export function clearTaskTimers(
  activeTasks: Map<string, NodeJS.Timeout>,
  activityTimeoutManager: ActivityTimeoutManager,
  completionInProgress: Set<string>,
  attemptCompletionSignals: Set<string>,
  taskId: string
): void {
  const keys = [`${taskId}-warning`, `${taskId}-kill`, `${taskId}-monitor`];
  for (const key of keys) {
    const timer = activeTasks.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      clearInterval(timer);
      activeTasks.delete(key);
    }
  }
  activityTimeoutManager.stop(taskId);
  completionInProgress.delete(taskId);
  attemptCompletionSignals.delete(taskId);
}

export interface EvidenceCaptureDeps {
  isolation: { provider: IsolationProvider };
  logger: Logger;
}

/**
 * Best-effort copyOut+stats snapshot captured before an inactivity kill so
 * post-mortem evidence survives the worker teardown. Both calls are bounded
 * by EVIDENCE_CAPTURE_TIMEOUT_MS — a stalled container cannot wedge the
 * restart path.
 */
export async function captureInactivityEvidence(
  deps: EvidenceCaptureDeps,
  taskId: string,
  evidenceDir: string
): Promise<void> {
  const [copyResult, statsResult] = await Promise.allSettled([
    withTimeout(
      deps.isolation.provider.copyOut(taskId, '/tmp', evidenceDir),
      EVIDENCE_CAPTURE_TIMEOUT_MS,
      `copyOut timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
    ),
    withTimeout(
      deps.isolation.provider.statsSnapshot(taskId),
      EVIDENCE_CAPTURE_TIMEOUT_MS,
      `statsSnapshot timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
    ),
  ]);
  if (copyResult.status === 'rejected') {
    deps.logger.warn(
      { taskId, error: getErrorMessage(copyResult.reason) },
      'Failed to copy /tmp evidence before inactivity kill'
    );
  }
  if (statsResult.status === 'fulfilled') {
    deps.logger.warn({ taskId, stats: statsResult.value }, 'Container stats at inactivity kill');
  } else {
    deps.logger.warn(
      { taskId, error: getErrorMessage(statsResult.reason) },
      'Failed to capture container stats before inactivity kill'
    );
  }
}

/**
 * Builds the TaskError returned when the max consecutive inactivity restarts
 * has been exceeded. Named constant for test clarity.
 */
export function buildMaxRestartsExceededError(): TaskError {
  return {
    code: 'TASK_INACTIVITY_TIMEOUT',
    message: `Worker unresponsive after ${String(MAX_INACTIVITY_RESTARTS)} consecutive inactivity restarts`,
    remediation: { action: 'retry' },
  };
}

/**
 * Builds the TaskError returned when the replacement worker could not be
 * started after an inactivity restart attempt.
 */
export function buildRestartStartFailedError(): TaskError {
  return {
    code: 'TASK_INACTIVITY_RESTART_FAILED',
    message: 'Failed to restart worker after inactivity timeout',
    remediation: { action: 'retry' },
  };
}

/**
 * Whether the completion monitor should skip this tick because an inactivity
 * restart is mid-flight (old worker destroyed, new one not yet up). Running
 * verification now would verify on the stale transcript of the killed session.
 */
export function isInactivityRestartInProgress(
  inactivityRestartInProgress: Set<string>,
  taskId: string
): boolean {
  return inactivityRestartInProgress.has(taskId);
}

export const INACTIVITY_RESTART_PROMPT = `Your previous session became unresponsive (no output for 10 minutes) and was terminated.
Continue working on the task from where you left off. Review your progress so far and
resume the next incomplete step.`;

// Type re-export for convenience
export type { Task };
