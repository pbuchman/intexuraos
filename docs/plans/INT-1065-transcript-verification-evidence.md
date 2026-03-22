# Transcript Verification Evidence in Automation Log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Gemini transcript verification results in the PR automation comment so users can see evidence that verification passed (or failed) after task completion.

**Architecture:** The orchestrator already runs Gemini verification and extracts a summary, but the `task_completed` lifecycle event sent to code-agent omits verification data. We add a `verificationSummary` field to the task lifecycle event payload, extend the `task_completed` AutomationEvent type in code-agent to accept it, and render it as an expandable details section under the "Completed" line in the automation comment.

**Tech Stack:** TypeScript, Fastify, Vitest

---

## Root Cause

The orchestrator's `finalizeTask` method (task-dispatcher.ts:1862-1899) builds a `taskEventPayload` for the `task_completed` event but only includes `taskId`, `event`, `duration`, `prUrl`, `commits`, `error`, and `status`. The Gemini verification summary (`payload.result?.summary`) is available but not forwarded. Code-agent has no field or rendering for it.

## Shared Contract

The orchestrator sends a webhook to code-agent at `POST /internal/webhooks/task-event`. The new field added to the payload:

```typescript
// Added to task_completed event payload (optional, backward-compatible)
verificationSummary?: string; // Gemini-extracted agent summary (3-5 sentences)
```

Both services must agree on this field name. The field is optional — code-agent renders it when present, ignores when absent.

## Endpoint Changes

- **Modified:** `POST /internal/webhooks/task-event` (code-agent) — accepts new optional `verificationSummary` field in request body
- **Modified:** Orchestrator task lifecycle webhook sender — includes `verificationSummary` in `task_completed` payload
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /webhooks/task-completion` (code-agent main webhook), all other endpoints

---

## Task 1: Orchestrator — Include verification summary in task lifecycle event

**Owner:** orchestrator worker agent
**Service:** `workers/orchestrator`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1868-1884` (taskEventPayload construction)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Contract IN:** `finalizeTask` receives `payload.result?.summary` (already populated by `buildResultFromVerification`)
**Contract OUT:** Task lifecycle event payload now includes `verificationSummary: string` when `payload.result?.summary` is defined

- [ ] **Step 1: Write failing test**

Add a test that verifies the task lifecycle webhook payload includes `verificationSummary` when the result has a summary. Find the existing test for `task_completed` lifecycle event in `task-dispatcher.test.ts` and add a case:

```typescript
it('includes verificationSummary in task lifecycle event when result has summary', async () => {
  // ... setup task with result containing summary ...
  // Assert webhookClient.send was called with payload containing verificationSummary
  expect(sentPayload).toHaveProperty('verificationSummary', 'Test summary from Gemini');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "verificationSummary"`
Expected: FAIL — payload does not contain `verificationSummary`

- [ ] **Step 3: Add verificationSummary to task lifecycle event payload**

In `task-dispatcher.ts`, inside the `taskEventPayload` construction (around line 1868-1884), add:

```typescript
...(payload.result?.summary !== undefined && {
  verificationSummary: payload.result.summary,
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "verificationSummary"`
Expected: PASS

- [ ] **Step 5: Verify full orchestrator test suite**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`
Expected: All tests pass, 100% branch coverage

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): include verificationSummary in task lifecycle event"
```

---

## Task 2: Code-Agent — Accept and render verification summary in automation comment

**Owner:** code-agent app agent
**Service:** `apps/code-agent`

**Files:**
- Modify: `apps/code-agent/src/domain/ports/automationLog.ts:83-90` (task_completed event type)
- Modify: `apps/code-agent/src/routes/webhooks/taskEvent.ts:30-41,58-72` (webhook body type + mapping)
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts:164-193` (renderTaskCompleted)
- Test: `apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/taskEvent.test.ts`

**Contract IN:** Receives `verificationSummary?: string` in task-event webhook body (from orchestrator)
**Contract OUT:** Renders verification summary as expandable `<details>` block below the "Completed" line in the PR automation comment

### Step-by-step

- [ ] **Step 1: Write failing test for automationCommentRenderer — verification summary rendering**

In `automationCommentRenderer.test.ts`, add a test:

```typescript
it('renders verification summary in details block when present', () => {
  useFakeTime();
  const event: AutomationEvent = {
    type: 'task_completed',
    taskId: 'task-abc',
    status: 'implemented',
    duration: 261_000,
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/1424',
    verificationSummary: 'Agent implemented categorized writing config with 7 endpoints and full test coverage.',
  };

  const result = renderEvent(event);
  expect(result).toContain('**Completed**');
  expect(result).toContain('Verification');
  expect(result).toContain('Agent implemented categorized writing config');
});

it('does not render verification details when verificationSummary is absent', () => {
  useFakeTime();
  const event: AutomationEvent = {
    type: 'task_completed',
    taskId: 'task-abc',
    status: 'implemented',
    duration: 261_000,
  };

  const result = renderEvent(event);
  expect(result).not.toContain('Verification');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts -t "verification"`
Expected: FAIL — TypeScript error, `verificationSummary` not in type

- [ ] **Step 3: Add verificationSummary to AutomationEvent task_completed type**

In `automationLog.ts`, update the `task_completed` variant (lines 83-90):

```typescript
| {
    type: 'task_completed';
    taskId: string;
    status: 'implemented' | 'reviewed' | 'planned' | 'unknown';
    duration: number;
    prUrl?: string;
    commits?: { sha: string; message: string }[];
    verificationSummary?: string; // Gemini-extracted agent summary
  }
```

- [ ] **Step 4: Implement renderTaskCompleted with verification summary**

**IMPORTANT:** The existing `renderTaskCompleted` has an early-return `if (!hasCommits) { return summary; }` that would silently drop `verificationSummary` when there are no commits. You MUST replace this early-return pattern with a `detailSections` array approach that only returns early when BOTH commits and verificationSummary are absent.

In `automationCommentRenderer.ts`, **replace the entire** `renderTaskCompleted` function with:

```typescript
function renderTaskCompleted(
  ts: string,
  event: Extract<AutomationEvent, { type: 'task_completed' }>,
  options?: RenderEventOptions
): string {
  const parts: string[] = [`**${ts}** -- **Completed**`, formatDuration(event.duration)];

  if (event.prUrl !== undefined) {
    const prNumber = extractPrNumber(event.prUrl);
    parts.push(`[PR #${prNumber}](${event.prUrl})`);
  }

  const summary = parts.join(' | ');
  const detailSections: string[] = [];

  const commits = event.commits;
  const hasCommits = commits !== undefined && commits.length > 0;
  if (hasCommits) {
    const commitLines = commits.map((c) => {
      const shortSha = c.sha.slice(0, 7);
      if (options?.repository !== undefined) {
        return `- [\`${shortSha}\`](https://github.com/${options.repository}/commit/${c.sha}) ${c.message}`;
      }
      return `- \`${shortSha}\` ${c.message}`;
    });
    detailSections.push(wrapDetails('Commits', commitLines.join('\n')));
  }

  if (event.verificationSummary !== undefined) {
    detailSections.push(wrapDetails('Verification', event.verificationSummary));
  }

  if (detailSections.length === 0) {
    return summary;
  }
  return summary + '\n' + detailSections.join('\n');
}
```

- [ ] **Step 5: Run renderer tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts`
Expected: PASS — all existing + new tests

- [ ] **Step 6: Write failing test for taskEvent webhook — verificationSummary mapping**

In `taskEvent.test.ts`, add a test that sends a `task_completed` event with `verificationSummary` and verifies the automation log receives it:

```typescript
it('maps verificationSummary from task_completed event', async () => {
  // ... setup with body including verificationSummary ...
  // Assert automationLog.record was called with event containing verificationSummary
  expect(recordedEvent).toHaveProperty('verificationSummary', 'Test summary');
});
```

- [ ] **Step 7: Update TaskEventWebhookBody and mapToAutomationEvent**

In `taskEvent.ts`:

1. Add `verificationSummary?: string` to `TaskEventWebhookBody` interface (line ~39)
2. Add the JSON schema property inside the `properties` object of the route schema:
   ```typescript
   verificationSummary: { type: 'string' },
   ```
3. In `mapToAutomationEvent`, for the `task_completed` case (around line 58-72), add `verificationSummary` directly to the event object literal. Since the `AutomationEvent` type already has `verificationSummary` (added in Step 3), no type cast is needed:
   ```typescript
   case 'task_completed': {
     const status = (body.status ?? 'unknown') as Extract<AutomationEvent, { type: 'task_completed' }>['status'];
     const event: AutomationEvent = {
       type: 'task_completed',
       taskId: body.taskId,
       status,
       duration: body.duration ?? 0,
     };
     if (body.prUrl !== undefined) {
       (event as { prUrl?: string }).prUrl = body.prUrl;
     }
     if (body.commits !== undefined) {
       (event as { commits?: { sha: string; message: string }[] }).commits = body.commits;
     }
     if (body.verificationSummary !== undefined) {
       (event as { verificationSummary?: string }).verificationSummary = body.verificationSummary;
     }
     return event;
   }
   ```
   Note: The cast pattern matches the existing code style for `prUrl` and `commits` — keep it consistent even though the type already supports the field.

- [ ] **Step 8: Run webhook route tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks/taskEvent.test.ts`
Expected: PASS

- [ ] **Step 9: Verify full code-agent test suite**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, 100% branch coverage

- [ ] **Step 10: Commit**

```bash
git add apps/code-agent/src/domain/ports/automationLog.ts apps/code-agent/src/routes/webhooks/taskEvent.ts apps/code-agent/src/domain/services/automationCommentRenderer.ts apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts apps/code-agent/src/__tests__/routes/webhooks/taskEvent.test.ts
git commit -m "feat(code-agent): render verification summary in automation comment"
```

---

## Final Verification

- [ ] Run `pnpm run ci:tracked` from repo root — all workspaces must pass
- [ ] Create PR targeting `development`
