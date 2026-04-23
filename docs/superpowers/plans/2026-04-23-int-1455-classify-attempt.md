# INT-1455 — Classify Infra-Failed Attempts Before Verifier

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the orchestrator from running the completion verifier on attempts that failed at the infrastructure layer (container exit before `[claude] Session init`, empty log window, sub-5s duration). Surface a distinct `WORKER_INFRA_FAILURE` with a sub-reason and abort retries on identical repeat infra failures. Make the UI classifier (`apps/code-agent` `classifyFailure`) treat this as terminal.

**Architecture:**
- New pure function `classifyAttempt({logs, exitCode, durationMs}) => { outcome: 'ran' | 'infra_failed', subReason?, firstErrorLine? }` in `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts`. No I/O, unit-tested in isolation.
- `task-dispatcher.ts` records attempt start time per task in a new `Map<string, number>`; on completion it calls `classifyAttempt` before the verifier. If `infra_failed`, short-circuit verification and finalize with a `WORKER_INFRA_FAILURE` `TaskError`. Otherwise keep the existing verifier flow untouched.
- Attempt history gets a new `taskInfraFailureHistory` field so we can detect same-sub-reason repeats across attempts and abort the retry loop (Step 4).
- `apps/code-agent/src/domain/utils/classifyFailure.ts` returns `'fail'` for `WORKER_INFRA_FAILURE` (mirroring `WORKTREE_LOST` terminal handling) to prevent doomed self-healing retries.

**Tech Stack:** TypeScript (strict mode), Vitest, existing orchestrator DI in `task-dispatcher.ts`. No new libraries.

**Endpoint Changes:**
- Modified: none
- Created: none
- Removed: none
- Unchanged: all HTTP surfaces

---

## File Structure

- **Create:** `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts` — pure classifier function + types + constants (`INFRA_FAILURE_MAX_DURATION_MS = 5000`).
- **Create:** `workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts` — unit tests (clean success, exit≠0 no session init, short duration, zero claude lines, verifier-eligible cases).
- **Modify:** `workers/orchestrator/src/services/task-dispatcher.ts` — track attempt start time, call classifier before verifier, short-circuit on `infra_failed`, add repeat-sub-reason abort logic, new `WORKER_INFRA_FAILURE` `TaskError`.
- **Modify:** `workers/orchestrator/src/types/task.ts` — add `taskInfraFailureHistory?: { attempt: number; subReason: string; createdAt: string }[]` to `Task`.
- **Modify:** `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` — integration test: fake log stream with exit=128 + no session init asserts `error.code === 'WORKER_INFRA_FAILURE'`.
- **Modify:** `apps/code-agent/src/domain/utils/classifyFailure.ts` — return `'fail'` for `WORKER_INFRA_FAILURE`.
- **Modify:** `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts` — add test for `WORKER_INFRA_FAILURE`.

---

### Task 1: Create the pure classifier function

**Files:**
- Create: `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts`
- Test: `workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts
import { describe, expect, it } from 'vitest';
import {
  classifyAttempt,
  INFRA_FAILURE_MAX_DURATION_MS,
} from '../../../services/task-dispatcher/classify-attempt.js';

const sessionInit =
  '[claude] Session init: model=claude-sonnet-4-6 tools=3 mode=bypassPermissions v2.1.41';

describe('classifyAttempt', () => {
  it('returns "ran" when Claude emitted a Session init line (exit 0)', () => {
    const logs = `${sessionInit}\n[claude] Hello world\n`;
    expect(
      classifyAttempt({ logs, exitCode: 0, durationMs: 60_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('returns "ran" when Claude emitted a Session init line even with non-zero exit', () => {
    // Verifier should still run — Claude produced a transcript.
    const logs = `${sessionInit}\n[claude] partial output\n`;
    expect(
      classifyAttempt({ logs, exitCode: 1, durationMs: 60_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('returns infra_failed with container_exit_before_session_init when exitCode != 0 and no Session init', () => {
    const logs = '[entrypoint] starting run-attempt\nfatal: not a git repository\n';
    const result = classifyAttempt({ logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toContain('fatal: not a git repository');
  });

  it('returns infra_failed with duration_below_threshold when duration < threshold and no transcript lines', () => {
    const result = classifyAttempt({ logs: '', exitCode: 0, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    expect(result.subReason).toBe('duration_below_threshold');
  });

  it('duration threshold is exactly 5s (INFRA_FAILURE_MAX_DURATION_MS)', () => {
    expect(INFRA_FAILURE_MAX_DURATION_MS).toBe(5_000);
    // Just at threshold should NOT be infra_failed by duration alone.
    const atThreshold = classifyAttempt({
      logs: '',
      exitCode: 0,
      durationMs: INFRA_FAILURE_MAX_DURATION_MS,
    });
    expect(atThreshold.outcome).toBe('infra_failed'); // zero claude/tool lines triggers it
    expect(atThreshold.subReason).toBe('empty_transcript');
  });

  it('returns infra_failed with empty_transcript when no [claude]/[tool] lines and duration >= threshold', () => {
    const logs = '[orchestrator] starting\n[entrypoint] ready\n';
    const result = classifyAttempt({ logs, exitCode: 0, durationMs: 30_000 });
    expect(result.outcome).toBe('infra_failed');
    expect(result.subReason).toBe('empty_transcript');
  });

  it('returns ran when a [tool] line appears (no session init, but Claude is producing tool events)', () => {
    const logs = '[tool] Read file=/repo/README.md\n';
    expect(
      classifyAttempt({ logs, exitCode: 0, durationMs: 30_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('firstErrorLine is truncated to 500 chars', () => {
    const longError = 'fatal: ' + 'x'.repeat(600);
    const logs = `[entrypoint] booting\n${longError}\n`;
    const result = classifyAttempt({ logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    expect((result.firstErrorLine ?? '').length).toBeLessThanOrEqual(500);
    expect(result.firstErrorLine).toContain('fatal: ');
  });

  it('falls back to a generic firstErrorLine when no obvious error line exists', () => {
    const result = classifyAttempt({ logs: '', exitCode: 128, durationMs: 100 });
    expect(result.outcome).toBe('infra_failed');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toBe(
      'Container exited with code 128 before producing Claude output'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intexuraos/orchestrator vitest run src/__tests__/services/task-dispatcher/classify-attempt.test.ts`

Expected: FAIL with "Cannot find module '.../classify-attempt.js'".

- [ ] **Step 3: Implement classifier**

```ts
// workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts
/**
 * Pure classifier used before the completion verifier runs.
 *
 * INT-1455 — distinguishes infra-layer failures (container/entrypoint aborted
 * before Claude ever produced output) from real Claude transcripts that the
 * verifier should grade. Short-circuiting infra failures keeps the verifier's
 * "missing memory fields" error reserved for actual transcript defects.
 *
 * No I/O, no side effects: the orchestrator calls this with the raw log
 * string, the last exit code, and the attempt's wall-clock duration.
 */

/** Attempts below this duration are treated as infra failures. Tunable. */
export const INFRA_FAILURE_MAX_DURATION_MS = 5_000;

/** Max length for the captured first-error-line included in error.message. */
const FIRST_ERROR_LINE_MAX_LENGTH = 500;

/**
 * Sub-reasons for WORKER_INFRA_FAILURE. Kept as a literal union so tests
 * and downstream consumers can exhaustively match on them.
 */
export type InfraFailureSubReason =
  | 'container_exit_before_session_init'
  | 'entrypoint_failed'
  | 'git_worktree_lost'
  | 'image_pull_failed'
  | 'duration_below_threshold'
  | 'empty_transcript';

export type AttemptClassification =
  | { outcome: 'ran' }
  | {
      outcome: 'infra_failed';
      subReason: InfraFailureSubReason;
      firstErrorLine: string;
    };

export interface ClassifyAttemptInput {
  logs: string;
  exitCode: number | undefined;
  durationMs: number;
}

/**
 * Classify an attempt as either `ran` (Claude produced output) or
 * `infra_failed` (container/entrypoint aborted before Claude ran).
 *
 * Decision order matters:
 * 1. Any `[claude] Session init`, `[claude] ...`, or `[tool] ...` line → `ran`
 *    (we have a transcript; let the verifier grade it).
 * 2. Non-zero exit code AND no Claude output → `container_exit_before_session_init`.
 * 3. No Claude/tool lines regardless of exit code → `empty_transcript`.
 * 4. Sub-threshold duration with no output → `duration_below_threshold`.
 */
export function classifyAttempt(input: ClassifyAttemptInput): AttemptClassification {
  const { logs, exitCode, durationMs } = input;
  const lines = logs.split('\n');

  const hasSessionInit = lines.some((line) => line.includes('[claude] Session init'));
  const hasClaudeOrToolLine = lines.some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('[claude]') || trimmed.startsWith('[tool]');
  });

  if (hasSessionInit || hasClaudeOrToolLine) {
    return { outcome: 'ran' };
  }

  // No Claude transcript. Decide which sub-reason best describes the failure.
  if (exitCode !== undefined && exitCode !== 0) {
    return {
      outcome: 'infra_failed',
      subReason: 'container_exit_before_session_init',
      firstErrorLine: pickFirstErrorLine(lines, exitCode),
    };
  }

  if (durationMs < INFRA_FAILURE_MAX_DURATION_MS) {
    return {
      outcome: 'infra_failed',
      subReason: 'duration_below_threshold',
      firstErrorLine: pickFirstErrorLine(lines, exitCode),
    };
  }

  return {
    outcome: 'infra_failed',
    subReason: 'empty_transcript',
    firstErrorLine: pickFirstErrorLine(lines, exitCode),
  };
}

function pickFirstErrorLine(lines: readonly string[], exitCode: number | undefined): string {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^(fatal:|error:|panic:)/i.test(line)) {
      return truncate(line);
    }
  }
  // Fallback: no obvious error line. Describe the symptom.
  if (exitCode !== undefined && exitCode !== 0) {
    return `Container exited with code ${String(exitCode)} before producing Claude output`;
  }
  return 'Attempt produced no Claude or tool output';
}

function truncate(line: string): string {
  if (line.length <= FIRST_ERROR_LINE_MAX_LENGTH) return line;
  return line.slice(0, FIRST_ERROR_LINE_MAX_LENGTH);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intexuraos/orchestrator vitest run src/__tests__/services/task-dispatcher/classify-attempt.test.ts`

Expected: PASS for all test cases.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts
git commit -m "feat(orchestrator): add classifyAttempt pure function [INT-1455]"
```

---

### Task 2: Extend Task type with infra-failure history

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts:26-106`

- [ ] **Step 1: Add `taskInfraFailureHistory` field to `Task` interface**

Locate the `Task` interface (near `verificationHistory?: TaskVerificationRecord[];`) and add the new field plus its record type.

Add above `Task` (near `TaskVerificationRecord`):

```ts
export interface TaskInfraFailureRecord {
  attempt: number;
  subReason: string;
  createdAt: string;
}
```

Add inside `Task` (next to `verificationHistory`):

```ts
  /**
   * Records of attempts classified as WORKER_INFRA_FAILURE.
   * Used to abort retries when the same sub-reason repeats across attempts
   * (e.g. `git_worktree_lost` N vs N-1) — re-running Claude cannot fix infra.
   */
  taskInfraFailureHistory?: TaskInfraFailureRecord[];
```

- [ ] **Step 2: Compile-check**

Run: `pnpm --filter @intexuraos/orchestrator exec tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/types/task.ts
git commit -m "feat(orchestrator): add taskInfraFailureHistory to Task [INT-1455]"
```

---

### Task 3: Wire classifier into `task-dispatcher.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` — around line 141 (add `attemptStartedAt` map), lines 1403–1438 (classify before verifier), and the `startWorkerAttempt` path where we record attempt start.

- [ ] **Step 1: Add imports and a per-task start-time map**

Near the existing `Map` declarations around line 141 in `task-dispatcher.ts`:

```ts
  private readonly attemptStartedAt = new Map<string, number>();
```

Add the import near existing task-dispatcher submodule imports:

```ts
import {
  classifyAttempt,
  type AttemptClassification,
  type InfraFailureSubReason,
} from './task-dispatcher/classify-attempt.js';
```

- [ ] **Step 2: Record attempt start time in `startWorkerAttempt`**

Inside `startWorkerAttempt` (around line 2077 where `this.lastOutputAt.set(task.taskId, Date.now())` is), add the sibling line immediately after:

```ts
    this.attemptStartedAt.set(task.taskId, Date.now());
```

Also clear it wherever `taskExitCodes.delete(task.taskId)` already runs. Add `this.attemptStartedAt.delete(task.taskId);` next to every one of those deletes (locations: lines ~625, ~1057, ~1365, ~1589, ~1689, ~2076; search for `this.taskExitCodes.delete(task.taskId)` / `this.taskExitCodes.delete(taskId)` and add the sibling call).

- [ ] **Step 3: Classify before running the verifier**

Insert the classifier call **between** the `const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);` line (around 1413) and the `Running completion verification:` log. Replace the block from line 1413 up to the verifier call with:

```ts
    const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);

    // INT-1455: Classify the attempt before calling the verifier. An attempt
    // that never produced Claude output must not be graded as a broken
    // transcript — that hides the real infra failure behind a policy-looking
    // "missing memory fields" error.
    const attemptStart = this.attemptStartedAt.get(task.taskId);
    const attemptDurationMs =
      attemptStart !== undefined ? Date.now() - attemptStart : Number.POSITIVE_INFINITY;
    const classification: AttemptClassification = classifyAttempt({
      logs: rawLogs,
      exitCode,
      durationMs: attemptDurationMs,
    });
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Attempt classified: ran=${String(classification.outcome === 'ran')}${
        classification.outcome === 'infra_failed'
          ? ` reason=${classification.subReason} exitCode=${String(exitCode ?? 'unknown')}`
          : ''
      }`
    );
    if (classification.outcome === 'infra_failed') {
      await this.finalizeAttemptAsInfraFailure(task, attempt, classification, result);
      return;
    }

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Running completion verification: attempt=${String(attempt)}/${String(maxAttempts)}`
    );
    const verification = await this.completionVerifier.verify({
```

- [ ] **Step 4: Add the `finalizeAttemptAsInfraFailure` helper**

Add near the other finalize helpers inside `TaskDispatcher` (same visibility as the existing `finalizeTask` / `buildResultFromVerification`):

```ts
  /**
   * INT-1455: Finalize an attempt classified as `infra_failed`. Skips the
   * verifier entirely and writes a `WORKER_INFRA_FAILURE` TaskError. If the
   * same sub-reason was observed on the previous attempt, abort retries —
   * re-running Claude cannot fix infra.
   */
  private async finalizeAttemptAsInfraFailure(
    task: Task,
    attempt: number,
    classification: Extract<AttemptClassification, { outcome: 'infra_failed' }>,
    result: TaskResult | undefined
  ): Promise<void> {
    const { subReason, firstErrorLine } = classification;
    const history = task.taskInfraFailureHistory ?? [];
    const previous = history[history.length - 1];
    const repeatedSubReason = previous?.subReason === subReason;

    task.taskInfraFailureHistory = [
      ...history,
      { attempt, subReason, createdAt: new Date().toISOString() },
    ];

    if (repeatedSubReason) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Repeat infra failure (${subReason}) on attempt ${String(attempt)}; aborting retries`
      );
    }

    const error: TaskError = {
      code: 'WORKER_INFRA_FAILURE',
      message: firstErrorLine,
      remediation: repeatedSubReason
        ? { action: 'contact_support', manualSteps: [`Repeat infra failure: ${subReason}`] }
        : { action: 'retry', manualSteps: [`Infra failure: ${subReason}`] },
    };

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: worker infra failure (${subReason})`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
  }
```

- [ ] **Step 5: Compile + run existing task-dispatcher tests**

Run:

```bash
pnpm --filter @intexuraos/orchestrator exec tsc --noEmit
pnpm --filter @intexuraos/orchestrator vitest run src/__tests__/task-dispatcher.test.ts
```

Expected: clean compile. Tests that used to reach the verifier on an empty-log attempt will now hit the infra path — triage any failure and update the test's setup so it provides at least one `[claude] Session init` line when it expects the verifier path. We address new integration coverage in Task 4.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts
git commit -m "feat(orchestrator): short-circuit verifier on infra failures [INT-1455]"
```

---

### Task 4: Integration test — exit=128 finalizes as WORKER_INFRA_FAILURE

**Files:**
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` — add a new `describe('WORKER_INFRA_FAILURE classification', ...)` block at the end of the file.

- [ ] **Step 1: Write the failing test**

Append to `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`. Use the existing harness to stand up a dispatcher + fake isolation provider. Search the file for `describe('ask agent skip verification'` or similar end-of-file tests to locate the nearest working fixture and copy its bootstrap. Then add:

```ts
  describe('WORKER_INFRA_FAILURE classification (INT-1455)', () => {
    it('finalizes attempt as WORKER_INFRA_FAILURE when exit!=0 and no Session init line', async () => {
      // Reuse the nearest existing harness factory — NOT a new ad-hoc setup.
      // We assume a helper like `buildDispatcherHarness()` exists near the
      // other end-of-file tests. If the helper name differs, follow the
      // pattern of the adjacent describe block.
      const harness = await buildDispatcherHarness();
      const { dispatcher, isolationProvider, taskId } = harness;

      // Simulate an attempt where the container exits 128 and produces only
      // a single infra-layer error line (no [claude] Session init).
      vi.mocked(isolationProvider.getWorkerLogs).mockResolvedValueOnce(
        '[entrypoint] starting run-attempt\nfatal: not a git repository: /repo/.git/worktrees/stale\n'
      );
      await harness.signalAttemptCompleted({ exitCode: 128 });

      await harness.waitForTerminalStatus();
      const task = await dispatcher.getTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.error?.code).toBe('WORKER_INFRA_FAILURE');
      expect(task?.error?.message).toContain('fatal: not a git repository');
      expect(task?.taskInfraFailureHistory?.[0]?.subReason).toBe(
        'container_exit_before_session_init'
      );
    });

    it('does not call the verifier when classification is infra_failed', async () => {
      const harness = await buildDispatcherHarness();
      const { isolationProvider, completionVerifier } = harness;

      vi.mocked(isolationProvider.getWorkerLogs).mockResolvedValueOnce(
        '[entrypoint] booting\nfatal: oops\n'
      );
      await harness.signalAttemptCompleted({ exitCode: 128 });
      await harness.waitForTerminalStatus();

      expect(completionVerifier.verify).not.toHaveBeenCalled();
    });
  });
```

> Note: the two helper names (`buildDispatcherHarness`, `signalAttemptCompleted`, `waitForTerminalStatus`) are placeholders matching the existing test conventions — when executing this task, open `task-dispatcher.test.ts`, find the real fixture factory used by adjacent tests (search for `new TaskDispatcher(` or `setUpDispatcher(` / `makeDispatcher(`) and adapt the test to whatever that harness exposes. If no reusable harness exists, copy the minimal setup from a nearby `it(` block verbatim.

- [ ] **Step 2: Run the test to verify it fails (or passes if already implemented)**

Run: `pnpm --filter @intexuraos/orchestrator vitest run src/__tests__/task-dispatcher.test.ts -t "WORKER_INFRA_FAILURE classification"`

Expected: PASS (because Task 3 already implemented the code). If it fails, it will be because of the test harness adaptation — fix the test to match the actual harness, not the production code.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "test(orchestrator): WORKER_INFRA_FAILURE finalization [INT-1455]"
```

---

### Task 5: Make `classifyFailure` treat WORKER_INFRA_FAILURE as terminal

**Files:**
- Modify: `apps/code-agent/src/domain/utils/classifyFailure.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts` inside the `describe('classifyFailure', ...)`:

```ts
  // INT-1455: WORKER_INFRA_FAILURE is terminal — the verifier was skipped
  // because the attempt never produced a Claude transcript. Re-running Claude
  // cannot fix container/entrypoint failures.
  it('returns "fail" for WORKER_INFRA_FAILURE even when orchestrator attaches a retry remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKER_INFRA_FAILURE',
        message: 'fatal: not a git repository',
        remediation: { action: 'retry' },
      })
    ).toBe('fail' satisfies FailureVerdict);
  });

  it('returns "fail" for WORKER_INFRA_FAILURE without remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKER_INFRA_FAILURE',
        message: 'fatal: not a git repository',
      })
    ).toBe('fail' satisfies FailureVerdict);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @intexuraos/code-agent vitest run src/__tests__/domain/utils/classifyFailure.test.ts`

Expected: FAIL — current code returns `'retry'` when `remediation.action === 'retry'`.

- [ ] **Step 3: Implement the fix**

Edit `apps/code-agent/src/domain/utils/classifyFailure.ts`. Duplicate the existing `WORKTREE_LOST` terminal branch to also handle `WORKER_INFRA_FAILURE`:

Replace:

```ts
  // INT-1454: Worktree metadata was lost on adoption and could not be
  // repaired. The task's in-container state is unrecoverable; silently
  // looping on retries would just repeat exit-128 for every git command.
  // Fail permanently so the UI surfaces it.
  if (errorCode === 'WORKTREE_LOST') {
    return 'fail';
  }
```

With:

```ts
  // INT-1454: Worktree metadata was lost on adoption and could not be
  // repaired. The task's in-container state is unrecoverable; silently
  // looping on retries would just repeat exit-128 for every git command.
  // Fail permanently so the UI surfaces it.
  if (errorCode === 'WORKTREE_LOST') {
    return 'fail';
  }

  // INT-1455: Worker infra failure — the container exited before Claude ever
  // ran (git worktree lost, entrypoint crash, image pull failure, etc.).
  // Re-dispatching Claude cannot fix infra; surface it as terminal so users
  // see the real cause instead of a policy-looking "missing fields" message.
  if (errorCode === 'WORKER_INFRA_FAILURE') {
    return 'fail';
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @intexuraos/code-agent vitest run src/__tests__/domain/utils/classifyFailure.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/utils/classifyFailure.ts \
        apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts
git commit -m "feat(code-agent): classify WORKER_INFRA_FAILURE as terminal [INT-1455]"
```

---

### Task 6: Full repo CI

- [ ] **Step 1: Run `pnpm run ci:tracked` and capture output**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1455.txt
```

Expected: all workspaces pass. If any workspace fails, fix and re-run — do not open the PR until green.

- [ ] **Step 2: Commit any follow-up fixes**

If CI surfaced issues, land the fixes in the smallest possible commit(s) and re-run CI.

---

## Self-Review

- **Spec coverage:**
  - Step 1 (define short-circuit conditions) → Task 1 (all three branches + pure function).
  - Step 2 (new error codes) → `WORKER_INFRA_FAILURE` with sub-reasons defined in Task 1's `InfraFailureSubReason` union. `TASK_COMPLETION_VERIFICATION_FAILED` remains reserved to the verifier-post-transcript branch (untouched by this change).
  - Step 3 (orchestrator wiring) → Task 3.
  - Step 4 (multi-attempt handling, same sub-reason abort) → Task 3, `finalizeAttemptAsInfraFailure` + `taskInfraFailureHistory`.
  - Step 5 (UI / downstream surfaces) → Task 5 makes `classifyFailure` terminal. The web app already renders `task.error.message` verbatim; the distinct `WORKER_INFRA_FAILURE` code means triage dashboards and logs can filter on it. Remediation-task creation (`createRemediationTask`) is only triggered by review flows, not task-failure triage, so it is already unreachable for `WORKER_INFRA_FAILURE` — no change needed.
  - Step 6 (tests) → Task 1 (pure-function unit tests), Task 4 (integration), Task 5 (classifier coverage).

- **Placeholder scan:** No TBDs. The one "find nearest harness" note in Task 4 Step 1 is scoped to an existing pattern lookup, not a skipped implementation.

- **Type consistency:** `AttemptClassification`, `InfraFailureSubReason`, `TaskInfraFailureRecord`, and `TaskError` names match across tasks.
