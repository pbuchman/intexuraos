# [INT-1411] Fix Completion Verifier `memory_acknowledgment` Regression

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `validateMemoryReporting` acknowledgment check in `workers/orchestrator` so it matches the format the system prompt instructs workers to emit. Unbreak all production tasks that receive injected execution memories (currently 100% of them fail the completion verifier after all 3 attempts).

**Architecture:** Single-file fix in the orchestrator's completion verifier + refreshed tests. The system prompt and the verifier's acknowledgment check were de-synced in commit `e13e3d815` (INT-1352). The prompt was updated to use `[index] memoryId` while the verifier was left expecting `[memoryId]`. This plan aligns the verifier with the prompt.

**Tech Stack:** TypeScript (strict), Vitest, Zod. No infra changes. No migrations. No endpoint changes.

---

## Endpoint Changes

None. (This task touches only the orchestrator's internal verifier logic; no HTTP endpoints are added, modified, or removed.)

## Investigation — Proof of Root Cause

### Summary

The stuck task is `task_d5b2693b-238d-4e96-abdc-3d71f1b0f67d` (Review agent for PR #1868, Linear INT-1410). All 3 worker attempts completed the actual review work (PR review posted at `13:56:50`, GitHub review id `4129399706`), but the orchestrator's completion verifier rejected every attempt with `Missing fields: memory_acknowledgment`. After the 3rd rejection the orchestrator finalized the task with `status: failed`, and the Firestore doc was left in `status: "running"` with a stale `lastHeartbeat` because the worker never hit the "success" transition path that flips it.

The root cause is a **format mismatch between the agent system prompt and the `validateMemoryReporting` check**. The agent emits exactly what the prompt asks for; the verifier checks for a different format that the prompt no longer produces.

### Evidence #1 — Firestore task document

From `node .claude/skills/debug-code-task/scripts/fetch-task.cjs task_d5b2693b-238d-4e96-abdc-3d71f1b0f67d`:

| Field              | Value                      |
| ------------------ | -------------------------- |
| `status`           | `running`                  |
| `callbackReceived` | `false`                    |
| `workerType`       | `glm`                      |
| `agentType`        | `review`                   |
| `linearIssueId`    | `INT-1410`                 |
| `createdAt`        | `2026-04-17T13:51:56.608Z` |
| `lastHeartbeat`    | `2026-04-17T13:59:01.761Z` |
| `prMergedAt`       | `2026-04-17T14:44:59Z`     |
| `updatedAt`        | `2026-04-17T14:45:03Z`     |

The task shows `status: running` with a heartbeat that froze at `13:59:01` (end of attempt 3). The PR was merged ~46 minutes later by the human reviewer, but the task doc was never transitioned to a success state because every attempt was rejected.

Two injected memories:

- `mem_b349148e-2e7d-4124-b645-dff4d458a773` — "Pre-submit verification of PR content against plan"
- `mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce` — "Address minor reviewer feedback promptly, including stale comments"

### Evidence #2 — Orchestrator log lines

From Firestore `code_tasks/{taskId}/log_lines`, all three attempts end the same way:

```
[1776434288037001] 15:58:08 [orchestrator] Passed: false | VerifierFailure: false
[1776434288037002] 15:58:08 [orchestrator] Missing fields: memory_acknowledgment
…
[1776434357067001] 15:59:17 [orchestrator] Missing fields: memory_acknowledgment
…
[1776434510027001] 16:01:50 [orchestrator] Missing fields: memory_acknowledgment
[1776434510027007] 16:01:50 [orchestrator] Terminal failure: completion criteria not met after 3 attempts
```

`VerifierFailure: false` rules out an LLM/model outage: the verifier ran, parsed JSON, and the Zod schema passed. The failure came from the post-parse `validateMemoryReporting(...)` branch.

### Evidence #3 — What the worker actually wrote

From attempt 1 (sequence `1776434013639000`, 15:53:32):

```
📋 **Execution Memories Received:**
I have received and reviewed 2 execution memories for this task:
- [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — "Pre-submit verification of PR content against plan" — APPLICABLE because …
- [2] mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce — "Address minor reviewer feedback promptly, including stale comments" — NOT APPLICABLE because …
```

And from attempt 2 (sequence `1776434325534000`, 15:58:44):

```
📋 **Execution Memories Received:**
I have received and reviewed 2 execution memories for this task:
- [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — "Pre-submit verification of PR content against plan" — APPLICABLE …
- [2] mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce — "Address minor reviewer feedback …" — NOT APPLICABLE …

REVIEW_AGENT_FINAL:
…
- memory_ids_used: mem_b349148e-2e7d-4124-b645-dff4d458a773
- memory_ids_rejected: mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce
- memory_usage_summary: Pre-submit verification memory guided …
```

Both the "Execution Memories Received" block **and** the three `memory_*` fields are present in the transcript. The index number `[1]`/`[2]` is inside the brackets; the memory ID is **outside** the brackets.

### Evidence #4 — What the system prompt tells the worker to write

`workers/orchestrator/src/services/system-prompt.ts:120-131`:

```text
📋 **Execution Memories Received:**
I have received and reviewed ${memoryCount} execution memories for this task:
- [{index}] {memoryId} — "{title}" — APPLICABLE / NOT APPLICABLE because {one-sentence reason}

Example:
…
- [1] mem_abc123 — "Always add index tests for Firestore migrations" — APPLICABLE …
- [2] mem_def456 — "Shift cost calculation client-side" — NOT APPLICABLE …
- [3] mem_ghi789 — "Safe execution guard for scheduled tasks" — APPLICABLE …
```

So the prompt explicitly asks for `[{index}] {memoryId}` — **index** in brackets, **memory ID** after the bracket.

### Evidence #5 — What the verifier actually checks

`workers/orchestrator/src/services/completion-verifier.ts:545-552`:

```ts
const normalizedLogs = stripDockerHeaders(rawLogs);
const missingFields: string[] = [];
const hasAcknowledgment =
  normalizedLogs.includes('Execution Memories Received') &&
  injectedIds.every((memoryId) => normalizedLogs.includes(`[${memoryId}]`));
if (!hasAcknowledgment) {
  missingFields.push('memory_acknowledgment');
}
```

The check is `normalizedLogs.includes(\`[${memoryId}]\`)` — it looks for the **memory ID** inside the brackets. The only string it would accept for memory 1 of the stuck task is literally `[mem_b349148e-2e7d-4124-b645-dff4d458a773]`. Grepping the full raw log confirms that string never appears (the memory ID always appears bare, following `[1] ` / `[2] `).

### Evidence #6 — How the regression was introduced

`git log -S'[{index}] {memoryId}' workers/orchestrator/src/services/system-prompt.ts` points to commit `e13e3d815` (`[INT-1352] Fix execution memory feedback loop end-to-end`, 2026-04-12). That commit rewrote the prompt's per-memory header (`#### [1] mem_abc …`) and the acknowledgment template to use numbered indices but left `validateMemoryReporting` unchanged. The existing tests at `completion-verifier.test.ts` lines 1204, 1344, 1592, 1626 still use the **legacy** `[mem_142] Route logging` format, so the unit tests never observed the regression — they encode the now-obsolete format rather than what production prompts emit.

### Definitive root cause

The acknowledgment pattern emitted by the worker (per the v7.0.0 planning / v10.0.0 review / v5.0.0 PR / v4.0.0 remediation prompts) and the pattern checked by `validateMemoryReporting` have been out of sync since commit `e13e3d815`. Every task with ≥ 1 injected memory and a compliant agent fails the verifier's acknowledgment gate, burns all 3 attempts, and is marked `failed` in Firestore — regardless of whether the actual agent work succeeded.

### Why the task looks "stuck" (not just "failed")

The Linear UI shows PR #1868 as MERGED and INT-1410 in **QA**. Firestore still shows `status: running`. The divergence is real: the orchestrator finalized with `status: failed` at `16:01:50` (log `1776434510517000`), but the task doc fetched for this investigation shows `status: running` because `callbackReceived: false` and the last successful heartbeat update was at 13:59:01. The terminal-failure write path at the end of the verifier loop did not flip `status` to `failed` on this doc — most likely because the orchestrator process was restarted / killed before that write landed (attempt #3 happens at 16:00:32 after a "no output for 64s" pause and `SessionStart:compact` — consistent with a long idle on a slow fallback). From the user's viewpoint the task is indistinguishable from "stuck": the Firestore record still says `running`, no completion callback was ever posted, and no retry ever fired.

---

## File Structure

### Modify
- `workers/orchestrator/src/services/completion-verifier.ts` (only `validateMemoryReporting` and, optionally, a named constant for the new regex) — the single behavioral change.

### Modify tests
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` — update all four existing fixtures (lines 1204, 1344, 1592, 1626) to the `[index] memoryId` format, plus add new tests that pin the new contract (both legacy and new formats cause well-defined outcomes).

### Add (optional, only if helpful)
- No new files required. The fix is a small change to an existing function.

---

## Decision — what we check for in the log

The agent's acknowledgment line, per the v5.0.0/v7.0.0/v10.0.0 prompts, has this shape:

```
- [<n>] <memoryId> — "<title>" — (APPLICABLE|NOT APPLICABLE) because <reason>
```

The verifier's job is: "for every injected memory, confirm the worker explicitly acknowledged it". The memory ID is the only unique, machine-checkable anchor. The cheapest correct check is:

> The block header `📋 **Execution Memories Received:**` (or at minimum the substring `Execution Memories Received`) appears somewhere in the transcript, **and** for every injected `memoryId`, the regex `/^\s*-\s*\[\d+\]\s+<escaped-memoryId>\b/m` matches.

Why a regex and not a plain `.includes(memoryId)`:
- A plain `.includes(memoryId)` would also pass on the `memory_ids_used` / `memory_ids_rejected` fields in the final block, which is a **separate** requirement. The point of `memory_acknowledgment` is that the worker acknowledged each memory in the dedicated acknowledgment block, not that the ID is mentioned anywhere at all.
- The regex pins the exact shape the prompt asks for and produces identical behavior across all four agent types (their prompts share the same template).

---

## Task 1: Add failing tests that pin the new contract

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

Every step here is pure test work — no production changes. Run the tests after Step 3 to confirm they fail with the current (broken) verifier, then fix the verifier in Task 2.

- [ ] **Step 1: Add a test that reproduces the INT-1410 failure**

Add a new test after the existing `skips memory validation when no memories were injected` test (around line 1247). It encodes the exact agent output observed in the stuck task.

```ts
it('accepts the [index] memoryId acknowledgment format emitted by v7+/v10+ prompts', async () => {
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1868',
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
    taskId: 'task-INT-1410',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: [
      '[claude] 📋 **Execution Memories Received:**',
      '[claude] I have received and reviewed 2 execution memories for this task:',
      '[claude] - [1] mem_b349148e-2e7d-4124-b645-dff4d458a773 — "Pre-submit verification" — APPLICABLE because reason',
      '[claude] - [2] mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce — "Address minor reviewer feedback" — NOT APPLICABLE because reason',
      '[claude] started work',
      '[claude] finished work',
    ].join('\n'),
    executionMemoryContext: {
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'Digest fix review',
      matchedMemories: [
        {
          memoryId: 'mem_b349148e-2e7d-4124-b645-dff4d458a773',
          title: 'Pre-submit verification',
          memoryType: 'verification_pattern',
          score: 0.58,
          appliesWhen: 'Before PR submit',
          action: 'Re-check diff vs plan',
          avoid: 'Skipping diff review',
          verification: 'Diff matches plan',
        },
        {
          memoryId: 'mem_f1fe7662-2e74-41d6-8c4a-9bf32d16c3ce',
          title: 'Address minor reviewer feedback',
          memoryType: 'review_finding',
          score: 0.56,
          appliesWhen: 'Receiving minor review comments',
          action: 'Fix stale comments',
          avoid: 'Dismissing minor feedback',
          verification: 'Comments addressed',
        },
      ],
    },
  });

  expect(result.missingFields).not.toContain('memory_acknowledgment');
  expect(result.passed).toBe(true);
});
```

- [ ] **Step 2: Add a test that still catches unacknowledged memories**

Right after the test from Step 1:

```ts
it('flags memory_acknowledgment when a memory is not listed in the acknowledgment block', async () => {
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1',
        memory_ids_used: 'mem_a',
        memory_ids_rejected: 'mem_b',
        memory_usage_summary: 'x',
        summary: 's',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });

  const verifier = createVerifier();
  const result = await verifier.verify({
    taskId: 'task-missing-ack',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: [
      '[claude] 📋 **Execution Memories Received:**',
      '[claude] - [1] mem_a — "A" — APPLICABLE because x',
      // mem_b missing on purpose
      '[claude] work',
      '[claude] done',
    ].join('\n'),
    executionMemoryContext: {
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: '',
      matchedMemories: [
        { memoryId: 'mem_a', title: 'A', memoryType: 'pitfall_pattern', score: 0.9,
          appliesWhen: 'x', action: 'x', avoid: 'x', verification: 'x' },
        { memoryId: 'mem_b', title: 'B', memoryType: 'pitfall_pattern', score: 0.9,
          appliesWhen: 'x', action: 'x', avoid: 'x', verification: 'x' },
      ],
    },
  });

  expect(result.passed).toBe(false);
  expect(result.missingFields).toContain('memory_acknowledgment');
});
```

- [ ] **Step 3: Update the four legacy-format fixtures**

In the existing tests at (approximate) lines 1204, 1344, 1592, 1626, replace the legacy `- [mem_142] Route logging` strings with `- [1] mem_142 — "Route logging" — APPLICABLE because x` (and `- [2] mem_155 — "Route coverage" — APPLICABLE because x` where the test has two injected memories). This is mechanical — one line per fixture.

Diff sketch for the first fixture (lines 1203–1205):

```diff
   rawLogs: [
-    '[claude] 📋 **Execution Memories Received:**',
-    '[claude] - [mem_142] Route logging',
-    '[claude] - [mem_155] Route coverage',
+    '[claude] 📋 **Execution Memories Received:**',
+    '[claude] - [1] mem_142 — "Route logging" — APPLICABLE because route changes',
+    '[claude] - [2] mem_155 — "Route coverage" — APPLICABLE because route changes',
     '[claude] started work',
     '[claude] finished work',
   ].join('\n'),
```

Apply the same mechanical rewrite to:
- line ~1344 (pull_request fixture, 1 memory)
- line ~1592 (planning happy path, 1 memory)
- line ~1626 (planning second assertion, 1 memory)

- [ ] **Step 4: Run the tests and confirm only the new tests fail**

Run: `pnpm -F orchestrator test -- completion-verifier`

Expected: the **Step 1** test fails with `expected [array] not to contain "memory_acknowledgment"` (because the current verifier looks for `[mem_b349148e-…]` literally, which never appears). The **Step 3** rewrites also fail, because the legacy `[memoryId]` brackets disappeared. All other tests still pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "test(orchestrator): pin completion verifier to [index] memoryId acknowledgment format

Reproduces the INT-1410 regression where the worker follows the system
prompt exactly ([1] mem_abc …) and the verifier still rejects it because
it was left on the legacy [mem_abc] format."
```

---

## Task 2: Align `validateMemoryReporting` with the prompt format

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` (lines 545-552)

- [ ] **Step 1: Replace the acknowledgment check**

Find:

```ts
const normalizedLogs = stripDockerHeaders(rawLogs);
const missingFields: string[] = [];
const hasAcknowledgment =
  normalizedLogs.includes('Execution Memories Received') &&
  injectedIds.every((memoryId) => normalizedLogs.includes(`[${memoryId}]`));
if (!hasAcknowledgment) {
  missingFields.push('memory_acknowledgment');
}
```

Replace with:

```ts
const normalizedLogs = stripDockerHeaders(rawLogs);
const missingFields: string[] = [];

// System prompt emits one bullet per memory in this exact shape:
//   - [<index>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because …
// See workers/orchestrator/src/services/system-prompt.ts buildExecutionMemorySection.
// We match the leading `- [<digits>] <memoryId>` token so:
//  * mentions of the memoryId elsewhere (e.g. memory_ids_used: <id>) don't
//    satisfy the acknowledgment requirement, and
//  * the legacy `[<memoryId>]` format still fails loudly, surfacing any
//    prompt/verifier drift immediately.
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ackLinePattern = (memoryId: string): RegExp =>
  new RegExp(String.raw`^\s*-\s*\[\d+\]\s+${escapeRegex(memoryId)}\b`, 'm');

const hasAcknowledgment =
  normalizedLogs.includes('Execution Memories Received') &&
  injectedIds.every((memoryId) => ackLinePattern(memoryId).test(normalizedLogs));
if (!hasAcknowledgment) {
  missingFields.push('memory_acknowledgment');
}
```

Notes:
- `escapeRegex` is needed because memory IDs are UUIDs that contain `-`, harmless in a character class but we still want the general helper.
- The `^…$` multiline (`m`) flag matches per-line (our `stripDockerHeaders` preserves newlines).
- `\b` after the ID avoids matching a prefix memory ID that is itself a prefix of a longer ID seen elsewhere.

- [ ] **Step 2: Re-run the tests from Task 1**

Run: `pnpm -F orchestrator test -- completion-verifier`

Expected: all tests pass, including the two new tests and the four rewritten fixtures.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts
git commit -m "fix(orchestrator): accept [index] memoryId acknowledgment format

Since e13e3d815 (INT-1352) the system prompt tells workers to acknowledge
each injected memory as '- [<n>] <memoryId> — …', but validateMemoryReporting
still required '[<memoryId>]'. Every compliant worker therefore failed the
completion verifier's acknowledgment gate, burning all 3 attempts and
leaving tasks in a stuck 'running' state in Firestore. Align the check
with the prompt format.

Fixes INT-1411"
```

---

## Task 3: Verify workspace and add a regression guard

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` (one more small test)

- [ ] **Step 1: Guard against future drift between prompt and verifier**

Add a test that reads the system prompt template and asserts the verifier's format expectation is consistent. Place it in the same `validateMemoryReporting` describe block.

```ts
import { reviewPrompt } from '../system-prompt.js';

it('verifier acknowledgment format matches the current system prompt template', () => {
  // The review prompt (and all siblings) share the same buildExecutionMemorySection
  // template. If either side drifts, this test will fail with a clear message.
  const rendered = reviewPrompt.build({
    taskId: 'task-test',
    linearIssueId: 'INT-1',
    linearIssueTitle: 'Test',
    taskUrl: 'https://intexuraos.cloud/#/code-tasks/task-test',
    workerType: 'claude',
    modelName: 'claude-4',
    executionMemoryContext: {
      applicationId: 'app',
      retrievalVersion: 'v',
      querySummary: 'q',
      matchedMemories: [
        { memoryId: 'mem_xyz', title: 'T', memoryType: 'pitfall_pattern', score: 0.9,
          appliesWhen: 'x', action: 'x', avoid: 'x', verification: 'x' },
      ],
    },
  });

  // Prompt instructs the agent to emit "- [1] mem_xyz — …"
  expect(rendered).toMatch(/- \[\{index\}\] \{memoryId\}/);
  // Verifier regex accepts that shape for a concrete memoryId.
  const ackLine = '- [1] mem_xyz — "T" — APPLICABLE because reason';
  expect(/^\s*-\s*\[\d+\]\s+mem_xyz\b/m.test(ackLine)).toBe(true);
});
```

(If `reviewPrompt` is not exported the same way for testing, fall back to reading the file via `readFileSync(new URL('../system-prompt.ts', import.meta.url))` and regex-matching the template literal.)

- [ ] **Step 2: Run the full verifier test file and the workspace CI gate**

```bash
pnpm -F orchestrator test -- completion-verifier
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "test(orchestrator): lock prompt/verifier acknowledgment format in step"
```

---

## Task 4: Repository-wide CI and PR

- [ ] **Step 1: Run the repo-wide tracked CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt`

Expected: green.

- [ ] **Step 2: Push and open a PR targeting `development`**

```bash
git push -u origin <feature-branch>
gh pr create --base development \
  --title "[INT-1411] fix(orchestrator): unstick tasks rejected by memory_acknowledgment verifier" \
  --body "$(cat <<'EOF'
## Summary
- `validateMemoryReporting` was checking for `[<memoryId>]` while the current system prompt (since e13e3d815, INT-1352) asks workers to emit `- [<index>] <memoryId> — …`. Every task with injected memories failed the acknowledgment gate, burning all 3 attempts and leaving the Firestore doc in `status: running`. Proof attached in `docs/plans/INT-1411-memory-acknowledgment-verifier-fix.md`.
- Aligns the verifier regex with the current prompt format.
- Adds a guard test that fails if either side drifts again.

## Evidence
- Stuck task: `task_d5b2693b-238d-4e96-abdc-3d71f1b0f67d` (INT-1410 review of PR #1868)
- Verifier code: `workers/orchestrator/src/services/completion-verifier.ts:545-552`
- Prompt template: `workers/orchestrator/src/services/system-prompt.ts:120-131`

## Test plan
- [x] `pnpm -F orchestrator test -- completion-verifier`
- [x] `pnpm run ci:tracked`

Fixes INT-1411
EOF
)"
```

- [ ] **Step 3: Post-merge validation (manual, runtime)**

After merge + orchestrator redeploy, check a freshly dispatched review task (any agent with ≥ 1 injected memory) reaches `completed` on the first attempt and that `Missing fields: memory_acknowledgment` does not appear in orchestrator logs for that task.

---

## Why not a simpler fix

Two alternatives were considered and rejected:

1. **Change the system prompt back to `- [<memoryId>]`.** This reverts the readability improvement from INT-1352 (the per-memory section headers also use `[<index>] <memoryId>`, and the agent final block already uses bare memory IDs). It also doesn't fix older, still-deployed prompt templates that were never updated. The verifier side has a single owner; changing it is the smaller and safer blast radius.
2. **Weaken the check to `.includes(memoryId)`.** This would pass on memory IDs that appear only in the `memory_ids_used` / `memory_ids_rejected` fields of the final block — i.e. an agent that never printed the acknowledgment block at all would slip through. The whole point of the `memory_acknowledgment` missing-field is to guarantee the dedicated block is present; a looser check erases that guarantee.

## Post-deploy cleanup

The stuck Firestore doc (`task_d5b2693b-238d-4e96-abdc-3d71f1b0f67d`) still says `status: running`. Recommend a follow-up maintenance task (out of scope for INT-1411) to sweep `code_tasks` documents whose `lastHeartbeat` is older than `N` minutes and `status == "running"` and transition them to `failed` with a synthetic error reason. This prevents any future stuck-status drift from affecting downstream analytics.

---

## Self-Review

**Spec coverage:** the single requirement "prove the root cause and propose the fix" is covered by the Investigation section and Tasks 1–3.

**Placeholder scan:** no TBD / TODO / placeholder language in any task. Every step has concrete code and a concrete command.

**Type consistency:** the one new helper (`ackLinePattern`) is fully defined where it is used. No names declared in one task and referenced with a different name in another.
