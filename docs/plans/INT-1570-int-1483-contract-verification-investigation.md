# INT-1570 — INT-1483 Contract Verification Failure: Investigation & Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose why the latest review task on INT-1483 (`task_3a8ee180-c59f-461b-b1a2-0e374e142d90`) failed with `REVIEW_AGENT_ENFORCEMENT_FAILED`, document a recovery path for the current state, and harden two contract layers so the same class of failure cannot recur.

**Architecture:** Two-layer fix — (1) make the orchestrator block-parser leniently extract a leading integer from `kind: 'int'` fields so a parenthesized annotation like `0 (review submitted as single body with no inline comments)` no longer collapses to `null`; (2) soft-default `review_comments_posted` in `code-agent` `enforceReviewOutcome` when `review_id` is present (the review IS posted, the count is bookkeeping). Add unit tests for both. No schema, prompt, or runtime topology changes.

**Tech Stack:** TypeScript (strict), Node 22, Vitest, Fastify (`code-agent`), Cloud Functions (`orchestrator`), Firestore.

---

## 1. Investigation Findings

### 1.1 Failed task chain (Linear INT-1483)

| Field          | Value                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Linear issue   | INT-1483 (`[SEC] Shell injection in orchestrator …`)                                                             |
| Latest plan PR | https://github.com/pbuchman/intexuraos/pull/1964 (OPEN, all required CI green)                                   |
| Latest task    | `task_3a8ee180-c59f-461b-b1a2-0e374e142d90` (review, glm worker)                                                 |
| Status         | `failed`                                                                                                         |
| Error code     | `REVIEW_AGENT_ENFORCEMENT_FAILED`                                                                                |
| Error message  | `Review enforcement requires result.review_comments_posted`                                                      |
| Retry chain    | `task_5cbcf4c5…` → `task_a8b535f0…` (drain dispatch failure: `worker_unavailable`) → `task_3a8ee180…` (this one) |

The orchestrator log shows `[orchestrator] Completion verification passed` immediately followed by the webhook callback to `code-agent`, and `code-agent` rejecting it.

### 1.2 What the agent actually emitted

From `code_tasks/task_3a8ee180-…/log_lines`:

```
REVIEW_AGENT_FINAL:
- PR: https://github.com/pbuchman/intexuraos/pull/1964
- review_id: 4175520278
- review_comments_posted: 0 (review submitted as single body with no inline comments)
- review_types: plan_review
- requirements_tracker_updated: yes (created new tracker comment with 11 requirements tracked)
- gh_actions_status: all passed (Coverage Check, E2E Tests, Tests, Lint, Build & Format, Terraform, Validation, E2E Isolation, Type Check all SUCCESS)
- needs_remediation: 0 (plan is ready for implementation; gaps found are documentation enhancements, not blocking issues)
- memory_ids_used: mem_0881904f-efa7-4f66-acf5-32ae1abf4d32
- memory_ids_rejected: mem_5afdde5a-21b1-4901-a18e-809e4335c154, mem_ea53ecb5-d816-479b-9795-37257267ddb9
- memory_usage_summary: Applied shell injection prevention pattern memory…
- Summary: …
```

The agent **did** emit `review_comments_posted` — but with a parenthesized annotation after the integer.

### 1.3 The four-layer chain that produced the failure

1. **Block parser strict int rule** (`workers/orchestrator/src/services/completion-verifier/block-parser.ts:336-343`) — accepts only `/^-?\d+$/`. The value `0 (review submitted as single body with no inline comments)` is NOT a pure integer, so the parser sets `data['review_comments_posted'] = null` and pushes a non-fatal warning.
2. **Contract marks the field optional** (`workers/orchestrator/src/services/completion-verifier/contracts.ts:195`): `{ name: 'review_comments_posted', kind: 'int', required: false }`. So `missingRequired` stays empty and the orchestrator logs `Verified: missingRequired=0`. No retry / `ask_llm` is triggered.
3. **Webhook builder drops nulls** (`workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts:186-191`): only assigns when `typeof === 'number' || 'string'`. `null` is silently omitted from the result payload.
4. **Code-agent enforcement is strict** (`apps/code-agent/src/domain/usecases/handleTaskCompletion.ts:828-845`): `if (reviewResult.review_comments_posted === undefined) → REVIEW_AGENT_ENFORCEMENT_FAILED`.

The work was actually done — review `4175520278` is on PR #1964, the requirements tracker comment is posted, all CI is green. Only bookkeeping failed.

### 1.4 Why the earlier retry also failed

Predecessor `task_5cbcf4c5-c969-4acc-a4b4-bb4b21923fe0` was archived with `worker_unavailable: All worker health probes failed` — unrelated to the contract bug. That triggered the manual retry path which created `task_3a8ee180-…`. So this is a *single* contract failure, not a recurring one across retries.

### 1.5 Recovery path for INT-1483 (current state)

PR #1964 is intact, the GitHub review (`4175520278`) is intact, the Requirements Tracker comment is intact, CI is green. Two valid recovery options:

| Option                 | Action                                                                                                                                                                                                                                                                   | When to use                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| A — Manual merge       | User merges PR #1964 directly; INT-1483 progresses to implementation tasks via the existing orchestration pipeline.                                                                                                                                                      | Preferred. The plan PR is already approved-by-CI and the review verdict was "Ready for implementation".         |
| B — Re-dispatch review | Trigger a fresh review task on PR #1964. The agent will detect the existing `### Requirements Tracker` comment (per `review-prompt.ts:309-310`) and PATCH it instead of duplicating, and post a second top-level review. Acceptable but produces duplicate review noise. | Only if the user wants the failed task to flip green in the Linear/Firestore audit trail without changing code. |

**No** Firestore mutation is required for option A — `code_tasks/task_3a8ee180-…` can stay `failed`; the task console will show the error code, the Linear issue advances independently. Editing the Firestore doc to flip `status` is discouraged: the failure record is auditable evidence of the bug.

### 1.6 Blast radius

Any review task that produces a `kind: 'int'` field with an annotation will hit the same bug. Searching git history confirms `review_comments_posted` is the only reviewer-emitted `int` field, so the practical impact is bounded to review tasks. Other `int` fields (`needs_remediation` is `bool01`, planning has none beyond bools) are not affected — but the parser fix is a generic improvement.

---

## 2. Endpoint Changes

* **Modified:** None.
* **Created:** None.
* **Removed:** None.
* **Unchanged:** All HTTP endpoints. The webhook payload shape is unchanged for already-correct inputs; previously-rejected payloads with annotated integers will now be coerced and accepted.

---

## 3. File Map

| File                                                                                                                         | Responsibility                                                           | Action                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier/block-parser.ts`                                                      | Per-field coercion of parsed `AGENT_FINAL` blocks.                       | Modify the `kind: 'int'` branch to extract a leading optional-sign integer when followed by whitespace and an optional `(…)` annotation.                                                                                                                         |
| `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` (or existing equivalent — see Task 0) | Unit tests for `coerceFields`.                                           | Add 3 cases: pure int, annotated int, unparseable int.                                                                                                                                                                                                           |
| `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`                                                                | `enforceReviewOutcome` runs after the webhook; rejects bookkeeping gaps. | Soft-default: when `review_comments_posted` is missing/non-numeric AND `review_id` is present, treat as `'0'` and emit a `requestLog.warn(...)` with the original value. Still hard-reject when `review_id` is also absent (real review failure).                |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                                                                      | Existing route-level tests for `handleTaskCompletion`.                   | Add 1 test: review payload with `review_id` set and `review_comments_posted` undefined → completes (status `completed`) and emits warn log. Update the existing "fails review enforcement when review_comments_posted is …" tests to keep `review_id` undefined. |

---

## 4. Tasks

### Task 0: Verify the parser test file location

**Files:**
- Inspect: `workers/orchestrator/src/__tests__/services/completion-verifier/`

- [ ] **Step 1: List existing parser tests**

```bash
ls workers/orchestrator/src/__tests__/services/completion-verifier/ | grep -i 'block-parser\|coerce'
```

Expected: Either `block-parser.test.ts` exists OR `coerceFields` is tested inside a sibling file. If neither, create `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` in Task 1.

- [ ] **Step 2: Confirm field-spec import path**

```bash
rg "from.*block-parser" workers/orchestrator/src --files-with-matches | head -5
```

Expected: at least one match showing the public export style.

No commit — investigation only.

---

### Task 1: Test-first — add failing parser cases for annotated integers

**Files:**
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` (create if Task 0 found nothing)
- Reference: `workers/orchestrator/src/services/completion-verifier/block-parser.ts:335-345`
- Reference: `workers/orchestrator/src/services/completion-verifier/contracts.ts:24-29` (`AgentContract` shape)

- [ ] **Step 1: Add the failing test block**

Append (or create the file with) the following block inside the test file. Use the existing import / setup pattern observed in Task 0; if the file is new, mirror the import style of `workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { coerceFields } from '../../../services/completion-verifier/block-parser.js';
import type { AgentContract } from '../../../services/completion-verifier/contracts.js';

const intOnlyContract: AgentContract = {
  marker: 'TEST_AGENT_FINAL:',
  fields: [{ name: 'count', kind: 'int', required: false }],
};

describe('coerceFields int leniency', () => {
  it('accepts pure integer', () => {
    const result = coerceFields({ count: '5' }, intOnlyContract);
    expect(result.data.count).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('extracts leading integer followed by parenthesized annotation', () => {
    const result = coerceFields(
      { count: '0 (review submitted as single body with no inline comments)' },
      intOnlyContract
    );
    expect(result.data.count).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('extracts negative leading integer with annotation', () => {
    const result = coerceFields(
      { count: '-3 (failed sub-checks)' },
      intOnlyContract
    );
    expect(result.data.count).toBe(-3);
  });

  it('still rejects fully non-numeric', () => {
    const result = coerceFields({ count: 'two' }, intOnlyContract);
    expect(result.data.count).toBe(null);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not a valid int')])
    );
  });
});
```

- [ ] **Step 2: Run the new tests — they MUST fail**

```bash
pnpm --filter orchestrator test -- block-parser
```

Expected: the 2 leniency cases (`extracts leading integer …`, `extracts negative leading integer …`) FAIL because the current regex only matches `^-?\d+$`. The pure-integer and rejection cases pass.

No commit yet.

---

### Task 2: Implement the leniency fix in `block-parser.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/block-parser.ts:335-345`

- [ ] **Step 1: Replace the int branch**

Replace the existing `case 'int': { … }` block (currently at lines 335-345) with:

```typescript
case 'int': {
  // Accept a pure integer literal (optional sign), OR a leading integer
  // followed by whitespace and an optional parenthesized annotation, e.g.
  // "0 (review submitted as single body with no inline comments)".
  // Reject non-numeric tokens like "two" or "n/a".
  const intMatch = /^(-?\d+)(?:\s+\(.*\))?$/.exec(trimmed);
  if (intMatch !== null && intMatch[1] !== undefined) {
    data[field.name] = Number.parseInt(intMatch[1], 10);
  } else {
    data[field.name] = null;
    warnings.push(`field ${field.name} not a valid int: ${trimmed}`);
  }
  break;
}
```

Key constraints:
- Keep behavior identical for pure integers (no regression).
- The `(?:\s+\(.*\))?` group is optional and non-capturing; it must consume `\s+` BEFORE `(`.
- Use `intMatch[1]` (not `intMatch[0]`) so the parenthesized tail is excluded.
- Use `?? fallback` is not needed because `intMatch[1] !== undefined` is checked explicitly.

- [ ] **Step 2: Run the parser tests — they MUST pass**

```bash
pnpm --filter orchestrator test -- block-parser
```

Expected: all 4 cases PASS.

- [ ] **Step 3: Run the full orchestrator verifier suite**

```bash
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: green. If any pre-existing fixture test depended on the strict regex (none expected — fixtures are recordings of compliant agent output), update the assertion.

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier/block-parser.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts
git commit -m "fix(orchestrator): accept leading integer with annotation in AGENT_FINAL int fields

The block parser strictly required \`/^-?\\d+\$/\` for kind: 'int' fields,
which collapsed values like \`0 (review submitted as single body with no
inline comments)\` to null. Combined with required: false on
\`review_comments_posted\` (contracts.ts:195), this silently dropped the
field and the downstream code-agent enforcer rejected the webhook with
REVIEW_AGENT_ENFORCEMENT_FAILED.

Make the parser lenient: extract the leading integer when followed by
\`\\s+(...)\`. Pure integers and unparseable values are unchanged.

INT-1570 — see docs/plans/INT-1570-int-1483-contract-verification-investigation.md"
```

---

### Task 3: Test-first — add failing code-agent soft-default case

**Files:**
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (extend existing review-enforcement section)
- Reference: `apps/code-agent/src/__tests__/routes/webhooks.test.ts:10638-10644` (existing strict-rejection test)

- [ ] **Step 1: Locate the existing review enforcement test cluster**

```bash
rg -n "review_comments_posted" apps/code-agent/src/__tests__/routes/webhooks.test.ts | head -10
```

Expected: matches around lines 10638-10644 and 10644-10650 (numeric check). Add the new test in the same `describe` block.

- [ ] **Step 2: Add the soft-default test**

Append within the same `describe` block as the existing review enforcement tests:

```typescript
it('soft-defaults review_comments_posted to "0" when review_id is present (fixes INT-1570)', async () => {
  // Arrange a review task whose webhook callback omits review_comments_posted
  // but provides review_id and review_types. Mirror existing setup in this file.
  const { task, payload } = await arrangeReviewWebhook({
    result: {
      pr: 'https://github.com/pbuchman/intexuraos/pull/1964',
      review_id: '4175520278',
      review_types: 'plan_review',
      // review_comments_posted intentionally omitted
      summary: 'review ok',
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/orchestrator/task-completion',
    headers: { 'x-orchestrator-secret': webhookSecret },
    payload,
  });

  expect(response.statusCode).toBe(200);
  const stored = await codeTaskRepo.findById(task.id);
  expect(stored.ok).toBe(true);
  if (!stored.ok) throw new Error('Failed to fetch task');
  expect(stored.value.status).toBe('completed');
  expect(stored.value.error).toBeUndefined();
  expect(stored.value.result?.review_comments_posted).toBe('0');
});

it('still rejects review payload missing both review_id and review_comments_posted', async () => {
  const { task: _task, payload } = await arrangeReviewWebhook({
    result: {
      pr: 'https://github.com/pbuchman/intexuraos/pull/1964',
      review_types: 'plan_review',
      summary: 'review ok',
      // review_id and review_comments_posted both missing
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/orchestrator/task-completion',
    headers: { 'x-orchestrator-secret': webhookSecret },
    payload,
  });

  // Webhook still 200 (acknowledgment), but the task is failed.
  expect(response.statusCode).toBe(200);
  const stored = await codeTaskRepo.findById(_task.id);
  if (!stored.ok) throw new Error('Failed to fetch task');
  expect(stored.value.status).toBe('failed');
  expect(stored.value.error?.code).toBe('REVIEW_AGENT_ENFORCEMENT_FAILED');
});
```

If `arrangeReviewWebhook` does not exist in this file under that exact name, rename it to whatever helper the file already uses for review-enforcement tests (`rg "agentType: 'review'" apps/code-agent/src/__tests__/routes/webhooks.test.ts -n` will reveal the pattern).

- [ ] **Step 3: Run the new tests — soft-default MUST fail, missing-review_id MUST pass**

```bash
pnpm --filter code-agent test -- webhooks
```

Expected: the soft-default test FAILS (current code rejects). The "still rejects" test PASSES (current code already rejects when review_comments_posted is missing).

No commit yet.

---

### Task 4: Implement the soft-default in `enforceReviewOutcome`

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts:828-857`

- [ ] **Step 1: Replace the `enforceReviewOutcome` body**

Replace lines 828-857 with:

```typescript
const enforceReviewOutcome = (
  reviewResult: NonNullable<typeof result>
): { ok: true } | { ok: false; message: string; code: string } => {
  // [INT-1570] Soft-default review_comments_posted when review_id proves a
  // review was actually posted. The orchestrator block-parser silently drops
  // annotated integers (e.g. "0 (no inline comments)") and we must not fail
  // an otherwise-successful review on bookkeeping. If review_id is missing
  // OR present-but-non-numeric, the value is unrecoverable — hard fail.
  const hasReviewId =
    reviewResult.review_id !== undefined && reviewResult.review_id.trim() !== '';
  const rawCount = reviewResult.review_comments_posted;
  const countIsValid = typeof rawCount === 'string' && /^\d+$/.test(rawCount);

  if (!countIsValid) {
    if (hasReviewId) {
      requestLog.warn(
        { taskId, rawReviewCommentsPosted: rawCount },
        'review_comments_posted missing or non-numeric; defaulting to "0" because review_id is present'
      );
      reviewResult.review_comments_posted = '0';
    } else {
      return {
        ok: false,
        code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
        message:
          rawCount === undefined
            ? 'Review enforcement requires result.review_comments_posted'
            : 'Review enforcement requires result.review_comments_posted to be a non-negative integer string',
      };
    }
  }

  const trimmedReviewTypes = reviewResult.review_types?.trim();
  if (trimmedReviewTypes === undefined || trimmedReviewTypes === '') {
    return {
      ok: false,
      code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
      message: 'Review enforcement requires result.review_types',
    };
  }

  return { ok: true };
};
```

Constraints:
- `requestLog` is already in scope at this point in `handleTaskCompletion`. If linting complains, replace with `logger`.
- The function still mutates `reviewResult` (existing behavior elsewhere in this file). Acceptable per `services.ts` semantics.
- Do NOT relax the `review_types` check — that field is independent and unaffected.

- [ ] **Step 2: Run the affected tests**

```bash
pnpm --filter code-agent test -- webhooks handleTaskCompletion
```

Expected: all 3 review-enforcement tests pass (the new soft-default + the two original strict-rejection tests, where the original ones had `review_id` undefined; verify by reading them or update if they had `review_id` set).

If the original tests had `review_id` set AND `review_comments_posted` undefined, they will now flip from "failed" to "completed". Read each one:

```bash
rg -n "REVIEW_AGENT_ENFORCEMENT_FAILED" apps/code-agent/src/__tests__/routes/webhooks.test.ts -B 30 | head -120
```

For any test where the previous expectation was `status === 'failed'` but the payload had `review_id` set with `review_comments_posted` missing, change the expectation to match the new soft-default behavior. Update test descriptions accordingly (per execution memory mem_ea53ecb5: stale descriptions are a known pitfall).

- [ ] **Step 3: Run full code-agent verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: green, including 95% branch coverage on the modified function. Add `/* v8 ignore */` only if a branch is truly untestable per the coverage-exemptions rules — none expected here; the soft-default branch and the hard-fail branch are both directly exercised by the tests above.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/handleTaskCompletion.ts \
        apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): soft-default review_comments_posted when review_id proves review was posted

Previously, if the review agent emitted \`review_comments_posted: 0
(review submitted as single body with no inline comments)\` the
orchestrator block-parser dropped the value (annotated integers were
rejected — fixed in companion commit) and code-agent's
\`enforceReviewOutcome\` then failed the entire task with
REVIEW_AGENT_ENFORCEMENT_FAILED, even though the GitHub review was
posted successfully (review_id 4175520278 on PR #1964 — see INT-1483).

Soft-default to '0' when review_id is present, hard-fail when both
review_id and review_comments_posted are missing.

INT-1570 — see docs/plans/INT-1570-int-1483-contract-verification-investigation.md"
```

---

### Task 5: Repo-wide verification

**Files:** none (CI run)

- [ ] **Step 1: Run repo-root CI**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1570.txt
```

Expected: green. If any other workspace fails, audit and fix per the CLAUDE.md "Code Auditing" rule before opening the PR.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "[INT-1570] [fix] Recover INT-1483 contract failure: lenient int parsing + soft-default review enforcement" \
  --base development \
  --body "$(cat <<'EOF'
## Summary
- Fix the silent contract-verification failure that broke INT-1483's plan review (`task_3a8ee180-c59f-461b-b1a2-0e374e142d90`).
- Make the orchestrator block-parser lenient for `kind: 'int'` fields, accepting a leading integer followed by `\s+(...)` annotation.
- Soft-default `review_comments_posted` to `'0'` in `code-agent` `enforceReviewOutcome` when `review_id` is present.

Fixes INT-1570
Recovers INT-1483 (no Firestore mutation needed; PR #1964 stays open and CI-green for direct merge).

## Test plan
- [ ] `pnpm --filter orchestrator test -- block-parser` — 4 cases (pure, annotated positive, annotated negative, garbage).
- [ ] `pnpm --filter code-agent test -- webhooks` — soft-default + still-rejects tests.
- [ ] `pnpm run ci:tracked` from repo root.

## Decision Log
| Decision                                                         | Source                                                                                                                                                              | Impact                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Two-layer fix instead of single-layer                            | Investigation showed the silent failure straddles orchestrator (parser) and code-agent (enforcer); fixing only one leaves the other layer fragile to similar drift. | Both layers now resilient to LLM-emitted annotated integers.        |
| Soft-default rather than tightening contract to `required: true` | Memory mem_9df4cebd-33f7-4b07-92a5-087c000722c3 (soft-fail bookkeeping validation). The review IS posted; rejecting on missing count loses real work.               | `review_id` becomes the proof-of-work; count is bookkeeping.        |
| Do NOT mutate `code_tasks/task_3a8ee180-…` in Firestore          | The failure is auditable evidence of the bug. Recovery option A (manual PR merge) is sufficient.                                                                    | INT-1483 advances via PR #1964 merge; the failed task stays failed. |

Orchestrated with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

Expected: PR URL printed.

---

## 5. Recovery Procedure for INT-1483 (separate from this plan)

This plan ships the *fix*. The *recovery* of INT-1483 is independent and chosen by the user:

- **Recommended:** Merge PR #1964 (https://github.com/pbuchman/intexuraos/pull/1964). CI is green and the GitHub review (4175520278) was posted with verdict "Ready for implementation". The plan-PR's purpose is fulfilled.
- **Optional:** After this fix lands, re-dispatch a review on PR #1964 to flip the task console green. Will produce a duplicate top-level review on the PR and PATCH the existing Requirements Tracker comment.

No data-fixup script is needed.

## 6. Self-Review Notes

- **Spec coverage:** Investigation (§1), recovery (§1.5, §5), fix tasks (§4 Tasks 1-5). Done.
- **Placeholder scan:** None.
- **Type consistency:** `review_comments_posted` is `string` after coercion (per `webhook-callbacks.ts:188-190`); both the soft-default branch and the regex check use `string`. Consistent.
