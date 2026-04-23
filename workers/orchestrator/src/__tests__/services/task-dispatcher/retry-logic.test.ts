import { describe, it, expect, vi } from 'vitest';
import {
  clearTaskTimers,
  captureInactivityEvidence,
  buildMaxRestartsExceededError,
  buildRestartStartFailedError,
  isInactivityRestartInProgress,
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
  INACTIVITY_RESTART_PROMPT,
} from '../../../services/task-dispatcher/retry-logic.js';

describe('retry-logic constants', () => {
  it('exports documented millisecond budgets for each phase', () => {
    expect(TASK_TIMEOUT_WARNING_MS).toBe(295 * 60 * 1000);
    expect(TASK_TIMEOUT_KILL_MS).toBe(300 * 60 * 1000);
    expect(COMPLETION_CHECK_INTERVAL_MS).toBe(30 * 1000);
    expect(ACTIVITY_HEARTBEAT_THRESHOLD_MS).toBe(30 * 1000);
    expect(IMAGE_PULL_TIMEOUT_MS).toBe(900_000);
    expect(CONTAINER_CREATE_TIMEOUT_MS).toBe(120_000);
    expect(ZOMBIE_CLEANUP_TIMEOUT_MS).toBe(30_000);
    expect(EVIDENCE_CAPTURE_TIMEOUT_MS).toBe(30_000);
    expect(WORKER_DESTROY_TIMEOUT_MS).toBe(30_000);
    expect(INACTIVITY_TIMEOUT_MS).toBe(10 * 60 * 1000);
    expect(MAX_INACTIVITY_RESTARTS).toBe(3);
  });

  it('exports a non-empty INACTIVITY_RESTART_PROMPT with restart instructions', () => {
    expect(INACTIVITY_RESTART_PROMPT).toContain('unresponsive');
    expect(INACTIVITY_RESTART_PROMPT).toContain('Continue working');
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

describe('captureInactivityEvidence', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };

  function makeProvider(overrides: Partial<{ copyOut: unknown; statsSnapshot: unknown }> = {}): {
    copyOut: unknown;
    statsSnapshot: unknown;
  } {
    return {
      copyOut: overrides.copyOut ?? vi.fn().mockResolvedValue(undefined),
      statsSnapshot: overrides.statsSnapshot ?? vi.fn().mockResolvedValue({ cpu: '10%' }),
    };
  }

  it('warns when copyOut is rejected but does not throw', async () => {
    mockLogger.warn.mockReset();
    const provider = makeProvider({
      copyOut: vi.fn().mockRejectedValue(new Error('copy failed')),
    });
    await captureInactivityEvidence(
      { isolation: { provider: provider as never }, logger: mockLogger as never },
      'task-1',
      '/tmp/evidence'
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to copy /tmp evidence before inactivity kill'
    );
  });

  it('logs stats on success and error on failure', async () => {
    mockLogger.warn.mockReset();
    const provider = makeProvider({
      statsSnapshot: vi.fn().mockRejectedValue(new Error('stats failed')),
    });
    await captureInactivityEvidence(
      { isolation: { provider: provider as never }, logger: mockLogger as never },
      'task-2',
      '/tmp/evidence'
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-2' }),
      'Failed to capture container stats before inactivity kill'
    );
  });

  it('logs a stats snapshot when both calls succeed', async () => {
    mockLogger.warn.mockReset();
    const provider = makeProvider({});
    await captureInactivityEvidence(
      { isolation: { provider: provider as never }, logger: mockLogger as never },
      'task-3',
      '/tmp/evidence'
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-3', stats: { cpu: '10%' } }),
      'Container stats at inactivity kill'
    );
  });
});

describe('buildMaxRestartsExceededError', () => {
  it('returns TASK_INACTIVITY_TIMEOUT with a retry remediation', () => {
    const err = buildMaxRestartsExceededError();
    expect(err.code).toBe('TASK_INACTIVITY_TIMEOUT');
    expect(err.message).toContain(String(MAX_INACTIVITY_RESTARTS));
    expect(err.remediation).toEqual({ action: 'retry' });
  });
});

describe('buildRestartStartFailedError', () => {
  it('returns TASK_INACTIVITY_RESTART_FAILED with a retry remediation', () => {
    const err = buildRestartStartFailedError();
    expect(err.code).toBe('TASK_INACTIVITY_RESTART_FAILED');
    expect(err.remediation).toEqual({ action: 'retry' });
  });
});

describe('isInactivityRestartInProgress', () => {
  it('returns true when the task id is in the tracked set', () => {
    const set = new Set(['task-1']);
    expect(isInactivityRestartInProgress(set, 'task-1')).toBe(true);
  });

  it('returns false when the task id is not in the tracked set', () => {
    const set = new Set<string>();
    expect(isInactivityRestartInProgress(set, 'task-1')).toBe(false);
  });
});
