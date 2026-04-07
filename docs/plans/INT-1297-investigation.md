# INT-1297: Investigation — Successful code tasks reporting as failed (exit code 137)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `detectFatalExitCode` false positives caused by matching test fixture text in Claude's stream-json output.

**Architecture:** Restrict the fatal exit code regex to search only the last few lines of raw logs instead of the entire string. The actual `[entrypoint]` exit line is always near the end.

**Tech Stack:** TypeScript, Vitest

---

## Investigation Summary

**Date:** 2026-04-05
**Failed task:** `task_3a56cc5e-7c21-48a1-97ce-8898d5e3f945` (remediation for INT-1295)
**Symptom:** Remediation task completed all work, pushed commits, CI passed — but was marked `failed` with `TASK_FATAL_EXIT_CODE` / `fatal_exit_code_137`.

## Root Cause

`detectFatalExitCode()` in `workers/orchestrator/src/services/completion-verifier.ts:200-206` uses an **unanchored regex** against the **entire** `rawLogs` string:

```typescript
const FATAL_EXIT_CODE_PATTERN =
  /\[entrypoint\] (?:Claude|Codex) attempt finished with exit code: (137|139)/;

export function detectFatalExitCode(rawLogs: string): number | undefined {
  const match = FATAL_EXIT_CODE_PATTERN.exec(rawLogs);
  if (match?.[1] !== undefined) {
    return Number(match[1]);
  }
  return undefined;
}
```

The `rawLogs` includes Claude's full verbose stream-json output (via the Docker exec's `attemptLogBuffer`). When Claude reads or diffs files containing the pattern text, that text appears in the raw output.

### Trigger

The remediation task was modifying `completion-verifier.test.ts`, which contains this test fixture at **line 1227**:

```typescript
const logs =
  'some output\n[entrypoint] Claude attempt finished with exit code: 137\nfinal line';
```

When Claude read/diffed this file, the stream-json output included the source code text. The regex matched this test fixture instead of the actual entrypoint exit line.

### Evidence Chain

| Time (UTC)   | Event                                                                          | Source                               |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------ |
| 21:52:44     | Claude diffs `completion-verifier.test.ts` (contains `exit code: 137` fixture) | Firestore log_lines                  |
| 21:59:09.875 | `[entrypoint] Claude attempt finished with exit code: 0`                       | Actual entrypoint                    |
| 21:59:10.379 | `Worker attempt completed: exitCode=0`                                         | Orchestrator (from exec inspect)     |
| 21:59:15.209 | `Passed: false \                                                               | VerifierFailure: false`              | Completion verifier |
| 21:59:15.209 | `Missing fields: fatal_exit_code_137`                                          | **False positive match**             |
| 21:59:15.209 | `Fatal exit code detected (fatal_exit_code_137)`                               | Task dispatcher → task marked failed |

### Data Flow

```
Docker exec runs /entrypoint.sh run-attempt
  └─ Claude runs with --verbose --output-format stream-json
      └─ Claude reads completion-verifier.test.ts (contains "exit code: 137" in test fixture)
          └─ Stream-json output includes file content in tool results
              └─ attemptLogBuffer captures raw exec output
                  └─ getWorkerLogs() returns containerLogs + attemptLogBuffer as rawLogs
                      └─ detectFatalExitCode(rawLogs) matches test fixture text
                          └─ Returns 137 instead of undefined
                              └─ Task marked as failed despite exitCode=0
```

## Fix

### Task 1: Restrict `detectFatalExitCode` to search only the tail of raw logs

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:197-206`
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts:1224-1249`

- [ ] **Step 1: Write a failing test for the false positive scenario**

Add a test that reproduces the exact bug: raw logs contain the pattern in the MIDDLE (from Claude's output of test code) but the ACTUAL entrypoint exit line at the end shows exit code 0.

```typescript
it('returns undefined when pattern appears mid-stream but actual exit is 0', () => {
  const logs = [
    'some earlier output',
    '{"type":"result","content":"const logs = \'some output\\n[entrypoint] Claude attempt finished with exit code: 137\\nfinal line\';"}',
    '[entrypoint] Claude attempt finished with exit code: 0',
    'final line',
  ].join('\n');
  expect(detectFatalExitCode(logs)).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter orchestrator vitest run src/services/__tests__/completion-verifier.test.ts -t "returns undefined when pattern appears mid-stream"`
Expected: FAIL — current implementation returns 137

- [ ] **Step 3: Fix `detectFatalExitCode` to search only the last 5 lines**

In `workers/orchestrator/src/services/completion-verifier.ts`, change `detectFatalExitCode`:

```typescript
export function detectFatalExitCode(rawLogs: string): number | undefined {
  // Only search the last 5 lines to avoid false positives from Claude's
  // stream-json output containing test fixtures or code snippets with the pattern.
  // The actual [entrypoint] exit line is always near the end of raw logs.
  const tail = rawLogs.split('\n').slice(-5).join('\n');
  const match = FATAL_EXIT_CODE_PATTERN.exec(tail);
  if (match?.[1] !== undefined) {
    return Number(match[1]);
  }
  return undefined;
}
```

- [ ] **Step 4: Run all completion-verifier tests**

Run: `pnpm --filter orchestrator vitest run src/services/__tests__/completion-verifier.test.ts`
Expected: ALL PASS (existing tests still pass because their fixtures have the pattern at the end)

- [ ] **Step 5: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "fix(orchestrator): restrict detectFatalExitCode to tail of raw logs

Prevents false positives when Claude's stream-json output contains test
fixtures or code snippets with the [entrypoint] exit code pattern.

Fixes INT-1297"
```
