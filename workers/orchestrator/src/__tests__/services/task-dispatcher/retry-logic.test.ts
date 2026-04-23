import { describe, it, expect, vi } from 'vitest';
import {
  clearTaskTimers,
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  COMPLETION_CHECK_INTERVAL_MS,
  ACTIVITY_HEARTBEAT_THRESHOLD_MS,
  IMAGE_PULL_TIMEOUT_MS,
  CONTAINER_CREATE_TIMEOUT_MS,
  ZOMBIE_CLEANUP_TIMEOUT_MS,
  EVIDENCE_CAPTURE_TIMEOUT_MS,
  WORKER_DESTROY_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MS,
  MAX_INACTIVITY_RESTARTS,
} from '../../../services/task-dispatcher/retry-logic.js';

describe('retry-logic constants', () => {
  it('warns before killing so a final flush has time to land', () => {
    expect(TASK_TIMEOUT_WARNING_MS).toBeLessThan(TASK_TIMEOUT_KILL_MS);
    // Warning must precede kill by at least a completion-check interval so the
    // monitor can observe & forward the warning before the kill timer fires.
    expect(TASK_TIMEOUT_KILL_MS - TASK_TIMEOUT_WARNING_MS).toBeGreaterThanOrEqual(
      COMPLETION_CHECK_INTERVAL_MS
    );
  });

  it('keeps inactivity kill strictly below the global task kill', () => {
    expect(INACTIVITY_TIMEOUT_MS).toBeLessThan(TASK_TIMEOUT_KILL_MS);
  });

  it('budgets image pulls more generously than container creation (network-bound)', () => {
    expect(IMAGE_PULL_TIMEOUT_MS).toBeGreaterThan(CONTAINER_CREATE_TIMEOUT_MS);
  });

  it('exposes positive millisecond budgets for every timeout', () => {
    for (const value of [
      TASK_TIMEOUT_WARNING_MS,
      TASK_TIMEOUT_KILL_MS,
      COMPLETION_CHECK_INTERVAL_MS,
      ACTIVITY_HEARTBEAT_THRESHOLD_MS,
      IMAGE_PULL_TIMEOUT_MS,
      CONTAINER_CREATE_TIMEOUT_MS,
      ZOMBIE_CLEANUP_TIMEOUT_MS,
      EVIDENCE_CAPTURE_TIMEOUT_MS,
      WORKER_DESTROY_TIMEOUT_MS,
      INACTIVITY_TIMEOUT_MS,
    ]) {
      expect(value).toBeGreaterThan(0);
    }
  });

  it('caps consecutive inactivity-driven restarts at a small positive integer', () => {
    expect(MAX_INACTIVITY_RESTARTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_INACTIVITY_RESTARTS)).toBe(true);
    // A handful of restarts at most — runaway loops would defeat the inactivity guard.
    expect(MAX_INACTIVITY_RESTARTS).toBeLessThanOrEqual(10);
  });
});

describe('clearTaskTimers', () => {
  it('clears the warning, kill, and monitor timers and stops tracking', () => {
    const warning = setTimeout(() => undefined, 0);
    const kill = setTimeout(() => undefined, 0);
    const monitor = setInterval(() => undefined, 60_000);
    const activeTasks = new Map<string, NodeJS.Timeout>([
      ['task-1-warning', warning],
      ['task-1-kill', kill],
      ['task-1-monitor', monitor],
    ]);
    const activityTimeoutManager = { stop: vi.fn() };
    const completionInProgress = new Set(['task-1', 'other-task']);
    const attemptCompletionSignals = new Set(['task-1', 'other-task']);

    clearTaskTimers(
      activeTasks,
      activityTimeoutManager as never,
      completionInProgress,
      attemptCompletionSignals,
      'task-1'
    );

    expect(activeTasks.has('task-1-warning')).toBe(false);
    expect(activeTasks.has('task-1-kill')).toBe(false);
    expect(activeTasks.has('task-1-monitor')).toBe(false);
    expect(activityTimeoutManager.stop).toHaveBeenCalledWith('task-1');
    expect(completionInProgress.has('task-1')).toBe(false);
    expect(completionInProgress.has('other-task')).toBe(true);
    expect(attemptCompletionSignals.has('task-1')).toBe(false);
    expect(attemptCompletionSignals.has('other-task')).toBe(true);
  });

  it('is a no-op for unknown task ids', () => {
    const activeTasks = new Map<string, NodeJS.Timeout>();
    const activityTimeoutManager = { stop: vi.fn() };
    const completionInProgress = new Set<string>();
    const attemptCompletionSignals = new Set<string>();

    clearTaskTimers(
      activeTasks,
      activityTimeoutManager as never,
      completionInProgress,
      attemptCompletionSignals,
      'missing-task'
    );

    expect(activityTimeoutManager.stop).toHaveBeenCalledWith('missing-task');
    expect(activeTasks.size).toBe(0);
  });
});
