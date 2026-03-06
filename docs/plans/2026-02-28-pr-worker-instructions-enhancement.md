# PR Worker Instructions Enhancement

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance PR worker instructions to require code review skill usage, provide detailed clarifications, and gather all three types of GitHub PR comments.

**Architecture:** Update the `buildTaskPrompt` function in `createTaskForPR.ts` to include enhanced instructions. The function generates user prompts for PR comment tasks dispatched to workers.

**Tech Stack:** TypeScript, Vitest

---

## Background

The current `buildTaskPrompt` function in `apps/code-agent/src/domain/usecases/createTaskForPR.ts` produces instructions that:
1. Only gather PR comments via `gh pr view --json comments` (missing reviews and issue comments)
2. Lack guidance on code review skill usage
3. Lack guidance on providing detailed reasoning for clarification requests

The system prompt in `workers/orchestrator/src/services/system-prompt.ts` already documents the 3 comment types, but the user prompt (instructions) passed to workers doesn't match.

---

## Task 1: Update buildTaskPrompt Instructions

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts:67-96`

**Step 1: Read the current function**

```bash
cat -n apps/code-agent/src/domain/usecases/createTaskForPR.ts | sed -n '67,96p'
```

**Step 2: Update the buildTaskPrompt function**

Replace lines 70-95 with:

```typescript
function buildTaskPrompt(request: CreateTaskForPRRequest): string {
  const { repository, prNumber, senderLogin, comment, prTitle } = request;

  const lines = [
    `[PR Comment Task] Comment on PR #${String(prNumber)} in ${repository}`,
    `From: @${senderLogin}`,
  ];
  if (prTitle !== undefined) {
    lines.push(`PR title: ${prTitle}`);
  }
  lines.push(
    '',
    'This task was created automatically because a comment was posted on a PR',
    'that had no existing code task. Investigate the PR context and address the comment.',
    '',
    'The commenter said:',
    comment,
    '',
    '### Behavioral Requirements (MANDATORY)',
    '',
    '**Code Review Requests:**',
    'If the user asks for a code review, you MUST use the `/requesting-code-review` skill.',
    'This is mandatory and non-negotiable.',
    '',
    '**Clarification Requests:**',
    'If the user asks for clarification on your approach or decisions, you MUST provide',
    'DETAILED reasoning. Do NOT blindly agree with feedback. Explain your technical rationale,',
    'cite evidence from the codebase, and defend your approach when appropriate.',
    '',
    '### Instructions',
    '',
    `1. Check PR state: gh pr view ${String(prNumber)} --json state,merged,base,title,body`,
    `2. Read the full PR diff: gh pr diff ${String(prNumber)}`,
    '3. Gather ALL PR feedback (all three sources are MANDATORY):',
    `   - PR reviews: gh api /repos/${repository}/pulls/${String(prNumber)}/reviews`,
    `   - PR comments (inline): gh api /repos/${repository}/pulls/${String(prNumber)}/comments`,
    `   - Issue comments: gh api /repos/${repository}/issues/${String(prNumber)}/comments`,
    '4. Understand the full context of the PR and the comment',
    '5. If actionable: investigate the codebase, implement the requested changes',
    '6. Run pnpm run ci:tracked — must pass before pushing',
    '7. Commit and push your changes to the existing PR branch',
    `8. Reply to the comment: gh api /repos/${repository}/issues/${String(prNumber)}/comments -f body="..."`,
  );
  return lines.join('\n');
}
```

**Step 3: Verify the file compiles**

```bash
pnpm --filter code-agent run typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/createTaskForPR.ts
git commit -m "feat(code-agent): enhance PR worker instructions

- Add mandatory /requesting-code-review skill for code review requests
- Add requirement for detailed reasoning on clarification requests
- Gather all 3 comment types: PR reviews, PR comments, issue comments"
```

---

## Task 2: Update Test Assertions

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts:305-339`

**Step 1: Read the current test**

```bash
cat -n apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts | sed -n '305,340p'
```

**Step 2: Update test assertions**

Update the test `builds prompt with resume preamble including PR number and instructions` to verify:

```typescript
describe('prompt building', () => {
  it('builds prompt with resume preamble including PR number and instructions', async () => {
    mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
      ok({ userId, worker: mockWorker })
    );

    mockTransaction.get.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });

    mockLinearIssueService.ensureIssueExists.mockResolvedValue({
      linearIssueId: 'INT-100',
      linearIssueTitle: 'Test Issue',
      linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
      linearFallback: false,
    });

    let capturedPrompt: string | undefined;
    mockCodeTaskRepo.create.mockImplementation(async (input) => {
      capturedPrompt = input.prompt;
      return ok({ ...mockExistingTask, id: input.id });
    });

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-dev' })
    );

    await createTaskForPR(createDeps(), createRequest());

    expect(capturedPrompt).toContain('[PR Comment Task]');
    expect(capturedPrompt).toContain(`PR #${String(prNumber)}`);
    expect(capturedPrompt).toContain('gh pr view');
    expect(capturedPrompt).toContain(comment);
    // New assertions for enhanced instructions
    expect(capturedPrompt).toContain('/requesting-code-review');
    expect(capturedPrompt).toContain('DETAILED reasoning');
    expect(capturedPrompt).toContain('gh api /repos/');
    expect(capturedPrompt).toContain('/pulls/');
    expect(capturedPrompt).toContain('/reviews');
    expect(capturedPrompt).toContain('/comments');
    expect(capturedPrompt).toContain('/issues/');
  });
});
```

**Step 3: Run the tests**

```bash
pnpm --filter code-agent run test -- --run
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts
git commit -m "test(code-agent): verify enhanced PR worker instructions"
```

---

## Task 3: Run CI Verification

**Step 1: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: All checks pass

**Step 2: Create PR**

```bash
git push -u origin feature/int-673
gh pr create --base development --title "[INT-673] Enhance PR worker instructions" --body "$(cat <<'EOF'
## Summary
- Add mandatory `/requesting-code-review` skill usage for code review requests
- Add requirement for detailed reasoning on clarification requests
- Gather all 3 PR comment types: reviews, PR comments, and issue comments

## Test plan
- [x] Unit tests verify new instruction content
- [x] CI passes

Fixes INT-673

Devised with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Summary

| Task   | Description                     | Estimated Time   |
| ------ | ------------------------------- | ---------------- |
| 1      | Update buildTaskPrompt function | 3 min            |
| 2      | Update test assertions          | 2 min            |
| 3      | Run CI and create PR            | 5 min            |

**Total estimated time:** 10 minutes

This is a trivial task with focused changes to one function and its corresponding test. No architectural changes required.
