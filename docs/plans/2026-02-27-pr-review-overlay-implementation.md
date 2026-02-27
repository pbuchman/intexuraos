# PR Review Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Append a conditional PR review section to execution and planning system prompts so agents can handle PR review messages regardless of original task type.

**Architecture:** Add `buildPRReviewOverlay(params)` to `system-prompt.ts`. Append its output to both `buildExecutionPrompt()` and `buildPlanningPrompt()` return values inside `buildSystemPrompt()`. The `buildPullRequestPrompt()` path is unchanged (it already has these instructions natively).

**Tech Stack:** TypeScript, Vitest

**Design doc:** `docs/plans/2026-02-27-pr-review-overlay-for-execution-planning.md`

---

### Task 1: Write failing tests for PR review overlay on execution prompt

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write the failing test**

Add this test to the existing `describe('system-prompt')` block:

```typescript
it('includes PR review overlay in execution prompt', () => {
  const result = buildSystemPrompt({
    ...baseParams,
    linearIssueLabels: ['code-task'],
    taskUrl: 'https://intexuraos.cloud/tasks/task-123',
  });

  expect(result).toContain('[PR REVIEW MODE');
  expect(result).toContain('Detecting PR Review Intent');
  expect(result).toContain('Gathering Feedback');
  expect(result).toContain('Tracking Comment');
  expect(result).toContain('PULL_REQUEST_AGENT_FINAL:');
  expect(result).toContain('https://intexuraos.cloud/tasks/task-123');
  // Must still have the base execution markers
  expect(result).toContain('[AGENT:EXECUTION]');
  expect(result).toContain('EXECUTION_AGENT_FINAL:');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm --filter orchestrator test -- --run -t "includes PR review overlay in execution prompt"`
Expected: FAIL — execution prompt does not yet contain `[PR REVIEW MODE`

---

### Task 2: Write failing tests for PR review overlay on planning prompt

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write the failing test**

```typescript
it('includes PR review overlay in planning prompt', () => {
  const result = buildSystemPrompt({
    ...baseParams,
    linearIssueLabels: ['bug'],
    taskUrl: 'https://intexuraos.cloud/tasks/task-123',
  });

  expect(result).toContain('[PR REVIEW MODE');
  expect(result).toContain('Detecting PR Review Intent');
  expect(result).toContain('Gathering Feedback');
  expect(result).toContain('Tracking Comment');
  expect(result).toContain('PULL_REQUEST_AGENT_FINAL:');
  // Must still have the base planning markers
  expect(result).toContain('[AGENT:PLANNING]');
  expect(result).toContain('PLANNING_AGENT_FINAL:');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm --filter orchestrator test -- --run -t "includes PR review overlay in planning prompt"`
Expected: FAIL

---

### Task 3: Write failing test — PR prompt does NOT include overlay

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write the failing test**

```typescript
it('does not include PR review overlay in pull request prompt (already native)', () => {
  const result = buildSystemPrompt({
    ...baseParams,
    linearIssueLabels: ['code-task', 'pr-comment'],
  });

  expect(result).toContain('[AGENT:PULL_REQUEST]');
  expect(result).not.toContain('[PR REVIEW MODE');
});
```

**Step 2: Run test to verify it passes**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm --filter orchestrator test -- --run -t "does not include PR review overlay"`
Expected: PASS (the PR prompt currently doesn't contain `[PR REVIEW MODE`, so this assertion holds already). This is a guard test — it ensures we don't accidentally double-inject.

---

### Task 4: Write failing test — overlay taskUrl interpolation

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write the failing test**

```typescript
it('renders PR review overlay without task URL when taskUrl is undefined', () => {
  const result = buildSystemPrompt({
    ...baseParams,
    linearIssueLabels: ['code-task'],
  });

  expect(result).toContain('[PR REVIEW MODE');
  expect(result).not.toContain('View progress');
  expect(result).not.toContain('View task');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm --filter orchestrator test -- --run -t "renders PR review overlay without task URL"`
Expected: FAIL — overlay doesn't exist yet

---

### Task 5: Implement `buildPRReviewOverlay()` and wire into `buildSystemPrompt()`

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:238-254`

**Step 1: Add the `buildPRReviewOverlay` function**

Add this function before `buildSystemPrompt()` (around line 237):

```typescript
function buildPRReviewOverlay(params: SystemPromptParams): string {
  const { taskUrl } = params;
  /* v8 ignore start -- source-map: template conditional branches are misattributed after bundling/source-map transforms @preserve */
  return `

[PR REVIEW MODE — CONDITIONAL]

If the incoming message is about a PR review, code review feedback, PR comment,
or any request to address changes on a pull request, activate the behaviors below.
If the message is NOT about PR feedback, IGNORE this entire section and use your
normal completion block above.

### Detecting PR Review Intent

Activate this section when the message:
- Contains PR review content (review state, inline comments, change requests)
- Asks you to address PR feedback or review comments
- References specific code review findings to fix

Do NOT activate when the message merely mentions a previous review in passing
or asks a general question that happens to reference a PR.

### Gathering Feedback (MANDATORY when activated)

Search ALL of these sources:
1. **PR reviews** — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/reviews\`
2. **PR comments** (review-level and inline) — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/comments\`
3. **Issue comments** — \`gh api /repos/{owner}/{repo}/issues/{pr_number}/comments\`

All three are MANDATORY. Skipping any source means missing feedback.

### Tracking Comment (MANDATORY when activated)

Your FIRST action must be to post a tracking comment on the PR:

\`\`\`
gh api /repos/{owner}/{repo}/issues/{pr_number}/comments -f body="..."
\`\`\`

The comment must contain:
- What you plan to do (1-3 bullet points summarizing the task)
${taskUrl !== undefined ? `- A link to the live task console: [View progress](${taskUrl})` : ''}

Save the comment ID from the response — you will need it to update this comment later.

Your LAST action before outputting PULL_REQUEST_AGENT_FINAL must be to UPDATE this same comment with:
- What you actually did (1-3 bullet points)
- Outcome: commits pushed / no changes needed / etc.
${taskUrl !== undefined ? `- Link to the task console: [View task](${taskUrl})` : ''}

Use: \`gh api -X PATCH /repos/{owner}/{repo}/issues/comments/{comment_id} -f body="..."\`

### Completion Block Override

When PR Review Mode is active, use this completion block INSTEAD of your normal one:

\`\`\`
PULL_REQUEST_AGENT_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Comment replied: <yes|no>
- Tracking comment: <updated|not_applicable>
- Summary: <3-5 sentences on one line: objective narrative of what you investigated, implemented, and delivered>
\`\`\`

After this block, stop. Do not append any other checklist or schema payload.`;
  /* v8 ignore stop @preserve */
}
```

**Step 2: Modify `buildSystemPrompt()` to append overlay**

Replace the existing `buildSystemPrompt()` function body with:

```typescript
export function buildSystemPrompt(params: SystemPromptParams): string {
  const isPRComment = params.linearIssueLabels.some(
    (label) => label.trim().toLowerCase() === 'pr-comment'
  );
  if (isPRComment) {
    return buildPullRequestPrompt(params);
  }

  const resolvedAgentType =
    params.agentType ?? (hasCodeTaskLabel(params.linearIssueLabels) ? 'execution' : 'planning');

  const overlay = buildPRReviewOverlay(params);

  if (resolvedAgentType === 'planning') {
    return buildPlanningPrompt(params) + overlay;
  }

  return buildExecutionPrompt(params) + overlay;
}
```

Key change: two lines added — `const overlay = ...` and `+ overlay` on both return paths.

**Step 3: Run all system-prompt tests**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm --filter orchestrator test -- --run`
Expected: ALL PASS (including the 4 new tests from Tasks 1-4 and all 12 existing tests)

**Step 4: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat: add PR review overlay to execution and planning system prompts

Appends a conditional PR review section to execution and planning prompts.
The agent decides based on message context whether to activate PR review
behavior (tracking comment, feedback gathering, completion block override).
Closes the gap where PR reviews dispatched to execution tasks didn't get
PR-specific instructions."
```

---

### Task 6: Run full CI verification

**Files:** None (verification only)

**Step 1: Run workspace verification**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm run verify:workspace:tracked -- orchestrator`
Expected: TypeCheck + Lint + Tests + Coverage all pass

**Step 2: Run full CI**

Run: `cd /home/pbuchman/personal/intexuraos-6 && pnpm run ci:tracked`
Expected: ALL PASS

**Step 3: Commit any fixes if needed**

If CI reveals issues, fix and commit before proceeding.
