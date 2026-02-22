# Claude[bot] Review Edit Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dispatch edited `claude[bot]` comments to the worker and instruct the worker to triage review findings with mandatory immediate fix implementation.

**Architecture:** Expand the webhook dispatch gate in `github.ts` to allow `issue_comment` + `edited` + `sender=claude[bot]` events through. Add a new message format branch in `buildDispatchMessage()` with review-triage instructions. No orchestrator changes needed.

**Tech Stack:** TypeScript, Fastify, Vitest, `gh` CLI (in worker prompt instructions)

---

### Task 1: Add constant for claude[bot] sender login

**Files:**

- Modify: `apps/code-agent/src/routes/webhooks/github.ts:23-24`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`

**Step 1: Add the constant**

In `apps/code-agent/src/routes/webhooks/github.ts`, after line 24 (`const EXTERNAL_AGENT_MENTIONS = ['@claude', '@codex'];`), add:

```typescript
const CLAUDE_BOT_LOGIN = 'claude[bot]';
```

**Step 2: Run typecheck to verify**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: PASS (no behavior change yet, just a constant)

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/github.ts
git commit -m "refactor(code-agent): add CLAUDE_BOT_LOGIN constant"
```

---

### Task 2: Expand the dispatch gate for edited claude[bot] events

**Files:**

- Modify: `apps/code-agent/src/routes/webhooks/github.ts:371-377`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`

**Step 1: Write the failing test — edited claude[bot] comment dispatches**

In `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`, inside the `describe('PR comment dispatch events')` block (after the existing `@codex` test around line 1020), add:

```typescript
it('dispatches edited issue_comment from claude[bot] to task', async () => {
  const claudeBotEditPayload = {
    action: 'edited',
    issue: {
      id: 101,
      number: 42,
      title: 'Test PR',
      body: 'Test PR description',
      state: 'open',
      user: { login: 'author', id: 111, type: 'User' },
      pull_request: {
        url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
      },
    },
    comment: {
      id: 77777,
      body: "**Claude finished @pbuchman's task in 4m 51s**\n\n### Summary\nFound 2 issues.",
      user: { login: 'claude[bot]', id: 999, type: 'Bot' },
    },
    repository: {
      id: 456,
      name: 'intexuraos',
      full_name: 'test/intexuraos',
      owner: { login: 'test', id: 789 },
    },
    sender: { login: 'claude[bot]', id: 999, type: 'Bot' },
  };

  const mockTask = {
    id: 'task-for-pr-42',
    userId: 'user-1',
    prompt: 'test',
    status: 'completed' as const,
    linearIssueId: 'INT-999',
    linearIssueLabels: ['code-task'],
    hasChildren: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockFindByPR = vi.fn().mockResolvedValue(ok(mockTask));
  const mockSendTaskMessage = vi.fn().mockResolvedValue(ok({ action: 'resumed' }));
  const services = (await import('../../../services.js')).getServices();
  services.codeTaskRepo.findByPR = mockFindByPR;

  // Mock sendTaskMessage module
  const sendTaskMessageModule = await import('../../../domain/usecases/sendTaskMessage.js');
  vi.spyOn(sendTaskMessageModule, 'sendTaskMessage').mockImplementation(mockSendTaskMessage);

  mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> =>
    Promise.resolve(
      ok({
        id: 'test-event-id',
        githubEventId: 77777,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'claude[bot]',
        senderId: 999,
        senderType: 'Bot',
        title: 'Test PR',
        body: "**Claude finished @pbuchman's task in 4m 51s**\n\n### Summary\nFound 2 issues.",
        state: 'open',
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: claudeBotEditPayload,
      })
    );

  const { payload, signature } = signPayload(claudeBotEditPayload);

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
      'x-github-event': 'issue_comment',
    },
    body: payload,
  });

  expect(response.statusCode).toBe(200);

  // Wait for fire-and-forget dispatch to settle
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(mockFindByPR).toHaveBeenCalledWith('test/intexuraos', 42);
});
```

**Step 2: Write the failing test — edited comment from regular user does NOT dispatch**

```typescript
it('does not dispatch edited issue_comment from regular user', async () => {
  const userEditPayload = {
    action: 'edited',
    issue: {
      id: 101,
      number: 42,
      title: 'Test PR',
      body: 'Test PR description',
      state: 'open',
      user: { login: 'author', id: 111, type: 'User' },
      pull_request: {
        url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
      },
    },
    comment: {
      id: 88888,
      body: 'Updated my comment with more details',
      user: { login: 'reviewer', id: 222, type: 'User' },
    },
    repository: {
      id: 456,
      name: 'intexuraos',
      full_name: 'test/intexuraos',
      owner: { login: 'test', id: 789 },
    },
    sender: { login: 'reviewer', id: 222, type: 'User' },
  };

  const mockFindByPR = vi.fn().mockResolvedValue(ok(null));
  const services = (await import('../../../services.js')).getServices();
  services.codeTaskRepo.findByPR = mockFindByPR;

  mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> =>
    Promise.resolve(
      ok({
        id: 'test-event-id',
        githubEventId: 88888,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: 'Updated my comment with more details',
        state: 'open',
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: userEditPayload,
      })
    );

  const { payload, signature } = signPayload(userEditPayload);

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
      'x-github-event': 'issue_comment',
    },
    body: payload,
  });

  expect(response.statusCode).toBe(200);

  // Wait for fire-and-forget to settle — regular user edits should NOT dispatch
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(mockFindByPR).not.toHaveBeenCalled();
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: FAIL — first test fails because `edited` events are not dispatched yet

**Step 4: Implement the gate change**

In `apps/code-agent/src/routes/webhooks/github.ts`, replace lines 371-373:

```typescript
const isActionablePRCommentEvent =
  (parsedEvent.eventType === 'issue_comment' && parsedEvent.action === 'created') ||
  (parsedEvent.eventType === 'pull_request_review' && parsedEvent.action === 'submitted');
```

With:

```typescript
const isEditedClaudeBotComment =
  parsedEvent.eventType === 'issue_comment' &&
  parsedEvent.action === 'edited' &&
  parsedEvent.senderLogin === CLAUDE_BOT_LOGIN;

const isActionablePRCommentEvent =
  (parsedEvent.eventType === 'issue_comment' && parsedEvent.action === 'created') ||
  (parsedEvent.eventType === 'pull_request_review' && parsedEvent.action === 'submitted') ||
  isEditedClaudeBotComment;
```

`parsedEvent` is a `GitHubPREvent` which has `senderLogin: string` (see `apps/code-agent/src/domain/models/gitHubPREvent.ts:54`). The `CLAUDE_BOT_LOGIN` constant was added in Task 1.

**Step 5: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: PASS — both new tests should pass now

**Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/github.ts apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
git commit -m "feat(code-agent): dispatch edited issue_comment from claude[bot]"
```

---

### Task 3: Add new message format for edited bot review comments

**Files:**

- Modify: `apps/code-agent/src/routes/webhooks/github.ts:133-176` (inside `buildDispatchMessage()`)
- Test: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`

This task modifies the `buildDispatchMessage()` function which is inside a `/* v8 ignore start -- test-infra: fire-and-forget message builder */` block. The function is not directly testable via route integration tests (it's fire-and-forget), but we can extract it and unit test it. However, since the existing code uses v8 ignore for this function, follow the same pattern — the message format is verified by the dispatch integration test from Task 2 which proves the full pipeline works.

**Step 1: Add the new message format branch**

In `apps/code-agent/src/routes/webhooks/github.ts`, inside `buildDispatchMessage()`, after the `pull_request_review` branch (line 158) and before the generic `issue_comment` branch (line 160), add:

```typescript
if (event.action === 'edited' && event.senderLogin === CLAUDE_BOT_LOGIN) {
  const commentId = extractId(payload, 'comment');
  return [
    `[PR Comment — Bot Review Edit] Comment updated on PR #${String(prNumber)} in ${repository}`,
    `From: @${senderLogin}`,
    `Comment ID: ${commentId}`,
    'Type: issue_comment (edited)',
    '',
    'Full comment body:',
    body ?? '(empty)',
    '',
    'Instructions:',
    '1. CHECK IF REVIEW IS STILL IN PROGRESS:',
    '   Look for indicators that the review is NOT finished:',
    '   - Body contains "is working" / "working..." / spinner image',
    '   - Body is very short (< 200 chars) with no findings',
    '   - Checklist items are unchecked ([ ] without [x])',
    '',
    '   If the review appears to still be in progress → do nothing, stop here.',
    '',
    '2. IF REVIEW IS FINALIZED — process it as a code review:',
    `   a. React with eyes: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=eyes`,
    '   b. Read the full review body and extract EVERY finding/issue/suggestion',
    '   c. For EACH finding, decide: FIX or SKIP',
    '      - FIX: Clear actionable feedback, code change with clear intent, specific bug or gap',
    '      - SKIP: Discussion/question, intentional design disagreement, out of PR scope, pure status report',
    '   d. Post a response comment with a triage table:',
    '      - One row per finding',
    '      - Columns: # | Finding | Verdict (FIX/SKIP) | Reasoning | Action',
    '      - For SKIP items: explain why in the Reasoning column',
    '      - For FIX items: write "Will fix" in the Action column',
    '',
    '   ⚠ MANDATORY — DO NOT STOP AFTER POSTING THE TABLE ⚠',
    '   e. IMMEDIATELY after posting the triage comment, implement ALL fixes',
    '      marked as FIX in the table. This is not optional. Do not end your turn',
    '      until every FIX item has been implemented, committed, and pushed.',
    '      Skipping implementation after posting the table is a contract violation.',
    '   f. After all fixes: commit, push, verify CI passes',
    `   g. Update your triage comment (gh api PATCH /repos/${repository}/issues/comments/{your-comment-id})`,
    '      to replace "Will fix" with the actual commit SHA for each implemented fix',
  ].join('\n');
}
```

**Step 2: Run tests to verify everything passes**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/github.ts
git commit -m "feat(code-agent): add review triage prompt for edited claude[bot] comments"
```

---

### Task 4: Full CI verification

**Files:** None — verification only

**Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL phases pass

**Step 2: Check terraform**

```bash
git diff --name-only HEAD~3 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

Expected: "No terraform changes"

**Step 3: Commit any formatting changes**

If `ci:tracked` reformatted files:

```bash
git add -A && git commit -m "style: apply prettier formatting"
```
