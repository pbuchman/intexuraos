# Resume Goal Preservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When resuming a completed task with a user message, inject the user's goal into the system prompt so it survives context compaction.

**Architecture:** Add a `buildActiveGoalSection()` private method to `TaskDispatcher` that strips the RESUME PRE-FLIGHT preamble and wraps the raw user message in an `[ACTIVE GOAL]` block. Append this to the system prompt only when `continueSession: true`.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add `buildActiveGoalSection` method and wire it into `startWorkerAttempt`

**Files:**

- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:885-905` (near `buildResumePreamble`)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1063-1076` (in `startWorkerAttempt`)

**Step 1: Write failing test**

Add to `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`, after the `buildResumePreamble` describe block (line ~2957):

```typescript
describe('buildActiveGoalSection', () => {
  it('strips resume preamble and wraps user message', () => {
    const internal = dispatcher as unknown as {
      buildActiveGoalSection: (prompt: string) => string;
      buildResumePreamble: () => string;
    };
    const preamble = internal.buildResumePreamble();
    const userMessage =
      '[PR Comment] New comment on PR #849\nFrom: @pbuchman\nThe commenter said:\nFix the bug';
    const combined = preamble + userMessage;

    const result = internal.buildActiveGoalSection(combined);

    expect(result).toContain('[ACTIVE GOAL');
    expect(result).toContain('[PR Comment] New comment on PR #849');
    expect(result).toContain('Fix the bug');
    expect(result).not.toContain('[RESUME PRE-FLIGHT');
  });

  it('handles prompt without preamble', () => {
    const internal = dispatcher as unknown as {
      buildActiveGoalSection: (prompt: string) => string;
    };
    const result = internal.buildActiveGoalSection('Just a plain message');

    expect(result).toContain('[ACTIVE GOAL');
    expect(result).toContain('Just a plain message');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/pbuchman/personal/intexuraos-2 && pnpm --filter orchestrator test -- --run -t "buildActiveGoalSection"`
Expected: FAIL — `buildActiveGoalSection` is not a function

**Step 3: Implement `buildActiveGoalSection`**

Add as a private method in `TaskDispatcher`, after `buildResumePreamble()` (after line 905):

```typescript
private buildActiveGoalSection(prompt: string): string {
  const preamble = this.buildResumePreamble();
  const goalText = prompt.startsWith(preamble)
    ? prompt.slice(preamble.length)
    : prompt;
  return [
    '',
    '',
    '[ACTIVE GOAL — HIGHEST PRIORITY]',
    'A new user message has been received. This is your PRIMARY task.',
    'Complete this goal before doing anything else. If context was compacted,',
    'this section survives and takes absolute priority over conversation history.',
    '',
    goalText,
  ].join('\n');
}
```

**Step 4: Wire into `startWorkerAttempt`**

In `startWorkerAttempt()` (line ~1068), change the `systemPrompt` construction:

```typescript
// Before:
systemPrompt: buildSystemPrompt({
  taskId: task.taskId,
  ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
  ...(task.linearIssueTitle !== undefined && { linearIssueTitle: task.linearIssueTitle }),
  taskUrl: `https://intexuraos.cloud/#/code-tasks/${task.taskId}`,
  linearIssueLabels: task.linearIssueLabels,
  hasChildren: params.hasChildren,
}) + (params.continueSession ? this.buildActiveGoalSection(params.prompt) : ''),

// The v8 ignore comment stays around the spread, not the concatenation.
```

**Step 5: Run test to verify it passes**

Run: `cd /home/pbuchman/personal/intexuraos-2 && pnpm --filter orchestrator test -- --run -t "buildActiveGoalSection"`
Expected: PASS

**Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): inject active goal into system prompt on resume"
```

---

### Task 2: Add integration test for resume systemPrompt content

**Files:**

- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write test that verifies systemPrompt contains ACTIVE GOAL on resume**

Find the existing `resumedAfterSuccess` describe block (~line 2959). Add a test that submits a task, completes it, then sends a message, and asserts the `createWorker` call's `systemPrompt` contains `[ACTIVE GOAL`:

```typescript
it('includes active goal in system prompt when resuming completed task', async () => {
  // ... (use the same setup pattern as existing resumedAfterSuccess tests)
  // After task completes, call sendMessage
  // Then check:
  const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
  expect(createWorkerCall?.[0]?.systemPrompt).toContain('[ACTIVE GOAL');
  expect(createWorkerCall?.[0]?.systemPrompt).toContain('User follow-up message');
});
```

**Step 2: Add test that initial submission does NOT include ACTIVE GOAL**

```typescript
it('does not include active goal in system prompt for initial submission', async () => {
  const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls[0];
  expect(createWorkerCall?.[0]?.systemPrompt).not.toContain('[ACTIVE GOAL');
});
```

**Step 3: Run tests**

Run: `cd /home/pbuchman/personal/intexuraos-2 && pnpm --filter orchestrator test -- --run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "test(orchestrator): verify active goal injection on resume"
```

---

### Task 3: Run full CI

**Step 1: Run workspace verification**

Run: `cd /home/pbuchman/personal/intexuraos-2 && pnpm run verify:workspace:tracked orchestrator`
Expected: TypeCheck + Lint + Tests + Coverage all pass

**Step 2: Run full CI**

Run: `cd /home/pbuchman/personal/intexuraos-2 && pnpm run ci:tracked`
Expected: ALL PASS

**Step 3: Verify no terraform changes**

Run: `git diff --name-only HEAD~2 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"`
Expected: No terraform changes
