import type { ActivityTimeoutManager } from '../activity-timeout-manager.js';

export const TASK_TIMEOUT_WARNING_MS = 295 * 60 * 1000; // 4h 55m
export const TASK_TIMEOUT_KILL_MS = 300 * 60 * 1000; // 5h
/**
 * Warning offset before kill: when a task carries a per-task `timeoutMs`
 * override (INT-1585), the warning fires at `timeoutMs - WARNING_OFFSET_MS`.
 * For the legacy default path the precomputed TASK_TIMEOUT_WARNING_MS is used
 * unchanged so that existing tests and behaviour are preserved.
 */
export const TASK_TIMEOUT_WARNING_OFFSET_MS = 5 * 60 * 1000; // 5 min
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
