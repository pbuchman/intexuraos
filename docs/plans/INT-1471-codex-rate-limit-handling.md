# INT-1471: Fix PR Agent failures when hitting Codex rate limits

> **For agentic workers:** Execute this plan task-by-task. Each task lists exact files, tests, and commands. TDD required — write the failing test first, confirm failure, implement, confirm pass, commit.

**Linear:** [INT-1471](https://linear.app/pbuchman/issue/INT-1471/fix-pr-agent-failures-when-hitting-llm-rate-limits)

**Goal:** When the Codex CLI exits non-zero because the user hit the ChatGPT / Codex usage limit, the orchestrator must treat the attempt the same way it treats a Claude rate-limit exit — the attempt is classified as "ran", the runtime-hard-error message surfaces the rate-limit phrasing, and the code-agent retries after a cool-off instead of finalizing with a terminal `WORKER_INFRA_FAILURE`.

**Architecture:**
- `classifyAttempt()` today only recognizes Claude session markers (`[claude] Session init`, `"type":"system"` + `"subtype":"init"`, `[claude]`/`[tool]`, `"type":"assistant"`, `"type":"tool_use"`). A Codex-only attempt has none of those, so even when Codex emits `thread.started` + `turn.started` + `turn.failed{error:"…usage limit…"}` the classifier short-circuits to `infra_failed / container_exit_before_session_init` and the code-agent's `classifyFailure()` returns `fail` permanently — no retry.
- Fix is local to the orchestrator: make `classifyAttempt` runtime-aware by adding Codex session signals and by replacing the hard-coded "Claude output" wording in the fallback error line with runtime-agnostic phrasing. Once classification is correct, the existing `codex-log-processor` path already emits `attempt_failed` with the rate-limit message, the dispatcher finalizes it as `TASK_RUNTIME_HARD_ERROR`, and the existing regex in `apps/code-agent/src/domain/utils/classifyFailure.ts` (`/429|rate limit|hit your limit|usage limit|limit · resets/i`) matches "hit your usage limit" → `retry_after_cooloff`. No code-agent changes required beyond adding parity tests.

**Tech Stack:** TypeScript (strict), vitest, pnpm workspaces.

**Endpoint Changes:**
- Modified: none
- Created: none
- Removed: none
- Unchanged: all HTTP endpoints

---

## File Structure

**Modify:**
- `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts` — accept a `runtime: WorkerRuntime` input, add Codex "ran" signals, generalize the fallback error line.
- `workers/orchestrator/src/services/task-dispatcher.ts` — pass `task.runtime` (or the default) into `classifyAttempt`.
- `workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts` — add Codex parity tests (ran detection, rate-limit hand-off, generic error line wording).
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` — update or add a test that simulates a Codex attempt hitting the usage limit and asserts the emitted `TaskError` is `TASK_RUNTIME_HARD_ERROR` carrying the rate-limit message (NOT `WORKER_INFRA_FAILURE`).
- `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts` (create if missing under that path — otherwise the nearest `classifyFailure` test file) — add a parity assertion that the Codex usage-limit wording routes to `retry_after_cooloff`.

**No new files.** All other files remain unchanged.

---

## Task 1: Runtime-aware `classifyAttempt` — red test

**Files:**
- Test: `workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts`

- [ ] **Step 1: Add failing tests for the Codex path and the generic wording**

Append these tests to the existing `describe('classifyAttempt', ...)` block:

```ts
  it('returns "ran" when a Codex attempt emitted a thread.started event (exit 1 from rate limit)', () => {
    const logs =
      '[entrypoint] GitHub token loaded and git credential configured\n' +
      '[codex] Session started: thread=019dc00d-fb13-7e30-b21d-a77982c54bab\n' +
      '[codex] Turn started\n' +
      '[error] You\'ve hit your usage limit.\n' +
      '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}\n' +
      '[entrypoint] Codex attempt finished with exit code: 1\n';
    expect(
      classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 4_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('returns "ran" when Codex logs contain only a stream-JSON thread.started event', () => {
    const logs =
      '2026-04-24T17:13:54.013Z {"type":"thread.started","thread_id":"t-1"}\n';
    expect(
      classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 3_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('returns "ran" when Codex logs contain a turn.started event', () => {
    const logs = '{"type":"turn.started"}\n';
    expect(
      classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 3_000 })
    ).toEqual({ outcome: 'ran' });
  });

  it('uses runtime-agnostic wording in the generic fallback firstErrorLine', () => {
    const claudeResult = classifyAttempt({
      runtime: 'claude',
      logs: '',
      exitCode: 128,
      durationMs: 100,
    });
    expect(claudeResult.outcome).toBe('infra_failed');
    if (claudeResult.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(claudeResult.firstErrorLine).toBe(
      'Container exited with code 128 before producing agent output'
    );

    const codexResult = classifyAttempt({
      runtime: 'codex',
      logs: '',
      exitCode: 1,
      durationMs: 100,
    });
    expect(codexResult.outcome).toBe('infra_failed');
    if (codexResult.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(codexResult.firstErrorLine).toBe(
      'Container exited with code 1 before producing agent output'
    );
  });

  it('claude runtime still treats codex-only signals as NOT ran (runtime is honored, not just any JSON)', () => {
    // Defensive: a stray `thread.started` in claude logs (unexpected) must not be
    // treated as a claude attempt having run — the runtime param is load-bearing.
    const logs = '{"type":"thread.started","thread_id":"x"}\n';
    const res = classifyAttempt({ runtime: 'claude', logs, exitCode: 1, durationMs: 1_000 });
    expect(res.outcome).toBe('infra_failed');
    if (res.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(res.subReason).toBe('container_exit_before_session_init');
  });
```

Also update the existing `'falls back to a generic firstErrorLine when no obvious error line exists'` test: its expectation `'Container exited with code 128 before producing Claude output'` must become `'Container exited with code 128 before producing agent output'`, and it must pass `runtime: 'claude'` in the input.

And update every other existing test that calls `classifyAttempt(...)` to pass `runtime: 'claude'` explicitly — the new signature makes `runtime` required. The failing tests above are the NEW coverage; the existing tests simply need the required field added. Do not loosen any existing assertion.

- [ ] **Step 2: Run the tests and verify they fail**

Run:
```bash
pnpm --filter orchestrator test -- classify-attempt
```

Expected failures:
- New Codex tests fail with either a compile error (`runtime` not in `ClassifyAttemptInput`) OR, once the type compiles, with the classifier returning `infra_failed` instead of `ran`.
- The updated generic-fallback test fails because the string still says "Claude output".

Do NOT proceed until every new test is failing for the intended reason.

- [ ] **Step 3: Commit the red tests**

```bash
git add workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts
git commit -m "test(orchestrator): add failing tests for runtime-aware classifyAttempt and generic fallback wording

Covers Codex ran-detection (thread.started, turn.started, [codex] session) and the new
runtime-agnostic 'producing agent output' fallback line. [INT-1471]"
```

---

## Task 2: Implement runtime-aware `classifyAttempt`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts`

- [ ] **Step 1: Extend the input type and signals**

Replace the body of `classify-attempt.ts` with the following (keep the top-of-file comment block; update it to mention Codex):

```ts
/**
 * Pure classifier used before the completion verifier runs.
 *
 * INT-1455 — distinguishes infra-layer failures (container/entrypoint aborted
 * before the runtime ever produced output) from real transcripts that the
 * verifier should grade.
 *
 * INT-1471 — runtime-aware: recognizes Codex session/turn markers so a Codex
 * attempt that failed mid-turn (e.g. usage-limit exit 1) is classified as
 * `ran`, which routes through the normal runtime-hard-error path instead of
 * the terminal WORKER_INFRA_FAILURE path.
 */

import type { WorkerRuntime } from '../runtime/types.js';
import type { InfraFailureSubReason } from '../../types/task.js';

export type { InfraFailureSubReason } from '../../types/task.js';

/** Attempts below this duration are treated as infra failures. Tunable. */
export const INFRA_FAILURE_MAX_DURATION_MS = 5_000;

const FIRST_ERROR_LINE_MAX_LENGTH = 500;

export type AttemptClassification =
  | { outcome: 'ran' }
  | {
      outcome: 'infra_failed';
      subReason: InfraFailureSubReason;
      firstErrorLine: string;
    };

export interface ClassifyAttemptInput {
  runtime: WorkerRuntime;
  logs: string;
  exitCode: number | undefined; // @allow-undefined-type -- orchestrator tracks optional exit codes
  durationMs: number;
  result?: {
    prUrl?: string | null | undefined; // @allow-undefined-type -- TaskResult.prUrl is optional/nullable
  };
}

function hasClaudeRanSignal(lines: readonly string[]): boolean {
  const hasSessionInit = lines.some((line) => line.includes('[claude] Session init'));
  const hasClaudeOrToolLine = lines.some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('[claude]') || trimmed.startsWith('[tool]');
  });
  const hasStreamJsonInit = lines.some(
    (line) => line.includes('"type":"system"') && line.includes('"subtype":"init"')
  );
  const hasAssistantEvent = lines.some(
    (line) => line.includes('"type":"assistant"') || line.includes('"type":"tool_use"')
  );
  return hasSessionInit || hasClaudeOrToolLine || hasStreamJsonInit || hasAssistantEvent;
}

function hasCodexRanSignal(lines: readonly string[]): boolean {
  // Mirrors the markers emitted by workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts
  // and the raw JSON events produced by `codex exec --json` (thread.started,
  // turn.started). Any of these proves Codex authenticated and began a turn,
  // so a later non-zero exit (e.g. turn.failed from a usage-limit) must flow
  // through the runtime-hard-error path, not infra_failed.
  const hasCodexPrefix = lines.some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('[codex]') || trimmed.startsWith('[msg]') || trimmed.startsWith('[cmd]');
  });
  const hasThreadStarted = lines.some((line) => line.includes('"type":"thread.started"'));
  const hasTurnStarted = lines.some((line) => line.includes('"type":"turn.started"'));
  const hasTurnCompleted = lines.some((line) => line.includes('"type":"turn.completed"'));
  const hasTurnFailed = lines.some((line) => line.includes('"type":"turn.failed"'));
  return hasCodexPrefix || hasThreadStarted || hasTurnStarted || hasTurnCompleted || hasTurnFailed;
}

export function classifyAttempt(input: ClassifyAttemptInput): AttemptClassification {
  const { runtime, logs, exitCode, durationMs, result } = input;

  const prUrl = result?.prUrl;
  if (prUrl !== undefined && prUrl !== null && prUrl !== '') {
    return { outcome: 'ran' };
  }

  const lines = logs.split('\n');

  const ran = runtime === 'codex' ? hasCodexRanSignal(lines) : hasClaudeRanSignal(lines);
  if (ran) {
    return { outcome: 'ran' };
  }

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
  if (exitCode !== undefined && exitCode !== 0) {
    return `Container exited with code ${String(exitCode)} before producing agent output`;
  }
  return 'Attempt produced no agent or tool output';
}

function truncate(line: string): string {
  if (line.length <= FIRST_ERROR_LINE_MAX_LENGTH) return line;
  return line.slice(0, FIRST_ERROR_LINE_MAX_LENGTH);
}
```

Two wording changes outside the tested paths:
- "before producing Claude output" → "before producing agent output"
- "Attempt produced no Claude or tool output" → "Attempt produced no agent or tool output"

Both were Claude-specific and cover the issue's second requirement.

- [ ] **Step 2: Run the classify-attempt tests and verify they pass**

```bash
pnpm --filter orchestrator test -- classify-attempt
```

Expected: all tests (existing + new) pass. If any existing test still says "Claude output", update its expectation to "agent output" in that same test file — DO NOT revert this file.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts
git commit -m "feat(orchestrator): make classifyAttempt runtime-aware and generalize error wording

- Accept a required 'runtime: WorkerRuntime' input and branch ran-detection per runtime.
- Codex ran-signals: [codex]/[msg]/[cmd] prefixes and thread.started/turn.started/turn.completed/turn.failed stream-JSON events.
- Generalize 'producing Claude output' -> 'producing agent output' in the fallback error line.

Unblocks retry-after-cooloff for Codex usage-limit exits. [INT-1471]"
```

---

## Task 3: Thread the runtime through the dispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (the `classifyAttempt({...})` call inside the main attempt-finalization path — currently around line 1439).

- [ ] **Step 1: Locate the call site**

Run:
```bash
grep -n "classifyAttempt({" workers/orchestrator/src/services/task-dispatcher.ts
```

Expected output: one match in the finalization path (the block that builds `ClassifyAttemptInput` from `rawLogs`, `exitCode`, `attemptDurationMs`).

- [ ] **Step 2: Pass the runtime**

Edit that call to include `runtime: task.runtime ?? 'claude'`. `Task.runtime` is `WorkerRuntime | undefined` (see `workers/orchestrator/src/types/task.ts`), and the runtime default in `docker/code-worker/entrypoint.sh` is `claude`. Mirror that default here.

Concretely, change:

```ts
const classification: AttemptClassification = classifyAttempt({
  logs: rawLogs,
  exitCode,
  durationMs: attemptDurationMs,
  ...(result !== undefined ? { result } : {}),
});
```

to:

```ts
const classification: AttemptClassification = classifyAttempt({
  runtime: task.runtime ?? 'claude',
  logs: rawLogs,
  exitCode,
  durationMs: attemptDurationMs,
  ...(result !== undefined ? { result } : {}),
});
```

If there are any OTHER call sites to `classifyAttempt` in `task-dispatcher.ts` (there should not be — verify with grep), update them the same way.

- [ ] **Step 3: Build and run full orchestrator test suite**

```bash
pnpm --filter orchestrator test
```

Expected: all tests pass. Any test that constructed a `classifyAttempt` call without `runtime` will fail at compile time — fix each one by passing `runtime: 'claude'` unless the test is specifically about Codex.

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts
git commit -m "chore(orchestrator): pass task.runtime into classifyAttempt

Defaults to 'claude' when task.runtime is undefined, matching the entrypoint default.
[INT-1471]"
```

---

## Task 4: End-to-end parity test — Codex usage-limit → `TASK_RUNTIME_HARD_ERROR`

**Files:**
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Find the existing Claude rate-limit test for pattern reuse**

Run:
```bash
grep -n "rate limit" workers/orchestrator/src/__tests__/task-dispatcher.test.ts | head -20
```

The test around line ~2491 (`onLog?.('{"type":"turn.failed","error":{"message":"Task failed: rate limited"}}\n');`) is the Codex rate-limit analog we want. Confirm it exists — if it already asserts Codex parity, extend it with the usage-limit wording from this issue. Otherwise add a new test next to it.

- [ ] **Step 2: Write the failing test**

Add (or extend) a test block in the Codex-runtime describe group that:

1. Dispatches a task with `runtime: 'codex'`.
2. Feeds logs via `onLog` that replicate the real incident:
   ```ts
   onLog?.('[codex] Session started: thread=019dc00d\n');
   onLog?.('[codex] Turn started\n');
   onLog?.('[error] You\'ve hit your usage limit. Upgrade to Pro\n');
   onLog?.('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Upgrade to Pro"}}\n');
   ```
3. Simulates exit code `1`.
4. Asserts the `TaskError` written by the dispatcher:
   - `code === 'TASK_RUNTIME_HARD_ERROR'` (NOT `'WORKER_INFRA_FAILURE'`).
   - `message` contains `"hit your usage limit"`.
5. Asserts the orchestrator log output does NOT contain `"reason=container_exit_before_session_init"` for this attempt.

Model the scaffolding on the existing Claude rate-limit test at the top of the file (`task-dispatcher.test.ts` around lines 2302–2506) — reuse the same fakes pattern (`FakeIsolationProvider`, `FakeCompletionVerifier`, etc.) so we keep a single integration harness.

- [ ] **Step 3: Run the test and confirm it fails**

```bash
pnpm --filter orchestrator test -- task-dispatcher
```

Expected: the new test fails because (before the fix) Codex-only logs were classified as `infra_failed` → `WORKER_INFRA_FAILURE`. With Tasks 2 + 3 already merged in this branch it should PASS instead — that's the goal of this task: a green integration guard for the parity path.

If Tasks 2 + 3 are already committed (they are in this plan's ordering), the test should pass immediately. Run it in isolation first with the pre-Task-2 revision to verify it WOULD fail, then revert the stash. (This is a one-off sanity check; skip it if you trust the unit tests already cover the classifier path.)

- [ ] **Step 4: Run full orchestrator suite**

```bash
pnpm --filter orchestrator test
```

Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "test(orchestrator): add Codex usage-limit parity test for TASK_RUNTIME_HARD_ERROR

Simulates the INT-1471 incident (codex session.started + turn.started + turn.failed
with 'hit your usage limit' message, exit code 1). Asserts the TaskError is
TASK_RUNTIME_HARD_ERROR carrying the rate-limit message, NOT WORKER_INFRA_FAILURE.
[INT-1471]"
```

---

## Task 5: code-agent `classifyFailure` parity assertion

**Files:**
- Modify (or create): `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts` (or the co-located `__tests__` file wherever classifyFailure is already tested — grep below).

- [ ] **Step 1: Locate the existing test file**

Run:
```bash
grep -rln "classifyFailure" apps/code-agent/src/__tests__ apps/code-agent/src/domain
```

Use the matching `*.test.ts` — do not create a duplicate file.

- [ ] **Step 2: Add a failing assertion**

Append (inside the existing `describe('classifyFailure', ...)` or equivalent) the following test cases. They must compile and run against the current `classifyFailure` without code changes — the regex in `apps/code-agent/src/domain/utils/classifyFailure.ts` already matches both phrases, but there is currently no explicit coverage for the Codex wording.

```ts
  it('classifies Codex usage-limit TASK_RUNTIME_HARD_ERROR as retry_after_cooloff', () => {
    const verdict = classifyFailure({
      code: 'TASK_RUNTIME_HARD_ERROR',
      message:
        "Non-zero exit code: 1; Codex error: You've hit your usage limit. Upgrade to Pro.",
    });
    expect(verdict).toBe('retry_after_cooloff');
  });

  it('classifies Codex "limit · resets" message as retry_after_cooloff', () => {
    const verdict = classifyFailure({
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: 'Codex error: limit · resets 17:00 UTC',
    });
    expect(verdict).toBe('retry_after_cooloff');
  });
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @intexuraos/code-agent test -- classifyFailure
```

Expected: PASS (the existing regex already covers both phrases). The test exists to prevent future regressions — e.g. if someone narrows the regex to Claude-only wording.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts
git commit -m "test(code-agent): pin Codex usage-limit wording to retry_after_cooloff

Regression guard for INT-1471 — ensures the classifyFailure rate-limit regex keeps
matching both 'hit your usage limit' and 'limit · resets' phrasings emitted by codex."
```

---

## Task 6: Docs + final verification

**Files:**
- Modify: `docs/services/orchestrator/technical-debt.md` only if an existing entry references the hard-coded "Claude output" wording (grep first). Otherwise, skip.

- [ ] **Step 1: Search for stale references to the old wording**

```bash
grep -rn "before producing Claude output" .
grep -rn "Attempt produced no Claude or tool output" .
```

Expected: only the two occurrences replaced in `classify-attempt.ts`. If any other file (doc, fixture, test expectation) still contains the old string, update it to the generalized wording. If a fixture file encodes an old classification decision, leave the fixture alone but add a note in the orchestrator technical-debt doc.

- [ ] **Step 2: Run the full CI gate**

```bash
pnpm run ci:tracked
```

Expected: green. Any failure in any workspace must be fixed before commit.

- [ ] **Step 3: Commit anything the previous step touched**

```bash
git status
git add -p    # review each change
git commit -m "docs: clean up stale 'Claude output' references after INT-1471"
```

Only commit if there are actual changes. If everything was green and no files were touched, skip.

---

## Out of Scope

- Changing the `codex exec` CLI invocation or retry-loop logic inside the code-worker entrypoint. The fix is entirely in the orchestrator's classification layer; the retry loop is already driven by code-agent's `classifyFailure`.
- Adjusting the `retry_after_cooloff` cool-off duration or the max-attempts policy. Those are already wired and out of scope.
- Adding a new `InfraFailureSubReason` value. The existing `container_exit_before_session_init` still applies when the container truly aborts before any runtime-specific marker is emitted — e.g. bootstrap failure, missing secrets. This plan only changes WHEN that sub-reason is assigned for Codex attempts, not its definition.
- Changing the Claude-runtime path. All Claude tests must remain green with identical semantics.

---

## Self-Review Checklist

- [x] Spec coverage: Both issue bullets (Codex rate-limit retry parity + generic error wording) are covered by Tasks 2 and 6 respectively.
- [x] No placeholders: Every step has exact code, exact file paths, exact commands.
- [x] Type consistency: `ClassifyAttemptInput.runtime: WorkerRuntime` is declared in Task 2 and consumed in Task 3 (`task.runtime ?? 'claude'`).
- [x] Ordering: Tests-first within each task; Tasks 1–2 make the classifier correct before Task 3 wires the dispatcher.
- [x] Exit criteria: `pnpm run ci:tracked` green (Task 6).
