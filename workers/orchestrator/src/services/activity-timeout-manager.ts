import type { Logger } from '@intexuraos/common-core';

export interface ActivityTimeoutConfig {
  /** Inactivity threshold before the timeout callback fires (default: 600_000 = 10 minutes). */
  timeoutMs: number;
  /** Maximum consecutive inactivity restarts before the task is failed. */
  maxRestarts: number;
  logger: Logger;
}

/**
 * Manages per-task inactivity timeouts.
 *
 * Uses `setTimeout` (not `setInterval`). Each `touch()` clears the existing
 * timer and creates a new one, so the timeout fires exactly `timeoutMs` after
 * the last real output.
 */
export class ActivityTimeoutManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly consecutiveRestarts = new Map<string, number>();

  constructor(
    private readonly config: ActivityTimeoutConfig,
    private readonly onTimeout: (taskId: string) => void
  ) {}

  /** Start the inactivity countdown for a task. */
  start(taskId: string): void {
    this.clearTimer(taskId);
    if (!this.consecutiveRestarts.has(taskId)) {
      this.consecutiveRestarts.set(taskId, 0);
    }
    this.timers.set(
      taskId,
      setTimeout(() => {
        this.onTimeout(taskId);
      }, this.config.timeoutMs)
    );
    this.config.logger.debug({ taskId }, 'Activity timeout started');
  }

  /** Reset the countdown — called on every real log output. */
  touch(taskId: string): void {
    if (!this.timers.has(taskId)) {
      return;
    }

    this.clearTimer(taskId);
    this.timers.set(
      taskId,
      setTimeout(() => {
        this.onTimeout(taskId);
      }, this.config.timeoutMs)
    );

    // If there have been restarts, real output means the session recovered
    /* v8 ignore start -- ts-type: Map.get returns T | undefined; consecutiveRestarts is always set by start() before touch() can fire, so undefined branch is structurally unreachable @preserve */
    if ((this.consecutiveRestarts.get(taskId) ?? 0) > 0) {
      /* v8 ignore stop @preserve */
      this.consecutiveRestarts.set(taskId, 0);
    }
  }

  /** Stop and clean up — called on task completion or teardown. */
  stop(taskId: string): void {
    this.clearTimer(taskId);
    this.timers.delete(taskId);
    this.consecutiveRestarts.delete(taskId);
  }

  /** Get how many consecutive inactivity restarts have occurred for this task. */
  getRestartCount(taskId: string): number {
    return this.consecutiveRestarts.get(taskId) ?? 0;
  }

  /**
   * Increment the restart counter. Returns `false` if max restarts would be
   * exceeded (counter is NOT incremented in that case).
   */
  recordRestart(taskId: string): boolean {
    const current = this.consecutiveRestarts.get(taskId);
    if (current === undefined) {
      return false;
    }
    if (current >= this.config.maxRestarts) {
      return false;
    }
    this.consecutiveRestarts.set(taskId, current + 1);
    return true;
  }

  /** Reset the consecutive restart counter (called when real output resumes after restart). */
  resetRestartCount(taskId: string): void {
    if (this.consecutiveRestarts.has(taskId)) {
      this.consecutiveRestarts.set(taskId, 0);
    }
  }

  /** Clean up all timers (for graceful shutdown). */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.consecutiveRestarts.clear();
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
