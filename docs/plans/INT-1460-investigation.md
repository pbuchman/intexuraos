# INT-1460 — Recent code tasks fail with WORKER_INFRA_FAILURE (empty_transcript)

**Goal:** Document the root cause of the spike in failed code tasks starting 2026-04-23T17:44Z and propose a tightly-scoped fix that restores correct attempt classification without regressing the INT-1455 behavior.

**Architecture:** The fix narrows `classifyAttempt` so it inspects the log sources that actually carry `[claude]`/`[tool]` prefixes (Firestore `log_lines` and/or the log-forwarder's emitted text), or — simpler — it inspects the raw claude stream-JSON that `getWorkerLogs` does return, instead of a formatted string that `getWorkerLogs` never sees. A follow-up hardening step is to short-circuit classification when the orchestrator already has a successful `TaskResult` (PR URL, commits, `_AGENT_FINAL` block).

**Tech Stack:** TypeScript, Vitest, Fastify, Docker/dockerode, Firestore (code_tasks log_lines), Cloud Run logs, the home-dev orchestrator.

---

## 1. Summary

Between **2026-04-23T16:58Z and 18:41Z** every completion-path code task (execution, review, planning) terminated with:

```
error.code    = WORKER_INFRA_FAILURE
error.message = "Attempt produced no Claude or tool output"
```

even when the worker had clearly succeeded (PR created, `_AGENT_FINAL` emitted, exit code 0, CI checks pending/green).

Root cause: **PR #1913 / INT-1455 "Classify infra-failed attempts before completion verifier"**, merged to `development` at **2026-04-23T17:44:16Z**, added `classifyAttempt()` that scans `getWorkerLogs()` for `[claude] Session init` / lines beginning with `[claude]` / `[tool]`. Those formatted strings are produced by the orchestrator's in-process `claude-log-processor.ts` and pushed to Firestore — they **never appear in `getWorkerLogs()` output**, which only contains (a) Docker container stdout (raw claude stream-JSON) and (b) `worker.attemptLogBuffer` (the raw dockerode exec stream). The pre-condition `hasSessionInit || hasClaudeOrToolLine` is therefore always `false` in production, and every attempt that completes after the PR #1913 merge is mis-classified as `empty_transcript` → `WORKER_INFRA_FAILURE` regardless of actual worker success.

## 2. Affected tasks (evidence)

Snapshot of the Firestore `code_tasks` collection, ordered `createdAt desc`, filtered to `status=failed` with `error.code=WORKER_INFRA_FAILURE` (all post-merge):

| Task ID                                   | Linear   | Agent     | Worker   | Created (UTC) | Completed (UTC) | Actual worker outcome                                                   |
| ----------------------------------------- | -------- | --------- | -------- | ------------- | --------------- | ----------------------------------------------------------------------- |
| task_8c27c2db-3761-4031-8696-c1e5aaece940 | INT-1459 | review    | home-dev | 18:29:43      | 18:41:02        | Posted PR #1918 review comment 4164957481, `REVIEW_AGENT_FINAL`, exit 0 |
| task_c5063b1b-bf79-4958-a3bc-46ad78c27bbf | INT-1432 | review    | mac-dev  | 18:28:07      | 18:39:28        | Review completed                                                        |
| task_8a2ab53b-59c1-4dd0-9a01-6a991306141b | INT-1433 | review    | home-dev | 18:27:22      | 18:36:04        | Review completed                                                        |
| task_23b40b10-3fd2-436d-bece-807037177e57 | INT-1456 | review    | mac-dev  | 17:52:58      | 18:33:00        | Review completed                                                        |
| task_83546c07-587c-4554-9028-6d944a95bb2f | INT-1459 | planning  | home-dev | 17:47:00      | 18:30:24        | Planning completed                                                      |
| task_1733b2ef-415e-45bd-b803-6bf2213eb144 | INT-1431 | review    | home-dev | 17:05:29      | 18:17:34        | Review completed                                                        |
| task_05e86475-31c0-4c57-9b01-ce6734ca298c | INT-1432 | execution | mac-dev  | 17:03:15      | 18:28:21        | **PR #1917 opened, 2 commits, exit 0**, classifier rejected             |
| task_6e10870a-91ff-439a-bf2e-fa4d4d747d9f | INT-1433 | execution | home-dev | 16:58:15      | 18:12:25        | Execution completed                                                     |

Three earlier tasks (`task_0ab46e7f`, `task_481fb84e`, `task_d7ca355f`, `task_584cc57b`) failed with `SETUP_FAILED: Failed to start worker container` — these are a **separate, pre-existing** mac-dev container-create issue and are not in scope for this investigation.

Verification command (run from repo root):

```bash
node /tmp/recent-code-tasks.cjs 40
node .claude/skills/debug-code-task/scripts/fetch-task.cjs task_8c27c2db-3761-4031-8696-c1e5aaece940 --logs-only | tail -40
```

Smoking-gun log excerpt (task_8c27c2db, review path that actually succeeded):

```
20:40:26 [claude] REVIEW_AGENT_FINAL: … review_id: 4164957481 …
20:40:27 [entrypoint] Claude attempt finished with exit code: 0
20:40:27 [orchestrator] Worker attempt completed: exitCode=0
20:40:50 [orchestrator] Attempt finished: attempt=1/3 agentType=review
20:40:51 [orchestrator] Result: prUrl=https://github.com/pbuchman/intexuraos/pull/1918 branch=plan/… commits=0 ciFailed=unknown
20:40:51 [orchestrator] Attempt classified: ran=false reason=empty_transcript exitCode=0
20:40:51 [orchestrator] Terminal failure: worker infra failure (empty_transcript)
20:40:51 [orchestrator] Finalizing task: status=failed hasResult=true hasError=true
```

Note `hasResult=true` in the finalize line — the dispatcher simultaneously knew the attempt had produced a real `TaskResult` (with PR URL) AND classified it as infra-failed.

## 3. Root cause

### 3.1 What the classifier reads

`workers/orchestrator/src/services/task-dispatcher.ts:1425` gets logs via:

```ts
const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
```

`workers/orchestrator/src/services/isolation/worker-ops.ts:9-28`:

```ts
const logs = await docker
  .getContainer(worker.containerId)
  .logs({ stdout: true, stderr: true, timestamps: true });
const containerLogs = logs.toString('utf-8');
return worker.attemptLogBuffer === ''
  ? containerLogs
  : `${containerLogs}\n${worker.attemptLogBuffer}`;
```

- `containerLogs` = RFC3339-timestamped Docker container stdout (NUL-separated stdcopy-multiplexed frames).
- `worker.attemptLogBuffer` is populated at `workers/orchestrator/src/services/isolation/worker-create.ts:122-133` from the **dockerode exec stream** of `/entrypoint.sh run-attempt`, which is the raw stdout of `claude --print --verbose --output-format stream-json …` (see `docker/code-worker/entrypoint.sh:180-199`).

Neither source contains `[claude] Session init` or any line beginning with `[claude]` / `[tool]`. Those prefixes are produced **in-process** by `workers/orchestrator/src/services/runtime/processors/claude-log-processor.ts:52`:

```ts
return `[claude] Session init: model=${model} tools=${String(tools)}${mcpPart} mode=${mode} v${version}`;
```

and pushed onward to the log forwarder / Firestore `log_lines`. They are never written back to `attemptLogBuffer` or Docker stdout.

### 3.2 What the classifier checks

`workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts:33-73`:

```ts
const hasSessionInit = lines.some((line) => line.includes('[claude] Session init'));
const hasClaudeOrToolLine = lines.some((line) => {
  const trimmed = line.trimStart();
  return trimmed.startsWith('[claude]') || trimmed.startsWith('[tool]');
});
if (hasSessionInit || hasClaudeOrToolLine) {
  return { outcome: 'ran' };
}
// … falls through to 'empty_transcript' when durationMs >= 5000 and exitCode === 0
```

Both predicates are structurally unsatisfiable against the real `getWorkerLogs` output. For every successful completion-path attempt, `durationMs >> 5000` and `exitCode === 0`, so the classifier returns `{ outcome: 'infra_failed', subReason: 'empty_transcript' }`.

### 3.3 Why the tests passed

`workers/orchestrator/src/__tests__/task-dispatcher.test.ts:218` stubs the provider:

```ts
getWorkerLogs: vi.fn(async () => '[claude] Session init: id=test-session\n'),
```

The fixture injects the formatted prefix directly, so the classifier sees a string it would never see in production. The unit tests in `classify-attempt.test.ts` use the same fabricated string. There is no integration test that exercises the real `worker-ops.getWorkerLogs` → `classifyAttempt` seam.

### 3.4 Why `hasResult` doesn't save us

`task-dispatcher.ts:1418-1422` logs the `TaskResult` (PR URL, commits, `ciFailed`) **before** classification, but the classifier is called unconditionally afterwards and its verdict is treated as terminal at line 1446. The `result` value is not an input to `classifyAttempt` today.

## 4. Remediation (implementation plan — small, TDD, narrow)

### Task 1: Add a failing integration test that wires the real log shapes

**Files:**
- Create: `workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt-integration.test.ts`

- [ ] **Step 1: Write the failing test using a realistic fixture**

```ts
import { describe, expect, it } from 'vitest';
import { classifyAttempt } from '../../../services/task-dispatcher/classify-attempt.js';

// Real shape of rawLogs as returned by isolation/worker-ops.getWorkerLogs():
// docker logs(timestamps: true) over a claude stream-JSON stdout + attemptLogBuffer
// (same raw JSON). No `[claude]`/`[tool]` prefixes appear here — those are added
// by the in-process claude-log-processor, not by the container.
const realisticRawLogs = [
  '2026-04-23T20:38:46.971Z {"type":"system","subtype":"init","session_id":"abc","tools":[{"name":"Read"}],"model":"claude-sonnet-4-6"}',
  '2026-04-23T20:39:06.934Z {"type":"assistant","message":{"content":[{"type":"text","text":"…"}]}}',
  '2026-04-23T20:40:27.401Z [entrypoint] Claude attempt finished with exit code: 0',
  '',
  // attemptLogBuffer portion (no timestamp) — still raw stream-JSON
  '{"type":"system","subtype":"init","session_id":"abc"}',
].join('\n');

describe('classifyAttempt — realistic production logs', () => {
  it('classifies a successful attempt as ran when logs contain stream-JSON init event', () => {
    expect(
      classifyAttempt({ logs: realisticRawLogs, exitCode: 0, durationMs: 60_000 })
    ).toEqual({ outcome: 'ran' });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter orchestrator test -- src/__tests__/services/task-dispatcher/classify-attempt-integration.test.ts
```

Expected: FAIL with `Expected: { outcome: 'ran' } … Received: { outcome: 'infra_failed', subReason: 'empty_transcript' }`. This replicates production behavior.

- [ ] **Step 3: Commit the red test**

```bash
git add workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt-integration.test.ts
git commit -m "test(orchestrator): red test for classifyAttempt against realistic logs [INT-1460]"
```

### Task 2: Broaden `classifyAttempt` signals to match real `getWorkerLogs` output

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts`

- [ ] **Step 1: Add stream-JSON `init` event detection**

Inside `classifyAttempt`, add a third signal that scans for a claude stream-JSON system init event. Keep the existing `[claude] Session init` and `[claude]`/`[tool]` checks as belt-and-suspenders:

```ts
const hasStreamJsonInit = lines.some((line) =>
  line.includes('"type":"system"') && line.includes('"subtype":"init"')
);
const hasAssistantEvent = lines.some((line) =>
  line.includes('"type":"assistant"') || line.includes('"type":"tool_use"')
);
if (hasSessionInit || hasClaudeOrToolLine || hasStreamJsonInit || hasAssistantEvent) {
  return { outcome: 'ran' };
}
```

- [ ] **Step 2: Run the integration test — it must now pass**

```bash
pnpm --filter orchestrator test -- src/__tests__/services/task-dispatcher/classify-attempt-integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add unit tests for each new signal in `classify-attempt.test.ts`**

Write two cases: (a) `hasStreamJsonInit` with no `[claude]` prefix and exit 0 → ran, (b) `hasAssistantEvent` alone → ran.

- [ ] **Step 4: Run full orchestrator test suite**

```bash
pnpm --filter orchestrator test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts
git commit -m "fix(orchestrator): detect stream-JSON events in classifyAttempt [INT-1460]"
```

### Task 3: Short-circuit classification when the dispatcher already has a successful `TaskResult`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts` — add optional `result` input
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1434` — pass `result` through

- [ ] **Step 1: Write a failing test**

In `classify-attempt.test.ts`:

```ts
it('returns ran when a TaskResult with prUrl is present, even if transcript signals are missing', () => {
  expect(
    classifyAttempt({
      logs: '',
      exitCode: 0,
      durationMs: 60_000,
      result: { prUrl: 'https://github.com/org/repo/pull/1', commits: 1, ciFailed: 'unknown' },
    })
  ).toEqual({ outcome: 'ran' });
});
```

- [ ] **Step 2: Extend `ClassifyAttemptInput` with an optional `result`**

```ts
export interface ClassifyAttemptInput {
  logs: string;
  exitCode: number | undefined;
  durationMs: number;
  result?: { prUrl?: string | null; commits?: number; ciFailed?: unknown };
}

export function classifyAttempt(input: ClassifyAttemptInput): AttemptClassification {
  const { logs, exitCode, durationMs, result } = input;
  if (result?.prUrl !== undefined && result.prUrl !== null && result.prUrl !== '') {
    return { outcome: 'ran' };
  }
  // … existing logic unchanged
```

- [ ] **Step 3: Update the call site in `task-dispatcher.ts`**

```ts
const classification: AttemptClassification = classifyAttempt({
  logs: rawLogs,
  exitCode,
  durationMs: attemptDurationMs,
  ...(result !== undefined ? { result } : {}),
});
```

- [ ] **Step 4: Run full orchestrator test suite**

```bash
pnpm --filter orchestrator test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/classify-attempt.ts \
        workers/orchestrator/src/services/task-dispatcher.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/classify-attempt.test.ts
git commit -m "fix(orchestrator): short-circuit classifyAttempt when TaskResult has prUrl [INT-1460]"
```

### Task 4: Full CI + verification

- [ ] **Step 1: Run tracked CI from repo root**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1460.log
```

Expected: green (typecheck, lint, 15k+ tests, static validation, build, format).

- [ ] **Step 2: Manual replay sanity check**

Pick one failed task's raw logs and run classifier against them:

```bash
node -e "
const admin=require('/repo/node_modules/firebase-admin');
const sa=require(process.env.HOME+'/.config/gcloud/sa-key.json');
admin.initializeApp({credential:admin.credential.cert(sa)});
(async()=>{
  const snap=await admin.firestore().collection('code_tasks').doc('task_8c27c2db-3761-4031-8696-c1e5aaece940').collection('log_lines').orderBy('sequence').get();
  const logs=snap.docs.map(d=>d.data().text).join('\n');
  const {classifyAttempt}=require('/repo/workers/orchestrator/dist/services/task-dispatcher/classify-attempt.js');
  console.log(classifyAttempt({logs,exitCode:0,durationMs:300000}));
})();"
```

Expected: `{ outcome: 'ran' }` after the fix.

- [ ] **Step 3: Commit any pending docs and open PR**

## 5. Out of scope (do not touch in this PR)

- The earlier `SETUP_FAILED: Failed to start worker container` on mac-dev (separate pre-existing infra issue).
- `TASK_COMPLETION_VERIFICATION_FAILED: Missing fields: …` cases (verifier-schema issues tracked by INT-1455/INT-1456/INT-1459).
- Reshaping `getWorkerLogs()` to include processed `[claude]`/`[tool]` prefixes — larger architectural change not required for the regression.

## 6. Endpoint Changes

None. This is a pure orchestrator-internal logic fix and introduces no HTTP endpoints.

## 7. Rollout

Once merged to `development`, the home-dev orchestrator (systemd `intexuraos-orchestrator@pbuchman`) and mac-dev dev orchestrator pick up the fix after their normal restart. Pending `running` tasks on both workers will complete under the corrected classifier without any manual intervention.
