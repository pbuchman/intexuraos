# Activity-Based Inactivity Timeout

**Date:** 2026-04-08
**Status:** Draft
**Component:** `workers/orchestrator`

## Problem

When Claude Code or Codex gets stuck during execution — producing no meaningful output but not crashing — the orchestrator has no mechanism to recover until the hard 3-hour wall-clock timeout fires. The current "Still processing... no output for Xs" heartbeat messages alert the user to stalls but take no corrective action. A task stuck for 2+ hours wastes compute and delays delivery.

## Goal

If no real output is produced by the worker process (Claude Code or Codex) for 10 minutes, automatically:

1. Kill the exec process
2. Restart it with the `--continue` flag
3. Provide a short prompt instructing the worker to resume from where it left off

This turns a 3-hour timeout into a 10-minute recovery, and since the worker retains its session context via `--continue`, it can pick up where it stopped.

## Current Architecture (Relevant Pieces)

### Activity Tracking

`TaskDispatcher` maintains a `lastOutputAt: Map<string, number>` that records `Date.now()` every time the `onLog` callback fires from the Docker exec stream. Only real Docker output updates this timestamp — orchestrator-generated messages ("Still processing...") do not.

### Completion Monitoring

`startCompletionMonitoring()` polls every 30 seconds. When `lastOutputAt` shows silence >= 30s, it emits a "Still processing..." log. When the Docker container stops or an `attemptCompletionSignal` fires, it triggers `handleTaskCompletion()`.

### Hard Timeout

`scheduleTimeoutKill()` fires at 3 hours and calls `destroyWorker()` + sets task status to `'interrupted'`.

### Retry Infrastructure

The orchestrator already has the kill-and-restart-with-continue pattern:
- `teardownAttempt(taskId, true)` — keeps the container/session alive
- `startWorkerAttempt(task, { prompt, continueSession: true })` — runs a new exec with `WORKER_CONTINUE=1`
- For Codex: passes `CODEX_THREAD_ID` to maintain session threading

## Design

### Approach: Dedicated `ActivityTimeoutManager`

A new class that owns the inactivity detection lifecycle, called by `TaskDispatcher` at the appropriate lifecycle points.

### ActivityTimeoutManager API

```typescript
interface ActivityTimeoutConfig {
  timeoutMs: number; // default: 600_000 (10 minutes)
  maxRestarts: number; // default: 3
  logger: Logger;
}

class ActivityTimeoutManager {
  constructor(config: ActivityTimeoutConfig, onTimeout: (taskId: string) => void);

  /** Start the inactivity countdown for a task. */
  start(taskId: string): void;

  /** Reset the countdown — called on every real log output. */
  touch(taskId: string): void;

  /** Stop and clean up — called on task completion or teardown. */
  stop(taskId: string): void;

  /** Get how many inactivity restarts have occurred for this task. */
  getRestartCount(taskId: string): number;

  /** Increment the restart counter. Returns false if max restarts exceeded. */
  recordRestart(taskId: string): boolean;

  /** Reset the consecutive restart counter (called when real output resumes after restart). */
  resetRestartCount(taskId: string): void;

  /** Clean up all timers (for graceful shutdown). */
  stopAll(): void;
}
```

### Timer Strategy

Uses `setTimeout` (not `setInterval`). Each `touch()` clears the existing timer and creates a new 10-minute one. This is more precise than polling — the timeout fires exactly 10 minutes after the last real output.

### Integration with TaskDispatcher

```
startWorkerAttempt()
  ├── onLog callback ─────► activityTimeout.touch(taskId)
  └── after start ────────► activityTimeout.start(taskId)

activityTimeout fires ───► handleInactivityRestart(taskId)
  ├── 1. Log inactivity event
  ├── 2. Check restart count (fail if > MAX_INACTIVITY_RESTARTS)
  ├── 3. activityTimeout.stop(taskId)
  ├── 4. destroyWorker(taskId) — kill container (SIGTERM → SIGKILL)
  ├── 5. teardownAttempt(taskId, true) — keep session state
  ├── 6. startWorkerAttempt(task, {
  │       prompt: INACTIVITY_RESTART_PROMPT,
  │       continueSession: true
  │     })
  ├── 7. activityTimeout.recordRestart(taskId)
  ├── 8. activityTimeout.start(taskId) — new 10min window
  └── 9. Update task.inactivityRestartCount in Firestore

handleTaskCompletion()
  └── activityTimeout.stop(taskId)

clearTaskTimers()
  └── activityTimeout.stop(taskId)
```

### Restart Counting

Two counters serve different purposes:

- **`consecutiveInactivityRestarts`** (in `ActivityTimeoutManager`) — tracks restarts without any real output in between. Used to enforce the max-restarts cap. Reset to 0 when `touch()` fires after a restart (meaning the restarted session produced output).
- **`task.inactivityRestartCount`** (persisted to Firestore) — total lifetime count across all restarts. For observability and debugging. Never reset.

### Consecutive Restart Counter Reset

When `touch()` fires and the task has had at least one restart, the consecutive counter resets:

```typescript
touch(taskId: string): void {
  // Reset timer
  clearTimeout(this.timers.get(taskId));
  this.timers.set(taskId, setTimeout(() => this.onTimeout(taskId), this.config.timeoutMs));

  // If there have been restarts, real output means the session recovered
  if ((this.consecutiveRestarts.get(taskId) ?? 0) > 0) {
    this.consecutiveRestarts.set(taskId, 0);
  }
}
```

### Maximum Restarts Exceeded

When `consecutiveInactivityRestarts >= MAX_INACTIVITY_RESTARTS` (3), the task fails:

```typescript
const error: TaskError = {
  code: 'TASK_INACTIVITY_TIMEOUT',
  message: `Worker unresponsive after ${MAX_INACTIVITY_RESTARTS} consecutive inactivity restarts`,
  remediation: { action: 'retry' },
};
```

Status is set to `'failed'` with any partial result (PR, branch, commits) preserved, following the same pattern as `TASK_FATAL_EXIT_CODE`.

### Restart Prompt

```
Your previous session became unresponsive (no output for 10 minutes) and was terminated.
Continue working on the task from where you left off. Review your progress so far and
resume the next incomplete step.
```

This is short and directive. It doesn't re-state the original task (the `--continue` session has full context). It tells the worker what happened and what to do.

### Interaction with Existing Timeouts

| Timeout                | Duration        | Action                             | Affected?                                            |
| ---------------------- | --------------- | ---------------------------------- | ---------------------------------------------------- |
| Activity heartbeat     | 30s silence     | Log "Still processing..."          | **No change** — continues to log for user visibility |
| **Inactivity timeout** | **10m silence** | **Kill + restart with --continue** | **NEW**                                              |
| Hard timeout warning   | 2h 55m          | Log warning                        | No change                                            |
| Hard timeout kill      | 3h              | Kill + fail task                   | No change — overall wall-clock cap                   |

The 3-hour hard timeout applies to total task wall-clock time. Inactivity restarts happen within that window. If the hard timeout fires during an inactivity restart cycle, the hard timeout wins.

### Race Conditions

1. **Timeout fires while completion already in progress**: The `completionInProgress` set in `startCompletionMonitoring` prevents `handleTaskCompletion` from running concurrently. Similarly, `handleInactivityRestart` must check `completionInProgress` before acting and skip if the task is already completing.

2. **Container already stopped when timeout fires**: `destroyWorker` handles "container already stopped" gracefully (catches the error, logs it). If the container stopped naturally, the completion monitor will handle it through its normal path.

3. **`touch()` fires right as timeout fires**: The `setTimeout` callback runs on the event loop, so `touch()` and the timeout callback are serialized. If `touch()` clears the timer before the callback runs, no timeout fires. If the callback runs first, the restart proceeds and the subsequent `touch()` resets the consecutive counter.

### Does NOT Consume an Attempt

Inactivity restarts are infrastructure recovery, not verification failures. `task.attemptCount` is NOT incremented. The same attempt continues after the restart. This means:
- A task with `maxAttempts: 5` still gets 5 verification attempts
- Each verification attempt can have up to 3 inactivity restarts within it

### Both Runtimes Supported

The restart uses the same `continueSession: true` parameter that already handles both:
- **Claude Code**: Entrypoint adds `--continue` flag
- **Codex**: Entrypoint uses `codex exec resume --json` with `CODEX_THREAD_ID`

No runtime-specific logic needed in the inactivity timeout.

### Task Type

Add to the `Task` interface:

```typescript
interface Task {
  // ... existing fields
  inactivityRestartCount?: number; // Total inactivity restarts for this task
}
```

### Logging

Each inactivity restart produces a clear audit trail:

```
14:32:15 [system] Inactivity timeout: no output for 600s — killing worker and restarting (restart 1/3)
14:32:15 [orchestrator] Inactivity restart triggered: taskId=task_abc123 restartCount=1/3
14:32:17 [orchestrator] Worker destroyed for inactivity restart
14:32:18 [prompt] Your previous session became unresponsive (no output for 10 minutes)...
14:32:20 [orchestrator] Inactivity restart attempt started: taskId=task_abc123
```

### Configuration

Constants in `task-dispatcher.ts`:

```typescript
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_INACTIVITY_RESTARTS = 3;
```

Not configurable per-task in the initial implementation. Can be made per-task later by reading from the task config.

## Files Changed

| File                                                                           | Change                                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/activity-timeout-manager.ts`                | **New** — `ActivityTimeoutManager` class                                                         |
| `workers/orchestrator/src/services/__tests__/activity-timeout-manager.test.ts` | **New** — unit tests with fake timers                                                            |
| `workers/orchestrator/src/services/task-dispatcher.ts`                         | Wire up manager: create in constructor, call `start/touch/stop`, add `handleInactivityRestart()` |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`                   | Integration tests for the inactivity restart flow                                                |
| `workers/orchestrator/src/types/task.ts` (or equivalent)                       | Add `inactivityRestartCount` field to `Task` type                                                |

## Testing Strategy

### Unit Tests (ActivityTimeoutManager)

- `start()` → timeout fires after configured delay
- `touch()` → resets the timer
- `stop()` → prevents timeout from firing
- `recordRestart()` → increments counter, returns false when max exceeded
- `resetRestartCount()` → resets consecutive counter
- `touch()` after restart → resets consecutive counter
- `stopAll()` → clears all timers

### Integration Tests (TaskDispatcher)

- Worker silent for 10 minutes → inactivity restart triggered
- Worker produces output → no restart
- Worker silent, restart, then produces output → consecutive counter resets
- 3 consecutive restarts → task fails with `TASK_INACTIVITY_TIMEOUT`
- Inactivity restart during completion → no double handling
- Inactivity restart + hard timeout → hard timeout wins
- Restart prompt uses `continueSession: true`
- `attemptCount` not incremented on inactivity restart
- `task.inactivityRestartCount` persisted to Firestore

## Non-Goals

- Per-task timeout configuration (future enhancement)
- Smart output classification (distinguishing "meaningful" output from noise like blank lines) — all Docker stream data counts as activity
- Modifying the Docker image or entrypoint — all logic stays in the orchestrator
