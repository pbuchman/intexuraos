# Orchestrator Observability Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close observability gaps in the orchestrator's task completion pipeline so that debugging retry decisions, phase mismatches, and stale code deployments is possible from logs and the web UI alone.

**Architecture:** All changes are additive logging statements in the orchestrator worker and one return-type extension in `adaptive-retry.ts`. The web UI changes display data already stored in Firestore (verificationHistory, linearIssueLabels). No new APIs, no schema migrations, no new dependencies.

**Tech Stack:** TypeScript, Vitest, pino logger, React (web UI)

---

## Task 1: Export Per-Signal Score Breakdown from Adaptive Retry

**Why:** The current `analyzeRetryDecision` returns a single `progressScore` number. When debugging, you can't tell if the score came from "PR created +3" or "CI regressed -2". Externalizing the breakdown makes every downstream log richer.

**Files:**
- Modify: `workers/orchestrator/src/services/adaptive-retry.ts`
- Test: `workers/orchestrator/src/__tests__/adaptive-retry.test.ts`

**Step 1: Write the failing test**

In `adaptive-retry.test.ts`, add a new test that asserts `signalBreakdown` exists on the decision:

```typescript
it('includes signal breakdown in decision', () => {
  const input: RetryDecisionInput = {
    currentAttempt: 1,
    baseMaxAttempts: 3,
    verificationHistory: [
      makeRecord({ attempt: 1, confidence: 0.3, missingCriteria: ['PR URL line', 'CI evidence line'] }),
    ],
    currentResult: makeResult({ prUrl: 'https://github.com/org/repo/pull/1', commits: 3, ciFailed: false }),
    previousResult: makeResult({ commits: 1, ciFailed: true }),
  };

  const decision = analyzeRetryDecision(input);

  expect(decision.signalBreakdown).toBeDefined();
  expect(decision.signalBreakdown.resultProgress).toBeGreaterThan(0);
  expect(typeof decision.signalBreakdown.verificationTrend).toBe('number');
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/adaptive-retry.test.ts -t "includes signal breakdown"`
Expected: FAIL — `signalBreakdown` doesn't exist on `RetryDecision`

**Step 3: Extend `RetryDecision` interface and implementation**

In `adaptive-retry.ts`:

1. Add to `RetryDecision` interface (after `progressScore`):
```typescript
/** Per-signal score breakdown for diagnostics. */
signalBreakdown: {
  resultProgress: number;
  verificationTrend: number;
};
```

2. In `analyzeRetryDecision`, change `calculateProgressScore` to return the breakdown:
```typescript
const { total: progressScore, resultProgress, verificationTrend } =
  calculateProgressScore(verificationHistory, currentResult, previousResult);
```

3. Add `signalBreakdown: { resultProgress, verificationTrend }` to every return statement (4 return paths).

4. Change `calculateProgressScore` return type:
```typescript
function calculateProgressScore(
  history: TaskVerificationRecord[],
  currentResult?: TaskResult,
  previousResult?: TaskResult
): { total: number; resultProgress: number; verificationTrend: number } {
  const resultProgress = scoreResultProgress(currentResult, previousResult);
  const verificationTrend = scoreVerificationTrend(history);
  return { total: resultProgress + verificationTrend, resultProgress, verificationTrend };
}
```

**Step 4: Run all adaptive-retry tests to verify they pass**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/adaptive-retry.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/adaptive-retry.ts workers/orchestrator/src/__tests__/adaptive-retry.test.ts
git commit -m "Add signal breakdown to adaptive retry decision"
```

---

## Task 2: Log `checkForResult` Output and Result Diff

**Why:** After `checkForResult` returns, we log `detectedPr=` but not the full result (commits, branch, ciFailed). And when retrying, we never log what changed between `previousResult` and `currentResult`. This makes it impossible to reconstruct why the adaptive retry scored what it did.

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:669-675` (after checkForResult)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:762-777` (before analyzeRetryDecision)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write the failing test**

Add a test that verifies the task log contains result details after `checkForResult`. Use the existing test pattern — spy on the log forwarder's `appendChunk` and check for the new log line.

Assert the task log contains a line matching:
```
Result: prUrl=<url> branch=<branch> commits=<n> ciFailed=<bool>
```

And for the diff (when previousResult exists), assert a line matching:
```
Result diff: commits 1→3, ciFailed true→false, prUrl (new)
```

**Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts -t "logs result details"`
Expected: FAIL — no such log line emitted

**Step 3: Add logging after `checkForResult` (line ~675)**

After line 675 in `task-dispatcher.ts`, add:

```typescript
if (result !== undefined) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Result: prUrl=${result.prUrl ?? 'none'} branch=${result.branch ?? 'none'} commits=${String(result.commits ?? 0)} ciFailed=${String(result.ciFailed ?? 'unknown')}`
  );
}
```

**Step 4: Add result diff logging before `analyzeRetryDecision` (line ~762)**

Before the `analyzeRetryDecision` call, add:

```typescript
if (result !== undefined && task.previousResult !== undefined) {
  const diffs: string[] = [];
  const prev = task.previousResult;
  if (prev.commits !== result.commits) diffs.push(`commits ${String(prev.commits ?? 0)}→${String(result.commits ?? 0)}`);
  if (prev.ciFailed !== result.ciFailed) diffs.push(`ciFailed ${String(prev.ciFailed ?? 'unknown')}→${String(result.ciFailed ?? 'unknown')}`);
  if (prev.prUrl === undefined && result.prUrl !== undefined) diffs.push('prUrl (new)');
  if (diffs.length > 0) {
    this.appendOrchestratorTaskLog(task.taskId, `Result diff: ${diffs.join(', ')}`);
  }
}
```

**Step 5: Run tests**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "Log checkForResult output and result diff between attempts"
```

---

## Task 3: Log Adaptive Retry Signal Breakdown and Full Input

**Why:** The current log says `score=5` but not which signals contributed. With the breakdown from Task 1, we can now log `resultProgress=5 verificationTrend=0`.

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:770-777`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write the failing test**

Assert the task log line for adaptive retry includes `resultProgress=` and `verificationTrend=`.

**Step 2: Run test to verify it fails**

Expected: FAIL — current log only has `score=`

**Step 3: Update the adaptive retry log line (line ~770-773)**

Replace the existing `appendOrchestratorTaskLog` at line 770-773 with:

```typescript
this.appendOrchestratorTaskLog(
  task.taskId,
  `Adaptive retry: ${retryDecision.outcome} (score=${String(retryDecision.progressScore)}, resultProgress=${String(retryDecision.signalBreakdown.resultProgress)}, verificationTrend=${String(retryDecision.signalBreakdown.verificationTrend)}, effective=${String(retryDecision.effectiveMaxAttempts)}) — ${retryDecision.reason}`
);
```

Also update the `logger.info` at line 774-777 to include the breakdown:

```typescript
this.logger.info(
  {
    taskId: task.taskId,
    attempt,
    maxAttempts,
    outcome: retryDecision.outcome,
    progressScore: retryDecision.progressScore,
    signalBreakdown: retryDecision.signalBreakdown,
    effectiveMaxAttempts: retryDecision.effectiveMaxAttempts,
    hasCurrentResult: result !== undefined,
    hasPreviousResult: task.previousResult !== undefined,
    verificationHistoryLength: (task.verificationHistory ?? []).length,
  },
  'Adaptive retry decision'
);
```

**Step 4: Run tests**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "Log adaptive retry signal breakdown and input context"
```

---

## Task 4: Add Orchestrator Code Version at Startup

**Why:** The root cause of the previous incident was tsx watch silently going stale. If the orchestrator logs its git commit hash at startup (and on every tsx reload), we can immediately tell from logs whether the latest code is running.

**Files:**
- Modify: `workers/orchestrator/src/start.ts:413` (after `Starting orchestrator` log)
- Test: Manual verification (startup log is not unit-tested)

**Step 1: Add code version logging**

After line 413 in `start.ts` (`logger.info({ port, capacity }, 'Starting orchestrator')`), add:

```typescript
let codeVersion = 'unknown';
try {
  codeVersion = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // git may not be available in all environments
}
logger.info({ codeVersion, nodeVersion: process.version }, 'Orchestrator code version');
```

Note: `execSync` is already imported at line 13.

**Step 2: Verify locally**

Run: `cd workers/orchestrator && npx tsx src/start.ts 2>&1 | head -5`
Expected: See `Orchestrator code version` log with the current git hash

**Step 3: Commit**

```bash
git add workers/orchestrator/src/start.ts
git commit -m "Log git commit hash at orchestrator startup"
```

---

## Task 5: Log Phase Mismatch Warning

**Why:** When a task runs as Phase 1 (design-only) but the worker creates a PR and runs CI, there's a contradiction. The orchestrator should warn about this so operators can spot miscategorized tasks.

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (after `checkForResult`, ~line 675)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write the failing test**

Add a test where `phase === 'phase1'` but `result.prUrl` is set. Assert the task log contains `Phase mismatch`.

**Step 2: Run test to verify it fails**

Expected: FAIL — no phase mismatch detection exists

**Step 3: Add phase mismatch detection**

After the result logging added in Task 2, add:

```typescript
if (phase === 'phase1' && result !== undefined && result.prUrl !== undefined) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `⚠ Phase mismatch: task ran as Phase 1 (design) but worker created PR: ${result.prUrl}`
  );
  this.logger.warn(
    { taskId: task.taskId, phase, prUrl: result.prUrl },
    'Phase mismatch: Phase 1 task created a PR'
  );
}
```

**Step 4: Run tests**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "Warn on phase mismatch when Phase 1 task creates PR"
```

---

## Task 6: Log Resume Prompt Summary

**Why:** When a task is resumed, the resume prompt sent to the worker is invisible. If the worker fails to address gaps, you can't tell whether the prompt was wrong or the worker ignored it.

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:792` (after buildResumePrompt)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write the failing test**

Assert the task log contains a `[prompt]`-tagged line with `[AUTO-CONTINUE ATTEMPT]` after a resume.

**Step 2: Run test to verify it fails**

Expected: FAIL — resume prompt is not logged

**Step 3: Add resume prompt logging**

After line 792 (`const resumePrompt = this.buildResumePrompt(...)`), add:

```typescript
const resumePreview = resumePrompt.length > 500 ? resumePrompt.slice(0, 500) + '…' : resumePrompt;
this.appendTaggedTaskLog(task.taskId, 'prompt', `Resume prompt:\n${resumePreview}`);
```

This reuses the same `[prompt]` tag pattern used at line 245 for the initial prompt.

**Step 4: Run tests**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "Log resume prompt summary on retry attempts"
```

---

## Final Verification

After all tasks are complete:

```bash
pnpm run verify:workspace:tracked -- orchestrator
pnpm run ci:tracked
```

Both must pass before any PR is created.

---

## Out of Scope (Deferred)

These findings from the audit are deferred to a separate plan:

| Finding                         | Reason Deferred                                                            |
| ------------------------------- | -------------------------------------------------------------------------- |
| Web UI: show labels             | Requires web app changes, separate PR to avoid blast radius                |
| Web UI: retry decision display  | Needs UX design for per-attempt breakdown                                  |
| Web UI: phase mismatch alert    | Depends on Task 5 data being available first                               |
| Web UI: cost per attempt        | Needs cost data from turn metrics (separate feature)                       |
| tsx watch reliability           | Infrastructure issue — needs deploy mechanism change, not code logging fix |
| Deploy hook confirmation        | Infrastructure issue — needs deploy script modification                    |
| code-agent: send executionPhase | Cross-service API change, separate PR                                      |
