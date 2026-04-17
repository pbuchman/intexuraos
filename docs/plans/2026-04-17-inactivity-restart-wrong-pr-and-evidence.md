# Inactivity-Restart Wrong-PR Bug + 600s-Stall Evidence Capture

**Status:** in progress (plan complete, implementation pending in main tree)
**Branch:** `fix/inactivity-restart-wrong-pr-and-evidence` (off `development`)
**Linear issue:** TBD — user has not provided one yet, ASK before opening PR
**Date:** 2026-04-17

---

## 1. Background — the incident

Production task `task_64dddd18-1a9c-4cec-b10f-649a35564a81` (INT-1392, LLM client refactor) on home-dev:

- 22:08 UTC dispatch. Agent worked on the right thing for ~1.7h (49 modified files in worktree).
- 23:49 UTC ran `pnpm run ci:tracked 2>&1 | tee /tmp/ci-full.txt; echo "EXIT:$?"`.
- 23:49 → 23:59 (600s): zero log lines reached the orchestrator.
- 23:59:02 orchestrator fired inactivity timeout, SIGKILLed worker (`exitCode=137`).
- 23:59:13 restart attempt 2 with `--resume` and `continueSession=true` started in fresh container.
- 23:59:25 attempt 2 "finished" after 12s.
- 23:59:33 completion verifier called Gemini with **`transcript:""`** (empty/near-empty payload — only post-restart infrastructure markers).
- Gemini hallucinated PR `#970` (a 1.5-month-old, unrelated PR titled "Fix planning branch merge logs missing from task output", about Slack `sendMessage.ts`).
- `validatePrUrl` (INT-1361) detected the mismatch, set `prUrlValidationFailed: true` + 2 errors in `prUrlValidationErrors`. **Did not block.** Task finalized as `status: implemented`.
- Compliance validation comment posted to wrong PR `#970`.

49 modified files for INT-1392 were never committed. They sat in `home-dev:/home/pbuchman/code-workers/worktrees/task_64dddd18-...` until cleanup.

## 2. Root causes (with code evidence)

### 2.1 Empty-transcript verifier (primary)

`workers/orchestrator/src/services/completion-verifier.ts` `OrchestratorCompletionVerifier.doVerify()`:

- Calls `getLast50Lines(input.rawLogs)`.
- After inactivity restart, `rawLogs` comes from the new container only (`docker-provider.ts:950 getWorkerLogs` reads from current container, not pre-restart).
- The 12-second restart attempt produces only `[orchestrator]`, `[hook]`, `[entrypoint]`, `[system]` lines — no `[claude]`/`[tool]` agent content.
- `detectFatalExitCode` only fires on `[entrypoint] Claude/Codex attempt finished with exit code: 137|139` in the LAST 5 LINES of rawLogs — the inactivity-killed attempt 1's exit-code line is in attempt 1's container, NOT in attempt 2's logs. So the fatal-exit-code guard does not catch this case.
- Verifier sends prompt to Gemini regardless of transcript size. Gemini hallucinates plausible JSON.

### 2.2 Advisory-only PR-URL validation (secondary)

`apps/code-agent/src/routes/webhookRoutes.ts` `enforceExecutionOutcome()` (lines 743-958, specifically 902-910):

```ts
if (validationResult.failed) {
  prUrlValidationFailed = true;
  prUrlValidationErrors = validationResult.errors;
}
```

Sets fields. Continues execution. Task ends `implemented`. Persistence at lines 1473-1476 writes the flag/errors to Firestore but does not change status.

### 2.3 Dead `EXECUTION_AGENT_WRONG_ISSUE_MISMATCH` gate (out of scope)

`apps/code-agent/src/routes/webhookRoutes.ts` lines 827-876 compare `reportedIssueUrl` against `task.linearIssueId`. But `reportedIssueUrl` is **synthesized server-side** by the orchestrator at `workers/orchestrator/src/services/task-dispatcher.ts:1711` and `:1755`:

```ts
base.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
```

So the gate compares `task.linearIssueId` against itself. Cannot fire. **Deferred** — fixing requires either adding the field to `EXECUTION_SCHEMA` (and Gemini extracting it from the agent transcript, hallucination-prone) or deleting the gate + ~30 fixture-using tests in `apps/code-agent/src/__tests__/routes/webhooks.test.ts`. Track as follow-up tech debt.

### 2.4 600s stall — UNKNOWN root cause

We have NO direct evidence of what the container was doing during the 600s of silence. Pre-existing worktree CI history at `home-dev:/home/pbuchman/code-workers/worktrees/task_64dddd18.../.claude/ci-failures/repo-task_64dddd18-...jsonl` shows late-task CI runs taking 797s/994s/1099s — so this worktree's CI is genuinely slow (49 modified files cascading). But slow ≠ silent. The completed runs all emitted output. The killed run emitted nothing for 600s straight. Could be:
- CI hung
- Output buffered somewhere (tee, vitest, container stdio)
- Container CPU-bound but not flushing
- Something else

Container is gone. `/tmp/ci-full.txt` died with it. **Not investigable without future evidence.** Hence Part B (instrument before guessing).

## 3. Plan — three changes, one PR

### A1 — Empty-transcript guard in completion-verifier

**File:** `workers/orchestrator/src/services/completion-verifier.ts`

Add module-level constants near the existing `FATAL_EXIT_CODE_PATTERN` (around line 225, but actual current line on `fix/inactivity-restart-wrong-pr-and-evidence` branch may differ — verify with Read first):

```ts
const MIN_MEANINGFUL_TRANSCRIPT_LINES = 5;

const INFRASTRUCTURE_LINE_PREFIXES = ['[orchestrator]', '[hook]', '[entrypoint]', '[system]'];

function countMeaningfulTranscriptLines(transcript: string): number {
  let count = 0;
  for (const line of transcript.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    if (INFRASTRUCTURE_LINE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      continue;
    }
    count += 1;
  }
  return count;
}
```

In `OrchestratorCompletionVerifier.doVerify()` (the existing function around current line 593), AFTER the `detectFatalExitCode` early-return (current line 596-613) and BEFORE `selectSchemaAndPrompt(...)` (current line 615), insert:

```ts
const meaningfulLines = countMeaningfulTranscriptLines(transcript);
if (meaningfulLines < MIN_MEANINGFUL_TRANSCRIPT_LINES) {
  this.logger.warn(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      agentType: input.agentType,
      meaningfulLines,
    },
    'Completion verifier: transcript too short, refusing to call LLM'
  );
  return {
    passed: false,
    missingFields: ['transcript_too_short'],
    verifierFailure: false,
    trace: { transcript, prompt: '', response: '' },
  };
}
```

**Side-effect:** the existing transcript-summary IIFE at current line 625-632 had a `tLines.length <= 2` branch that becomes unreachable after the guard (5 meaningful lines implies ≥5 non-empty lines). Either remove the branch or wrap fallbacks in `/* v8 ignore start -- auth-guard: transcript guard guarantees tLines.length >= MIN_MEANINGFUL_TRANSCRIPT_LINES @preserve */`.

**Tests:** `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

Add helper at top of file:
```ts
function transcriptWithMeaningfulLines(label: string): string {
  return [
    '[orchestrator] starting',
    `[claude] ${label} line 1`,
    `[claude] ${label} line 2`,
    `[claude] ${label} line 3`,
    `[claude] ${label} line 4`,
    `[claude] ${label} line 5`,
  ].join('\n');
}
```

In `beforeEach`, ADD `generateMock.mockReset();` after `vi.clearAllMocks();` — `vi.clearAllMocks()` does NOT clear queued `mockResolvedValueOnce` responses; without `mockReset` they leak across tests after the new guard short-circuits.

Add a new `describe('verify — short transcript guard', ...)` block with:
- Test A: pure infrastructure transcript → `passed: false`, `missingFields: ['transcript_too_short']`, `generateMock` not called, warn log fired with `meaningfulLines: 0`.
- Test B: 4 `[claude]` lines mixed with infra → rejected, `meaningfulLines: 4`.
- Test C: exactly 5 `[claude]` lines mixed with infra → guard passes, generateMock called once.

Update existing tests using `rawLogs: 'logs'` / `'some logs'` / `'exec logs'` etc. to use `transcriptWithMeaningfulLines('<label>')`.

Replace the two existing tests `'logs full transcript when <=2 non-empty lines'` and `'handles whitespace-only rawLogs with empty fallback'` with versions that assert the guard short-circuits (because the `<=2 lines` branch is now unreachable).

**Reference patch:** `docs/plans/2026-04-17-evidence/agent1-A1-completion-verifier.patch` (388 lines, against base `6c1340fe8` from 2026-04-08). 17 commits touched these files between that base and current `fix/inactivity-restart-wrong-pr-and-evidence` tip — patch DOES NOT apply cleanly. Use it as REFERENCE only; rewrite against current tip.

**One known string drift:** Agent 1's patch references log message string `'Gemini completion verifier request'`. Current branch uses `'Completion verifier request'` (no "Gemini" prefix). Adapt accordingly.

**Verification:** `pnpm run verify:workspace:tracked orchestrator` from repo root. 100% branch coverage.

### A2 — PR-URL validation gate in webhookRoutes

**File:** `apps/code-agent/src/routes/webhookRoutes.ts`

Change `enforceExecutionOutcome` return type:
```ts
- ): Promise<{ ok: true; prUrlValidationFailed?: boolean; prUrlValidationErrors?: string[] } | { ok: false; message: string; code: string }> => {
+ ): Promise<{ ok: true } | { ok: false; message: string; code: string; prUrlValidationErrors?: string[] }> => {
```

Replace lines 902-910 (the advisory `if (validationResult.failed)` block):
```ts
- if (validationResult.failed) {
-   prUrlValidationFailed = true;
-   prUrlValidationErrors = validationResult.errors;
- }
+ if (validationResult.failed) {
+   return {
+     ok: false,
+     code: 'EXECUTION_AGENT_PR_URL_VALIDATION_FAILED',
+     message: validationResult.errors.join('; '),
+     prUrlValidationErrors: validationResult.errors,
+   };
+ }
```

Delete the now-dead `let prUrlValidationFailed`/`let prUrlValidationErrors` declarations at lines 879-880, and the conditional spread at the end of the function (lines 953-957).

In the call site (around line 1141-1175 where `enforceExecutionOutcome` returns `{ok: false}`), persist evidence to the failed task document:
```ts
{
  status: 'failed',
  error: {
    code: executionEnforcement.code,
    message: executionEnforcement.message,
  },
  ...(executionEnforcement.prUrlValidationErrors !== undefined && {
    prUrlValidationFailed: true,
    prUrlValidationErrors: executionEnforcement.prUrlValidationErrors,
  }),
  callbackReceived: true,
}
```

Delete the hoisted `let executionPrUrlValidationFailed`/`let executionPrUrlValidationErrors` (around lines 1099-1100) and the conditional persistence block in `resolvedStatus` update (around lines 1473-1476).

**Tests:** `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

Add new test asserting:
- `status: 'failed'`
- `error.code: 'EXECUTION_AGENT_PR_URL_VALIDATION_FAILED'`
- `error.message` contains both validation errors when title-mismatch + dispatch-recency both fail
- `prUrlValidationFailed: true` and `prUrlValidationErrors` (length 2) preserved on task

To set `dispatchedAt` for the dispatch-recency test, **DO NOT use `codeTaskRepo.update({ dispatchedAt })`**. The FakeFirestore has a bug where `Timestamp` values are misclassified as `FieldValue.delete()` sentinels (because `Timestamp` has an `isEqual` method, which the Fake's `isFieldValueDelete` heuristic checks). Workaround — write directly to the underlying `_store` Map:
```ts
const docRef = fakeFirestore.collection('code_tasks').doc(task.id) as unknown as { _store: Map<string, Map<string, Record<string, unknown>>>; _collectionName: string; id: string };
const existingDoc = docRef._store.get(docRef._collectionName)?.get(docRef.id);
if (existingDoc !== undefined) {
  existingDoc['dispatchedAt'] = Timestamp.fromDate(dispatchedAt);
}
```
File a separate tech-debt issue for the Fake bug at `packages/infra-firestore/src/testing/firestoreFake.ts:29-32, 104-107, 742-748`.

Update existing tests `'flags task with prUrlValidationFailed when PR title does not match Linear issue ID'` and `'flags task with prUrlValidationFailed when PR does not exist (NOT_FOUND)'`:
- Rename to `'fails task with EXECUTION_AGENT_PR_URL_VALIDATION_FAILED ...'`
- Change assertion `expect(g.value.status).toBe('implemented')` → `expect(g.value.status).toBe('failed')` + `expect(g.value.error?.code).toBe('EXECUTION_AGENT_PR_URL_VALIDATION_FAILED')`

**Reference patch:** `docs/plans/2026-04-17-evidence/agent2-A2-webhook-pr-validation.patch` (202 lines, against base `6368b6572` from 2026-04-16 — same as current branch tip). Per Agent 2's report, `pnpm run verify:workspace:tracked code-agent` passed with 14727 tests + 1 skipped. Patch SHOULD apply cleanly to current branch — try `/usr/bin/git apply --check docs/plans/2026-04-17-evidence/agent2-A2-webhook-pr-validation.patch` first.

**Verification:** `pnpm run verify:workspace:tracked code-agent` from repo root. 100% branch coverage.

### B1 + B2 — Inactivity-kill instrumentation (greenfield)

**Why:** No fix for the 600s stall — collect evidence first. Capture `/tmp` and a docker stats snapshot BEFORE killing the container. Best-effort only; must not block the restart.

**Files:**
- `workers/orchestrator/src/services/isolation/types.ts` (find `IsolationProvider` interface — `Grep "interface IsolationProvider"` to locate)
- `workers/orchestrator/src/services/isolation/docker-provider.ts`
- `workers/orchestrator/src/services/task-dispatcher.ts` — `handleInactivityRestart()` method, currently around line 1100 (search for `'Inactivity restart triggered'` log message)
- The fake `IsolationProvider` used in `task-dispatcher.test.ts` (search for `getWorkerLogs(` in `__tests__/`)

**Interface additions:**
```ts
interface ContainerStatsSnapshot {
  cpuTotalUsage: number;
  memoryUsage: number;
  pidsCurrent: number;
}

// In IsolationProvider:
copyOut(taskId: string, srcPath: string, destPath: string): Promise<void>;
statsSnapshot(taskId: string): Promise<ContainerStatsSnapshot | null>;
```

**Docker provider implementation:**
- `copyOut`: `container.getArchive({ path: srcPath })` returns a tar stream. `mkdir -p destPath` then extract via `tar` package. **Check first:** is `tar` already a dep? `Grep "from 'tar'"` and `Grep "\"tar\"" workers/orchestrator/package.json`. If not present, prefer node-tar (`pnpm add tar -w workers/orchestrator`); document why in commit message.
- `statsSnapshot`: `container.stats({ stream: false })` returns one snapshot. Map `cpu_stats.cpu_usage.total_usage`, `memory_stats.usage`, `pids_stats.current`. If container missing, return `null` (match pattern of `isWorkerRunning`).

**Fake provider:** add no-op or recording stub implementations. New tests need recording.

**Dispatcher hook (`handleInactivityRestart`)** — BEFORE the existing `await this.isolation.provider.destroyWorker(taskId);` call:

```ts
const evidenceDir = `/var/log/orchestrator/inactivity-evidence/${taskId}/`;
try {
  await this.isolation.provider.copyOut(taskId, '/tmp', evidenceDir);
} catch (e) {
  this.logger.warn(
    { taskId, error: getErrorMessage(e) },
    'Failed to copy /tmp evidence before inactivity kill'
  );
}
try {
  const stats = await this.isolation.provider.statsSnapshot(taskId);
  this.logger.warn({ taskId, stats }, 'Container stats at inactivity kill');
} catch (e) {
  this.logger.warn(
    { taskId, error: getErrorMessage(e) },
    'Failed to capture container stats before inactivity kill'
  );
}
```

Use `getErrorMessage` from `@intexuraos/common-core` (already imported in this file).

**Tests:** in `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` near existing `inactivityRestartCount` tests (search):
- Test 1: trigger inactivity restart → `copyOut` called once with `(taskId, '/tmp', stringContaining(taskId))`, `statsSnapshot` called once with `(taskId)`, BOTH BEFORE `destroyWorker`. Track call order in fake.
- Test 2: `copyOut` rejects → restart still proceeds (`destroyWorker` called, `inactivityRestartCount` increments, no exception escapes).
- Test 3: `statsSnapshot` rejects → restart still proceeds.
- Test 4: `statsSnapshot` returns `null` → warn log fires with `stats: null`, restart proceeds.

**Verification:** `pnpm run verify:workspace:tracked orchestrator` from repo root. 100% branch coverage.

## 4. Implementation order (in main tree)

CLAUDE.md prohibits git worktrees. Run sequentially in main workspace `/Users/p.buchman/personal/intexuraos-5/`:

1. **A2 first** — Agent 2's patch may apply cleanly. Try:
   ```
   /usr/bin/git apply --check docs/plans/2026-04-17-evidence/agent2-A2-webhook-pr-validation.patch
   ```
   If clean: `git apply ...`, then `pnpm run verify:workspace:tracked code-agent`. If not clean: rewrite from scratch using the structural guidance in §3 A2.

2. **A1 next** — Agent 1's patch will NOT apply (17 commits drift). Implement from §3 A1 above by hand. Use the patch as reference for test structure. Read current `completion-verifier.ts` first to find correct line numbers for insertion. Watch for the `'Gemini completion verifier request'` vs `'Completion verifier request'` log string drift — current branch uses the latter. After: `pnpm run verify:workspace:tracked orchestrator`.

3. **B1+B2 last** — greenfield. Implement per §3 B1+B2. After: `pnpm run verify:workspace:tracked orchestrator`.

4. Final: `pnpm run ci:tracked` from repo root. Capture with `tee /tmp/ci-output-final.txt` per CLAUDE.md.

5. Commit per Commit Gate. Push. **Ask user for INT-XXX before opening PR.** PR title must contain `INT-XXX`. PR body: `Fixes INT-XXX`.

## 5. Cleanup before starting

Two leftover worktrees from the rule-violating dispatch:
```
~/personal/intexuraos-5/.claude/worktrees/agent-a61ac9eb [worktree-agent-a61ac9eb] (Agent 1, has unresolved stash conflicts after rebase)
~/personal/intexuraos-5/.claude/worktrees/agent-af624dda [worktree-agent-af624dda] (Agent 2, clean)
```

Both worktree branches were created off random older commits (Agent 1: `6c1340fe8` from 2026-04-08; Agent 2: `6368b6572` matched current tip). Patches are preserved at `docs/plans/2026-04-17-evidence/`. Safe to delete worktrees:
```
/usr/bin/git worktree remove --force .claude/worktrees/agent-a61ac9eb
/usr/bin/git worktree remove --force .claude/worktrees/agent-af624dda
/usr/bin/git branch -D worktree-agent-a61ac9eb worktree-agent-af624dda
```

## 6. Out-of-scope follow-ups (separate Linear issues)

- **Dead `EXECUTION_AGENT_WRONG_ISSUE_MISMATCH` gate** (§2.3) — synthesized URL compared to itself. Two options: add field to `EXECUTION_SCHEMA` + remove orchestrator synthesis (re-enables real check, but Gemini-extracted field is hallucination-prone — A1's transcript guard helps), OR delete gate + ~30 fixture-using tests. Pick one.
- **FakeFirestore Timestamp bug** at `packages/infra-firestore/src/testing/firestoreFake.ts:29-32, 104-107, 742-748` — `isFieldValueDelete` heuristic flags any object with `isEqual` method as a delete sentinel; `Timestamp` has `isEqual`. Affects any test trying to set Timestamp via `update()`.
- **Cleanup orphaned PR-#970 compliance comment** posted by the buggy task — user explicitly said "ignore" but worth noting.

## 7. Files modified summary

- `workers/orchestrator/src/services/completion-verifier.ts` (A1)
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` (A1)
- `apps/code-agent/src/routes/webhookRoutes.ts` (A2)
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (A2)
- `workers/orchestrator/src/services/isolation/types.ts` (B1+B2 — interface)
- `workers/orchestrator/src/services/isolation/docker-provider.ts` (B1+B2 — implementation)
- `workers/orchestrator/src/services/task-dispatcher.ts` (B1+B2 — `handleInactivityRestart` site)
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (B1+B2 — tests)
- Possibly `workers/orchestrator/package.json` if `tar` not already a dep (B1)

No HTTP endpoint changes — Endpoint Changes section omitted per CLAUDE.md plan-doc convention.

## 8. Reference artifacts (preserved across compaction)

- `/tmp/task-logs.txt` — full Firestore log dump from the failed task (1914 lines, 5491 source lines from agent transcript). May be cleared on tmpfs eviction.
- `docs/plans/2026-04-17-evidence/agent1-A1-completion-verifier.patch` — Agent 1's full diff (reference only, won't apply).
- `docs/plans/2026-04-17-evidence/agent2-A2-webhook-pr-validation.patch` — Agent 2's full diff (try apply first).
- Original task ID: `task_64dddd18-1a9c-4cec-b10f-649a35564a81`. Re-fetch with `node .claude/skills/debug-code-task/scripts/fetch-task.cjs task_64dddd18-1a9c-4cec-b10f-649a35564a81 --logs-only` (after `unset FIRESTORE_EMULATOR_HOST GOOGLE_CLOUD_PROJECT`).
- Original orchestrator journal: `ssh home-dev journalctl -u intexuraos-orchestrator@pbuchman --since "2026-04-16 21:48:00 UTC" --until "2026-04-16 22:00:30 UTC"`.
