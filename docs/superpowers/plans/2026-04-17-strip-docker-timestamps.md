# Strip Docker Timestamps in Verifier Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `stripDockerHeaders` strip the leading RFC3339 timestamp Docker prepends when `container.logs({ timestamps: true })` is used, so the completion verifier's per-line `memory_acknowledgment` regex matches actual production raw logs.

**Architecture:** Single-file behavioural fix in `workers/orchestrator/src/services/log-formatter.ts`. After ANSI stripping, run a multiline regex that removes a leading RFC3339 timestamp followed by whitespace from every line. This is a no-op on log content that does not have a Docker timestamp prefix (e.g. file-tailed logs that go through `LogForwarder`), so the change is safe for every existing call site.

**Tech Stack:** TypeScript (strict), Vitest. No infra changes. No migrations. No endpoint changes.

---

## Endpoint Changes

* **Modified:** none
* **Created:** none
* **Removed:** none
* **Unchanged:** all orchestrator HTTP endpoints

---

## Root cause recap

* `workers/orchestrator/src/services/isolation/docker-provider.ts:952-974` (`getWorkerLogs`) and `:976-993` (`streamLogs`) both call `container.logs({ timestamps: true })`. Docker prepends each log line with `YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ ` after framing.
* `workers/orchestrator/src/services/log-formatter.ts:17-29` (`stripDockerHeaders`) strips the 8-byte multiplex frame header and ANSI escapes, but **not** the Docker text timestamp.
* `workers/orchestrator/src/services/completion-verifier.ts:551-554` (`buildMemoryAcknowledgmentPattern`) is a `/m`-anchored regex `^\s*(?:\[[^\]]+\]\s+)?-\s*\[\d+\]\s+<memoryId>\b`. With a leading `2026-04-17T16:12:19.476Z ` on the line, `^` sees the timestamp and the regex never matches.
* Production proof: task `task_556d5fc0-61c5-4d15-845c-53996bfe6b48` (review of PR #1872, INT-1413) burned all 3 attempts at 18:13/18:17/18:20 CEST with `Missing fields: memory_acknowledgment`, despite the worker emitting the exact `- [1] mem_xxx — …` block the prompt asks for.

## Why "strip in `stripDockerHeaders`" is the right fix

Every consumer that needs raw logs already routes through `stripDockerHeaders`:

* `completion-verifier.ts:266, 270, 276, 570` — the verifier path.
* `task-dispatcher.ts:2221` — the `streamLogs` chunk handler.
* `log-forwarder.ts:52` (`cleanContent`) — the file-tail path that writes Firestore `log_lines`.

For paths fed by `container.logs(timestamps: true)`, this fixes the verifier and removes the noise. For the file-tail path (`LogForwarder`), the input is the worker's log file — there is no Docker timestamp prefix on those lines, so the new regex is a no-op. `LogForwarder` then re-prefixes its own orchestrator-clock timestamp via `prefixTimestamps`, so there is no risk of double-stamping.

Widening the verifier regex was rejected (see brainstorming): it would only fix one consumer, and the timestamp noise would still appear in `getLast50Lines` transcripts shown to the verifier LLM and the LLM-built prompts.

## File Structure

### Modify
- `workers/orchestrator/src/services/log-formatter.ts` — add a `DOCKER_TIMESTAMP_RE` constant and one `.replace()` call at the end of `stripDockerHeaders`.

### Modify (tests)
- `workers/orchestrator/src/__tests__/log-formatter.test.ts` — add unit tests for the new behaviour and one regression test that covers the original Docker-frame + ANSI + timestamp triple-stack.
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` — add one end-to-end regression test that pins: timestamped raw logs satisfy `memory_acknowledgment`.

### Add
- None.

---

## Task 1: Pin the new behaviour with a failing unit test

**Files:**
- Modify: `workers/orchestrator/src/__tests__/log-formatter.test.ts`

- [ ] **Step 1: Add a failing test for plain Docker timestamps**

Append this test inside the `describe('stripDockerHeaders', …)` block, after the last existing case (after the `'strips ANSI codes while preserving meaningful content'` test, around line 81):

```ts
it('strips Docker RFC3339 timestamps prefixed by `container.logs({ timestamps: true })`', () => {
  const raw = '2026-04-17T16:12:19.476123456Z - [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — APPLICABLE\n2026-04-17T16:12:19.500000000Z next line';
  expect(stripDockerHeaders(raw)).toBe(
    '- [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — APPLICABLE\nnext line'
  );
});

it('strips Docker timestamps even after ANSI and frame headers are stripped', () => {
  const header = String.fromCharCode(1, 0, 0, 0, 0, 0, 0, 80);
  const raw =
    header +
    '2026-04-17T16:12:19.476123456Z \x1B[32mOK\x1B[39m\n' +
    '2026-04-17T16:12:20.000000000Z plain';
  expect(stripDockerHeaders(raw)).toBe('OK\nplain');
});

it('leaves lines without a Docker timestamp prefix unchanged', () => {
  const raw = '[claude] - [1] mem_abc — APPLICABLE\nplain text\n2026 not-a-timestamp';
  expect(stripDockerHeaders(raw)).toBe(
    '[claude] - [1] mem_abc — APPLICABLE\nplain text\n2026 not-a-timestamp'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter '@intexuraos/orchestrator' run test -- log-formatter`
Expected: 3 new tests FAIL — output shows the actual string still contains the `2026-04-17T…Z ` prefix.

## Task 2: Implement the timestamp strip

**Files:**
- Modify: `workers/orchestrator/src/services/log-formatter.ts`

- [ ] **Step 1: Add the constant and the replace call**

Edit `workers/orchestrator/src/services/log-formatter.ts`. Add a new module-level constant directly under `ANSI_ESCAPE_RE`:

```ts
// Matches the RFC3339 nanosecond timestamp Docker prepends to every log line
// when `container.logs({ timestamps: true })` is requested:
//   2026-04-17T16:12:19.476123456Z <content>
// Anchored at line start (`m` flag) and consumes the trailing space so the
// downstream content (verifier regex anchors, JSON parsers, etc.) sees a
// pristine line.
const DOCKER_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /gm;
```

Then in `stripDockerHeaders`, change the trailing return from:

```ts
return result.replace(ANSI_ESCAPE_RE, '');
```

to:

```ts
return result.replace(ANSI_ESCAPE_RE, '').replace(DOCKER_TIMESTAMP_RE, '');
```

Order matters: ANSI escapes are stripped first because they can appear after the timestamp inside the line content, and we don't want the ANSI strip to alter the leading `^` anchor for the timestamp regex.

- [ ] **Step 2: Run the unit tests to verify they pass**

Run: `pnpm --filter '@intexuraos/orchestrator' run test -- log-formatter`
Expected: all `stripDockerHeaders` tests PASS, including the 3 new ones from Task 1.

## Task 3: Add an end-to-end verifier regression test

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

- [ ] **Step 1: Add a regression test that exercises the verifier with timestamped raw logs**

Add this test directly after the existing `'accepts the [index] memoryId acknowledgment format emitted by v7+/v10+ prompts'` test (search for that test name in the file).

```ts
it('accepts memory acknowledgment when raw logs carry Docker RFC3339 timestamps (regression for INT-1413)', async () => {
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1872',
        memory_ids_used: 'mem_b349148e-2e7d-4124-b645-dff4d458a773',
        memory_ids_rejected: 'mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce',
        memory_usage_summary: 'Used the first memory, rejected the second.',
        summary: 'Implemented.',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });
  const verifier = createVerifier();
  const result = await verifier.verify({
    taskId: 'task-int-1413-regression',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: [
      '2026-04-17T16:12:19.476123456Z 📋 **Execution Memories Received:**',
      '2026-04-17T16:12:19.500000000Z I have received and reviewed 2 execution memories for this task:',
      '2026-04-17T16:12:19.520000000Z - [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — "Pre-submit verification" — APPLICABLE because reason',
      '2026-04-17T16:12:19.540000000Z - [2] mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce — "Address reviewer feedback" — NOT APPLICABLE because reason',
      '2026-04-17T16:12:20.000000000Z step 1',
      '2026-04-17T16:12:20.100000000Z step 2',
      '2026-04-17T16:12:20.200000000Z done',
    ].join('\n'),
    executionMemoryContext: {
      applicationId: 'app-int-1413',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'Review regression',
      matchedMemories: [
        {
          memoryId: 'mem_b349148e-2e7d-4124-b645-dff4d458a773',
          title: 'Pre-submit verification',
          memoryType: 'verification_pattern',
          score: 0.7,
          appliesWhen: 'always',
          action: 'verify',
          avoid: 'shortcut',
          verification: 'check',
        },
        {
          memoryId: 'mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce',
          title: 'Address reviewer feedback',
          memoryType: 'implementation_pattern',
          score: 0.6,
          appliesWhen: 'reviews',
          action: 'reply',
          avoid: 'silence',
          verification: 'check',
        },
      ],
    },
  });
  expect(result.passed).toBe(true);
  expect(result.missingFields).toEqual([]);
});
```

- [ ] **Step 2: Run the verifier tests to confirm the regression test passes**

Run: `pnpm --filter '@intexuraos/orchestrator' run test -- completion-verifier`
Expected: all tests PASS, including the new regression test.

## Task 4: Repo-wide verification

- [ ] **Step 1: Run the orchestrator's tracked workspace checks**

Run: `pnpm run verify:workspace:tracked -- @intexuraos/orchestrator | tee /tmp/ci-strip-ts-orchestrator.txt`
Expected: PASS with 100% branch coverage on `log-formatter.ts` and `completion-verifier.ts`.

- [ ] **Step 2: Run the full tracked CI**

Run: `pnpm run ci:tracked | tee /tmp/ci-strip-ts-full.txt`
Expected: PASS across all workspaces. If anything fails, fix it (per ownership-mindset) before committing.

## Task 5: Commit, push, and open the PR

- [ ] **Step 1: Stage the change set**

```bash
git status
git add \
  workers/orchestrator/src/services/log-formatter.ts \
  workers/orchestrator/src/__tests__/log-formatter.test.ts \
  workers/orchestrator/src/services/__tests__/completion-verifier.test.ts \
  docs/superpowers/plans/2026-04-17-strip-docker-timestamps.md
```

- [ ] **Step 2: Create a feature branch and commit**

```bash
gh repo set-default pbuchman/intexuraos
git checkout -b fix/strip-docker-timestamps-in-verifier
git commit -m "$(cat <<'EOF'
fix(orchestrator): strip Docker RFC3339 timestamps in stripDockerHeaders

container.logs({ timestamps: true }) prepends an RFC3339 timestamp to every
log line. The completion verifier's memory_acknowledgment check uses a
multiline-anchored regex that does not tolerate the timestamp prefix, so
every review/execution task with injected memories burned all 3 attempts
with `Missing fields: memory_acknowledgment` (observed on INT-1413 review
of PR #1872, task_556d5fc0).

Strip the timestamp at the single normalisation chokepoint
(stripDockerHeaders), where every verifier and prompt-builder call site
already routes through. No-op on the file-tail path (LogForwarder), which
sees worker stdout from disk without Docker's timestamp wrapper.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/strip-docker-timestamps-in-verifier
gh pr create --base development --title "fix(orchestrator): strip Docker RFC3339 timestamps in stripDockerHeaders" --body "$(cat <<'EOF'
## Summary

- `container.logs({ timestamps: true })` (used by `getWorkerLogs` and `streamLogs` in `docker-provider.ts`) prepends each log line with an RFC3339 timestamp.
- `stripDockerHeaders` was stripping multiplex frame headers + ANSI escapes but leaving the timestamp intact.
- The verifier's `memory_acknowledgment` check (`^\s*(?:\[[^\]]+\]\s+)?-\s*\[\d+\]\s+<memoryId>\b` with `/m`) failed on every line that started with `2026-04-17T16:12:19.476Z `.
- Result: every task with injected execution memories burned all 3 attempts with `Missing fields: memory_acknowledgment`, regardless of whether the agent did the right thing.

## Why fix it in `stripDockerHeaders`

Every raw-log consumer (verifier, prompt transcript builder, stream-chunk handler, file-tail forwarder) already routes through `stripDockerHeaders`. Centralising the timestamp strip there fixes the verifier, cleans up the verifier-LLM transcripts, and removes the noise from any future consumer too. The file-tail path sees worker stdout from disk (no Docker timestamps), so the new regex is a no-op there.

## Evidence (production)

- Task `task_556d5fc0-61c5-4d15-845c-53996bfe6b48` (review of PR #1872) — 3 attempts, all rejected at 18:13 / 18:17 / 18:20 CEST with `Missing fields: memory_acknowledgment`.
- Worker output captured in Firestore `log_lines` shows the agent emitted the correct `- [1] mem_b349148e-… — APPLICABLE` block.
- Reproducer (Node REPL): the verifier regex returns `false` for `2026-04-17T16:12:19.476Z - [1] mem_xxx` and `true` for `- [1] mem_xxx`.

This is a follow-up to INT-1411 (which aligned the prompt and verifier on the `[index] memoryId` format but didn't account for Docker's timestamp wrapper).

## Test plan

- [x] `pnpm run ci:tracked` passes
- [x] New unit tests in `log-formatter.test.ts` pin the timestamp-strip behaviour (plain, after frame+ANSI, no-op when absent)
- [x] New regression test in `completion-verifier.test.ts` pins the verifier-end-to-end behaviour with timestamped raw logs
- [ ] Post-merge: deploy the orchestrator and confirm the next PR review task with injected memories transitions to `success` instead of `failed` after attempt 1

EOF
)"
```

- [ ] **Step 4: Capture the PR URL**

Print the PR URL returned by `gh pr create` in the final session output so the user can track it.
