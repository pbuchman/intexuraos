import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActivityTimeoutManager } from '../activity-timeout-manager.js';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('ActivityTimeoutManager', () => {
  let onTimeout: (taskId: string) => void;
  let onTimeoutMock: ReturnType<typeof vi.fn<(taskId: string) => void>>;
  let manager: ActivityTimeoutManager;

  beforeEach(() => {
    vi.useFakeTimers();
    onTimeoutMock = vi.fn<(taskId: string) => void>();
    onTimeout = onTimeoutMock;
    manager = new ActivityTimeoutManager(
      { timeoutMs: 600_000, maxRestarts: 3, logger: mockLogger },
      onTimeout
    );
  });

  afterEach(() => {
    manager.stopAll();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('fires onTimeout after the configured delay', () => {
      manager.start('task-1');

      vi.advanceTimersByTime(599_999);
      expect(onTimeoutMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-1');
      expect(onTimeoutMock).toHaveBeenCalledTimes(1);
    });

    it('does not fire for a different task', () => {
      manager.start('task-1');
      manager.start('task-2');

      manager.stop('task-1');
      vi.advanceTimersByTime(600_000);

      expect(onTimeoutMock).toHaveBeenCalledWith('task-2');
      expect(onTimeoutMock).not.toHaveBeenCalledWith('task-1');
    });
  });

  describe('touch()', () => {
    it('resets the timer so timeout fires 10 minutes after last touch', () => {
      manager.start('task-1');

      // Advance 5 minutes, then touch
      vi.advanceTimersByTime(300_000);
      manager.touch('task-1');

      // 5 more minutes (10 from start, 5 from touch) — should NOT fire
      vi.advanceTimersByTime(300_000);
      expect(onTimeoutMock).not.toHaveBeenCalled();

      // 5 more minutes (10 from touch) — SHOULD fire
      vi.advanceTimersByTime(300_000);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-1');
    });

    it('resets consecutive restart counter when task has had restarts', () => {
      manager.start('task-1');
      manager.recordRestart('task-1'); // restart count = 1

      expect(manager.getRestartCount('task-1')).toBe(1);

      // Touch signals real output after restart — should reset consecutive count
      manager.touch('task-1');
      expect(manager.getRestartCount('task-1')).toBe(0);
    });

    it('does not reset restart counter when count is zero', () => {
      manager.start('task-1');

      // Touch without any restarts — nothing to reset
      manager.touch('task-1');
      expect(manager.getRestartCount('task-1')).toBe(0);
    });

    it('is a no-op for an untracked task', () => {
      // Should not throw
      manager.touch('nonexistent');
      expect(onTimeoutMock).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('prevents timeout from firing', () => {
      manager.start('task-1');
      manager.stop('task-1');

      vi.advanceTimersByTime(600_000);
      expect(onTimeoutMock).not.toHaveBeenCalled();
    });

    it('cleans up internal state', () => {
      manager.start('task-1');
      manager.recordRestart('task-1');

      manager.stop('task-1');

      // After stop, getRestartCount returns 0 (default)
      expect(manager.getRestartCount('task-1')).toBe(0);
    });

    it('is a no-op for an untracked task', () => {
      // Should not throw
      manager.stop('nonexistent');
    });
  });

  describe('recordRestart()', () => {
    it('increments consecutive counter and returns true when under max', () => {
      manager.start('task-1');

      expect(manager.recordRestart('task-1')).toBe(true);
      expect(manager.getRestartCount('task-1')).toBe(1);

      expect(manager.recordRestart('task-1')).toBe(true);
      expect(manager.getRestartCount('task-1')).toBe(2);
    });

    it('returns true for the last allowed restart', () => {
      manager.start('task-1');

      manager.recordRestart('task-1'); // 1
      manager.recordRestart('task-1'); // 2
      expect(manager.recordRestart('task-1')).toBe(true); // 3 — at the limit
      expect(manager.getRestartCount('task-1')).toBe(3);
    });

    it('returns false when max restarts exceeded', () => {
      manager.start('task-1');

      manager.recordRestart('task-1'); // 1
      manager.recordRestart('task-1'); // 2
      manager.recordRestart('task-1'); // 3

      // 4th restart exceeds max of 3
      expect(manager.recordRestart('task-1')).toBe(false);
      expect(manager.getRestartCount('task-1')).toBe(3); // not incremented
    });

    it('returns false for an untracked task', () => {
      expect(manager.recordRestart('nonexistent')).toBe(false);
    });
  });

  describe('resetRestartCount()', () => {
    it('resets the consecutive restart counter to zero', () => {
      manager.start('task-1');
      manager.recordRestart('task-1');
      manager.recordRestart('task-1');

      manager.resetRestartCount('task-1');
      expect(manager.getRestartCount('task-1')).toBe(0);
    });

    it('is a no-op for an untracked task', () => {
      // Should not throw
      manager.resetRestartCount('nonexistent');
    });
  });

  describe('getRestartCount()', () => {
    it('returns 0 for an untracked task', () => {
      expect(manager.getRestartCount('nonexistent')).toBe(0);
    });

    it('returns 0 for a tracked task with no restarts', () => {
      manager.start('task-1');
      expect(manager.getRestartCount('task-1')).toBe(0);
    });
  });

  describe('stopAll()', () => {
    it('clears all timers for all tasks', () => {
      manager.start('task-1');
      manager.start('task-2');
      manager.start('task-3');

      manager.stopAll();

      vi.advanceTimersByTime(600_000);
      expect(onTimeoutMock).not.toHaveBeenCalled();
    });

    it('clears restart counters for all tasks', () => {
      manager.start('task-1');
      manager.start('task-2');
      manager.recordRestart('task-1');
      manager.recordRestart('task-2');

      manager.stopAll();

      expect(manager.getRestartCount('task-1')).toBe(0);
      expect(manager.getRestartCount('task-2')).toBe(0);
    });
  });

  describe('multiple tasks', () => {
    it('tracks tasks independently', () => {
      manager.start('task-1');

      vi.advanceTimersByTime(300_000); // 5 min
      manager.start('task-2');

      vi.advanceTimersByTime(300_000); // 10 min from task-1 start, 5 min from task-2 start
      expect(onTimeoutMock).toHaveBeenCalledTimes(1);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-1');

      vi.advanceTimersByTime(300_000); // 10 min from task-2 start
      expect(onTimeoutMock).toHaveBeenCalledTimes(2);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-2');
    });

    it('stopping one task does not affect another', () => {
      manager.start('task-1');
      manager.start('task-2');

      manager.stop('task-1');

      vi.advanceTimersByTime(600_000);
      expect(onTimeoutMock).toHaveBeenCalledTimes(1);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-2');
    });
  });

  describe('touch() after restart recovery cycle', () => {
    it('allows fresh restarts after consecutive counter resets via touch', () => {
      manager.start('task-1');

      // 3 restarts
      manager.recordRestart('task-1');
      manager.recordRestart('task-1');
      manager.recordRestart('task-1');

      // Worker recovers — produces output
      manager.touch('task-1');
      expect(manager.getRestartCount('task-1')).toBe(0);

      // Now can restart again
      expect(manager.recordRestart('task-1')).toBe(true);
      expect(manager.getRestartCount('task-1')).toBe(1);
    });
  });

  describe('custom config', () => {
    it('respects custom timeoutMs', () => {
      const customManager = new ActivityTimeoutManager(
        { timeoutMs: 5000, maxRestarts: 1, logger: mockLogger },
        onTimeout
      );

      customManager.start('task-1');
      vi.advanceTimersByTime(4999);
      expect(onTimeoutMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onTimeoutMock).toHaveBeenCalledWith('task-1');

      customManager.stopAll();
    });

    it('respects custom maxRestarts', () => {
      const customManager = new ActivityTimeoutManager(
        { timeoutMs: 5000, maxRestarts: 1, logger: mockLogger },
        onTimeout
      );

      customManager.start('task-1');
      expect(customManager.recordRestart('task-1')).toBe(true); // 1 — at limit
      expect(customManager.recordRestart('task-1')).toBe(false); // 2 — exceeds

      customManager.stopAll();
    });
  });
});
