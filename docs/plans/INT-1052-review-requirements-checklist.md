# Improve Review Quality: Requirements Checklist & Per-Type Breakdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance automated PR reviews with a persistent requirements checklist (updated across consecutive reviews) and structured per-review-type result sections.

**Architecture:** Two changes to the review agent prompt system: (1) a "Requirements Tracker" PR comment that persists across reviews using the same append-only pattern as the automation activity log, and (2) restructured review output requiring dedicated sections per review type instead of a single condensed summary.

**Tech Stack:** TypeScript, Vitest, PromptBuilder pattern

---

## Research: Patterns from Last 10 Merged PRs

Analysis of review comments on PRs #1392–#1402 reveals:

| Pattern                      | Observation                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirements Coverage table  | Present in most reviews, but each review creates its own independently — no continuity across consecutive reviews                                                        |
| Consecutive review awareness | PR #1399 had "Prior Review Findings — Verification" section — good pattern but ad-hoc, not mandated                                                                      |
| Per-type breakdown           | Inconsistent — some reviews have separate "Architecture Assessment" / "Code Quality Assessment" sections (PR #1400), others mix all findings into one "Findings" section |
| Security section             | Often a one-liner "No security concerns" — lacks structure                                                                                                               |
| New requirements             | Never tracked — reviewers sometimes discover new requirements but have no mechanism to record them                                                                       |
| Review grades                | Not present — no at-a-glance quality signal per review type                                                                                                              |

## Design Decisions

### 1. Requirements Tracker Comment (Activity-Log Pattern)

**Mechanism:** The review agent creates/updates a dedicated PR issue comment (separate from its review body) that tracks requirements across reviews. This mirrors the automation activity log pattern in `gitHubPRAutomationLog.ts`.

**Flow:**
1. **First review on a PR:** Agent searches for existing tracker comment (pattern: `### Requirements Tracker`). Not found → POST new comment with `@ignore` header + requirements table. **Disambiguation:** If multiple comments match, use the first (oldest by creation date) and log a warning. This mirrors how the automation activity log handles its own comment discovery.
2. **Consecutive reviews:** Agent searches for existing tracker comment. Found → GET body, update table rows (change statuses, add new requirements), PATCH comment.
3. **New requirements:** When the reviewer discovers something not in the original spec (e.g., missing validation, edge case), it adds a row with `🆕` prefix in the Requirement column.

**Comment format:**
```markdown
@ignore
### Requirements Tracker

> Auto-maintained by review agent. Updated on each review pass.

| #   | Requirement                                                       | Status   | Evidence                               | Last Reviewed   |
| --- | ----------------------------------------------------------------- | -------- | -------------------------------------- | --------------- |
| 1   | Reconciler simplified to pure state sync                          | ✅ Met    | `reconcile()` only sets state field    | Review 1        |
| 2   | UI routes read from Firestore                                     | ✅ Met    | GET /branches uses gitHubPRSummaryRepo | Review 1        |
| 3   | 🆕 /prs uses lastActivityAt as createdAt — should use firstSeenAt | ⚠️ Gap   | Found during code_quality review       | Review 2        |

**Summary:** 2/2 original requirements met. 1 new requirement identified.
```

**Why a separate comment (not in the review body):**
- Review bodies are immutable once posted via `POST /reviews` — cannot be updated
- A PR issue comment can be PATCHed on each subsequent review
- Pattern matches the proven automation activity log approach

### 2. Per-Type Review Sections

**Current problem:** Reviews combine all findings into a single "Findings" section with emoji severity markers. For PRs with multiple review types, it's hard to see which type produced which findings.

**New structure — each requested review type gets a dedicated section:**

```markdown
## Automated Code Review — code_quality, security, architecture

### 🔍 Code Quality
**Verdict:** Clean / Minor issues / Needs attention
- Finding 1...
- Finding 2...

### 🔒 Security
**Verdict:** No concerns / Advisory / Blocking
- Finding 1...

### 🏗️ Architecture
**Verdict:** Sound / Minor concerns / Needs redesign
- Finding 1...

### 📐 Plan Review (only for plan_review type)
**Verdict:** Ready / Gaps found / Needs rework
- Finding 1...

> **Note:** `plan_review` is a distinct review type used for plan-only PRs (no implementation code). When `plan_review` is the only requested type, the Code Quality / Security / Architecture sections are omitted entirely — only the Plan Review section and Requirements Coverage appear.

### 📋 Requirements Coverage
| Requirement | Status     |
| ----------- | ---------- |
| ...         | ✅ / ⚠️ / ❌ |

### Overall Assessment
<synthesis across all types, 2-3 sentences>
```

**Per-type verdicts** replace the current single "Overall Assessment" blob. Each type gets a one-word verdict that provides an at-a-glance signal.

### 3. Completion Verifier Enhancement

Add `requirements_tracker_updated` field to `REVIEW_SCHEMA` so the system can track whether the tracker comment was posted/updated. This is a soft field (empty string if no requirements available).

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints

This is a prompt-only change with no endpoint modifications.

---

## File Structure

| File                                                                      | Action   | Responsibility                                                              |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`                      | Modify   | Review prompt v6.0.0 — requirements tracker + per-type sections             |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`       | Modify   | Tests for new prompt sections                                               |
| `workers/orchestrator/src/services/completion-verifier.ts`                | Modify   | Add `requirements_tracker_updated` to REVIEW_SCHEMA + verifier prompt       |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` | Modify   | Tests for updated schema                                                    |
| `workers/orchestrator/src/services/task-dispatcher.ts`                    | Modify   | Map new field from verified data to TaskResult + enrichResultForResumedTask |
| `workers/orchestrator/src/types/task.ts`                                  | Modify   | Add `requirements_tracker_updated` to TaskResult interface                  |
| `apps/code-agent/src/domain/usecases/createReviewTask.ts`                 | Modify   | Enhance user prompt to emphasize requirements validation                    |
| `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`         | Modify   | Tests for enhanced user prompt                                              |

---

## Task 1: Orchestrator — Review Prompt v6.0.0 + Completion Verifier

**Service:** `workers/orchestrator`
**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (lines 561-731)
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` (lines 63-69, 109-116, 229-248)
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (result mapping + enrichResultForResumedTask)
- Modify: `workers/orchestrator/src/types/task.ts` (TaskResult interface)

**Contract with Task 2:** Task 2 (code-agent) builds the user prompt that includes `### Issue Requirements` and `### Plan Document` sections. These sections remain unchanged — Task 1 only modifies how the system prompt instructs the agent to USE that information. No shared types change.

### Step-by-step

- [ ] **Step 1: Write failing test for requirements tracker instructions in prompt**

Add a test in `system-prompt.test.ts` that verifies the review prompt output contains the `### Requirements Tracker Comment` section with instructions for creating/updating the tracker PR comment.

```typescript
it('includes requirements tracker comment instructions', () => {
  const result = reviewPrompt.build(baseParams);
  expect(result).toContain('### Requirements Tracker Comment');
  expect(result).toContain('@ignore');
  expect(result).toContain('### Requirements Tracker');
  expect(result).toContain('PATCH');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /repo && pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts -t "requirements tracker"
```

- [ ] **Step 3: Add Requirements Tracker Comment section to review prompt**

In `system-prompt.ts`, inside `reviewPrompt.build()`, add a new section AFTER "### Requirements Validation" and BEFORE "### Plan Compliance". This section instructs the agent to:

1. After posting the review, search for existing `### Requirements Tracker` comment on the PR
2. If not found: POST a new PR issue comment with the tracker table
3. If found: GET the comment body, update statuses and add new requirements, PATCH the comment
4. Include `🆕` prefix for requirements discovered during review

The section should include:
- The exact comment format template (with `@ignore` header)
- Table columns: `#`, `Requirement`, `Status`, `Evidence`, `Last Reviewed`
- Valid status values: `✅ Met`, `⚠️ Partial`, `❌ Missing`, `🔍 Not yet verified`
- Instructions for finding the comment: search PR issue comments for body containing `### Requirements Tracker`
- Instructions for new requirements: add with `🆕` prefix, explain where the requirement was discovered

Bump version to `6.0.0` (major: behavioral change in review output).

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /repo && pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts -t "requirements tracker"
```

- [ ] **Step 5: Write failing test for per-type review sections in prompt**

```typescript
it('includes per-type review section structure', () => {
  const result = reviewPrompt.build(baseParams);
  expect(result).toContain('### Per-Type Review Structure');
  expect(result).toContain('🔍 Code Quality');
  expect(result).toContain('🔒 Security');
  expect(result).toContain('🏗️ Architecture');
  expect(result).toContain('Verdict:');
});
```

- [ ] **Step 6: Run test — expect FAIL**

- [ ] **Step 7: Add Per-Type Review Structure section to review prompt**

Replace/enhance the current "### Posting Review Comments" section's guidance on review body structure. Add a new section `### Per-Type Review Structure (MANDATORY)` that mandates:

1. Each requested review type gets its own `###` section with emoji prefix
2. Each section has a `**Verdict:**` line with one of the defined values
3. Findings are listed under their respective type section
4. A `### 📋 Requirements Coverage` section always appears (with table)
5. A `### Overall Assessment` section provides synthesis across types (2-3 sentences)

Include the exact template the agent must follow.

- [ ] **Step 8: Run test — expect PASS**

- [ ] **Step 9: Write failing test for updated REVIEW_SCHEMA**

In `completion-verifier.test.ts`:

```typescript
it('REVIEW_SCHEMA accepts requirements_tracker_updated field', () => {
  const result = REVIEW_SCHEMA.safeParse({
    gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
    review_comments_posted: '3',
    review_types: 'code_quality,security',
    requirements_tracker_updated: 'yes',
    summary: 'Review summary.',
  });
  expect(result.success).toBe(true);
});

it('REVIEW_SCHEMA accepts empty requirements_tracker_updated', () => {
  const result = REVIEW_SCHEMA.safeParse({
    gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
    review_comments_posted: '3',
    review_types: 'code_quality,security',
    requirements_tracker_updated: '',
    summary: 'Review summary.',
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 10: Run test — expect FAIL**

- [ ] **Step 11: Add `requirements_tracker_updated` to REVIEW_SCHEMA**

In `completion-verifier.ts`:

```typescript
export const REVIEW_SCHEMA = z.object({
  gh_pr_url: z.string(),
  review_comments_posted: z
    .string()
    .regex(/^\d+$/, 'review_comments_posted must be a numeric string'),
  review_types: z.string().trim().min(1, 'review_types must not be empty'),
  requirements_tracker_updated: z.string().optional().default(''), // 'yes', 'no', or '' if no requirements
  summary: z.string(),
});
```

Update `ReviewAgentData` interface to include `requirements_tracker_updated?: string`.

**Important:** The field MUST be optional (with `.optional().default('')`) to avoid breaking the 7 existing `REVIEW_SCHEMA.safeParse()` tests in `completion-verifier.test.ts` (lines 229-295) that don't include this field. The `.default('')` ensures the field is always present in the parsed output.

Update `buildReviewPrompt()` in `completion-verifier.ts` (lines 229-248). Specifically:
- Add to the `Fields:` list: `- requirements_tracker_updated: "yes" if tracker comment was created/updated, "no" if skipped, empty string if no requirements available`
- Update the example JSON to include: `"requirements_tracker_updated":"yes"`

- [ ] **Step 12: Run test — expect PASS**

- [ ] **Step 13: Update REVIEW_AGENT_FINAL block in system prompt**

In the `### Completion Criteria` section of the review prompt, update the REVIEW_AGENT_FINAL block to include:

```
REVIEW_AGENT_FINAL:
- PR: <full GitHub PR URL>
- review_comments_posted: <number of review comments posted>
- review_types: <comma-separated list of review types performed>
- requirements_tracker_updated: <yes|no — whether the requirements tracker comment was created/updated>
- Summary: <3-5 sentences on one line: what you reviewed, key findings, overall quality assessment>
```

- [ ] **Step 14: Write failing test for task-dispatcher result mapping**

Write a test that verifies when `verifiedData` contains `requirements_tracker_updated`, the resulting `TaskResult` includes `requirements_tracker_updated`. Follow the pattern of existing review result mapping tests in `task-dispatcher.test.ts`.

- [ ] **Step 15: Run test — expect FAIL**

- [ ] **Step 16: Update TaskResult interface and task-dispatcher.ts result mapping**

In `workers/orchestrator/src/types/task.ts`, add `requirements_tracker_updated?: string` to the `TaskResult` interface.

In `task-dispatcher.ts`, in the review result mapping section (~lines 1211-1244), add:

```typescript
if (verifiedData.requirements_tracker_updated !== undefined) {
  result.requirements_tracker_updated = verifiedData.requirements_tracker_updated;
}
```

Also update `enrichResultForResumedTask` to preserve `requirements_tracker_updated` from `lastSuccessResult` for resumed review tasks, matching the existing pattern for `review_comments_posted` and `review_types`.

- [ ] **Step 17: Run test — expect PASS**

- [ ] **Step 18: Run full workspace verification**

```bash
cd /repo && pnpm run verify:workspace:tracked orchestrator
```

- [ ] **Step 19: Commit**

```bash
git add workers/orchestrator/
git commit -m "feat(orchestrator): review prompt v6.0.0 — requirements tracker + per-type breakdown

- Add Requirements Tracker Comment section: persistent PR comment updated across reviews
- Add Per-Type Review Structure: dedicated sections per review type with verdicts
- Add requirements_tracker_updated field to REVIEW_SCHEMA and completion verifier
- Update REVIEW_AGENT_FINAL block with new field
- Bump reviewPrompt version to 6.0.0"
```

---

## Task 2: Code-Agent — Enhance Review User Prompt

**Service:** `apps/code-agent`
**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts` (lines 155-213)
- Modify: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`

**Contract with Task 1:** This task modifies only the user prompt (task context) built by `buildReviewPrompt()`. The system prompt (Task 1) instructs the agent how to process this context. The `### Issue Requirements` and `### Plan Document` section names and structure remain unchanged — they are the contract between user prompt and system prompt.

### Step-by-step

- [ ] **Step 1: Write failing test for enhanced requirements emphasis in user prompt**

In `createReviewTask.test.ts`, add a test that verifies the user prompt includes explicit requirements validation emphasis:

```typescript
it('user prompt emphasizes requirements validation when issue description is present', async () => {
  // Setup with issue description
  const result = await createReviewTask(deps, requestWithDescription);
  // Get the prompt from the enqueued task
  const prompt = taskEnqueueService.lastEnqueued?.prompt;
  expect(prompt).toContain('CRITICAL: Verify every requirement below');
  expect(prompt).toContain('### Issue Requirements');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts -t "emphasizes requirements"
```

- [ ] **Step 3: Enhance `buildReviewPrompt` requirements section**

In `createReviewTask.ts`, modify the `buildReviewPrompt` function. When `issueDescription` is present, add emphasis text before the description:

```typescript
if (request.issueDescription !== undefined) {
  lines.push(
    '',
    '### Issue Requirements',
    '',
    '**CRITICAL: Verify every requirement below against the PR implementation.**',
    'Missing or partially implemented requirements are 🔴 findings.',
    '',
    request.issueDescription.length > ISSUE_DESCRIPTION_MAX_LENGTH
      ? `${request.issueDescription.slice(0, ISSUE_DESCRIPTION_MAX_LENGTH)}...\n\n(Truncated — full description available in the Linear issue)`
      : request.issueDescription,
  );
  // ... plan document section unchanged
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Run full workspace verification**

```bash
cd /repo && pnpm run verify:workspace:tracked code-agent
```

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/
git commit -m "feat(code-agent): emphasize requirements validation in review user prompt

- Add CRITICAL emphasis before Issue Requirements section
- Instruct agent to flag missing requirements as 🔴 findings"
```
