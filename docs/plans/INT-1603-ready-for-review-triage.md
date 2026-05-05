# Ready For Review Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft pull requests that transition to `ready_for_review` must start the same review triage flow as newly opened PRs, without recording a fallback skip or misleading "Error" details in the PR automation log.

**Architecture:** Keep the existing draft PR gate intact: draft PRs are skipped while `isDraft === true`, and `ready_for_review` is the explicit transition that re-enters triage. The current webhook rules already classify `pull_request.ready_for_review` as `needs_triage`; the fix is to align the downstream GitHub Agent action validation and legacy helper with that rule, then tighten the automation log copy for triage failure details.

**Tech Stack:** TypeScript, Fastify webhook handling, Firestore-backed GitHub event audit records, Vitest, `apps/code-agent`.

---

## Investigation Findings

- The reported production event was saved in Firestore as `github-pr-events/9f273789-081b-4bba-8404-61b63b0a68c8`: `eventType=pull_request`, `action=ready_for_review`, `repository=pbuchman/intexuraos`, `pullRequestNumber=2048`, `isDraft=false`, `baseBranch=development`, `processedAt=2026-05-05T20:59:44.160Z`.
- The corresponding event log row `github-event-log-entries/HFztHckai8LbTTbvP3BF` completed with `decisionOutcome=skip` at `2026-05-05T20:59:43.954Z`.
- The decision `event_decisions/ed_HFztHckai8LbTTbvP3BF` recorded `decidedBy=hard_rules`, `decision=skip`, and `reason=fallback_skip: Expected opened/synchronize action, got ready_for_review`.
- Static code confirms why: `apps/code-agent/src/domain/services/gitHubWebhookRules.ts` already returns `needs_triage` for `pull_request.ready_for_review`, but `apps/code-agent/src/domain/usecases/githubAgent.ts` rejects every PR action except `opened` and `synchronize`.
- `gcloud` is not installed in this worker container, so Cloud Run logs could not be read here. Firestore was queried directly with the mounted service account at `/secrets/gcp-sa.json`.

## Endpoint Changes

**Modified**
- `POST /webhooks/github`: no schema or URL change; behavior changes for `pull_request.ready_for_review` so it proceeds to review triage instead of fallback skip.
- `POST /internal/code/pubsub/pr-triage`: no schema or URL change; behavior changes only through the evaluator dependency it invokes.

**Created**
- None.

**Removed**
- None.

**Unchanged**
- All request headers, response shapes, Pub/Sub payload shape, Firestore collection names, and GitHub webhook event normalization remain unchanged.

## Files

- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts` - allow `ready_for_review` wherever PR triage actions are validated.
- Modify: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts` - cover `ready_for_review` in `evaluateEvent` and `isGitHubAgentEvent`.
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts` - rename triage failure details from "Error" to neutral diagnostic copy.
- Modify: `apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts` - assert the new details label.
- Optional modify: `apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts` - add an integration guard proving `ready_for_review` records `triage_dispatch`, not `triage_failed`.

## Task 1: Accept Ready-For-Review In GitHub Agent Validation

**Files:**
- Modify: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts`

- [ ] **Step 1: Write the failing unit tests**

Add this test in `describe('evaluateEvent') > describe('pull_request events')`, near the existing opened/synchronize tests:

```typescript
it('evaluates ready_for_review PR events', async () => {
  const deps = createDeps();
  const event = createFakePREvent({ action: 'ready_for_review', isDraft: false });

  const result = await evaluateEvent(deps, event);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.triage.action).toBe('request_review');
    if (result.value.triage.action === 'request_review') {
      expect(result.value.triage.reviewTypes).toContain('code_quality');
    }
  }
});
```

Update the non-triage action test name and assertion so `closed` remains rejected:

```typescript
it('rejects non-triage pull_request actions', async () => {
  const deps = createDeps();
  const event = createFakePREvent({ action: 'closed' });

  const result = await evaluateEvent(deps, event);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('INVALID_EVENT');
    expect(result.error.message).toContain('Expected opened/synchronize/ready_for_review action');
  }
});
```

Add this case in `describe('isGitHubAgentEvent')`:

```typescript
it('returns true for ready_for_review pull_request events', () => {
  const event = createFakePREvent({ action: 'ready_for_review' });

  expect(isGitHubAgentEvent(event)).toBe(true);
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/usecases/githubAgent.test.ts
```

Expected: the new `ready_for_review` tests fail because `evaluateEvent` still returns `INVALID_EVENT` and `isGitHubAgentEvent` still returns `false`.

- [ ] **Step 3: Implement the minimal allowlist change**

In `apps/code-agent/src/domain/usecases/githubAgent.ts`, introduce a shared predicate near the exports:

```typescript
type GitHubAgentPullRequestAction = 'opened' | 'synchronize' | 'ready_for_review';

function isGitHubAgentPullRequestAction(
  action: GitHubPREvent['action'],
): action is GitHubAgentPullRequestAction {
  return action === 'opened' || action === 'synchronize' || action === 'ready_for_review';
}
```

Replace the current PR action validation with:

```typescript
if (event.eventType === 'pull_request' && !isGitHubAgentPullRequestAction(event.action)) {
  return {
    ok: false,
    error: {
      code: 'INVALID_EVENT',
      message: `Expected opened/synchronize/ready_for_review action, got ${event.action ?? 'null'}`,
    },
  };
}
```

Update `isGitHubAgentEvent` to reuse the same predicate:

```typescript
export function isGitHubAgentEvent(event: GitHubPREvent): boolean {
  return event.eventType === 'pull_request' && isGitHubAgentPullRequestAction(event.action);
}
```

- [ ] **Step 4: Run the focused tests again**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/usecases/githubAgent.test.ts
```

Expected: all tests in `githubAgent.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts
git commit -m "fix(code-agent): allow ready-for-review PR triage (INT-1603)"
```

## Task 2: Make Triage Failure Details Copy Neutral

**Files:**
- Modify: `apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts`
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts`

- [ ] **Step 1: Write the failing renderer test**

Update the existing `triage_failed` renderer test from "renders fallback action and error in details" to:

```typescript
it('renders fallback action and diagnostic details', () => {
  useFakeTime();
  const event: AutomationEvent = {
    type: 'triage_failed',
    error: 'LLM timeout after 30s',
    fallbackAction: 'dispatch',
  };

  const result = renderEvent(event);
  expect(result).toContain('**14:35 UTC** -- **Triage failed** | dispatch');
  expect(result).toContain('<details>');
  expect(result).toContain('<summary>Details</summary>');
  expect(result).toContain('LLM timeout after 30s');
});
```

- [ ] **Step 2: Run the focused failing renderer test**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/domain/services/__tests__/automationCommentRenderer.test.ts
```

Expected: the test fails because `renderTriageFailed` currently wraps details under `Error`.

- [ ] **Step 3: Update the renderer**

In `apps/code-agent/src/domain/services/automationCommentRenderer.ts`, change:

```typescript
return summary + '\n' + wrapDetails('Error', details);
```

to:

```typescript
return summary + '\n' + wrapDetails('Details', details);
```

Do not change the `AutomationEvent` field name in this task; it is a typed internal payload used at several call sites, and the user-facing issue is the rendered label.

- [ ] **Step 4: Run the focused renderer test again**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/domain/services/__tests__/automationCommentRenderer.test.ts
```

Expected: all renderer tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/services/automationCommentRenderer.ts apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts
git commit -m "fix(code-agent): clarify triage failure log details (INT-1603)"
```

## Task 3: Add A Webhook Flow Guard For Ready-For-Review

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts`

- [ ] **Step 1: Write the integration guard**

Add a flow after the LLM dispatch/review flow tests:

```typescript
describe('ready_for_review pull_request event', () => {
  it('records triage_dispatch and creates a review task without triage_failed', async () => {
    mockEvaluateEvent.mockResolvedValueOnce(ok({
      triage: { action: 'request_review', reviewTypes: ['code_quality'] },
      usage: { costUsd: 0.001, toolCalls: [{ tool: 'request_review', args: { review_type: 'code_quality' } }] },
      reasoning: 'Draft PR is ready for review',
    }));

    const { statusCode } = await sendWebhook(
      'pull_request',
      createPullRequestPayload({ action: 'ready_for_review' }),
    );
    expect(statusCode).toBe(200);

    await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_dispatch'));

    const events = getRecordedEvents();
    expect(events.find((e) => e.event.type === 'triage_failed')).toBeUndefined();
    expect(mockCreateReviewTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        reviewTypes: ['code_quality'],
        eventId: 'test-event-id',
      }),
    );
    expect(events.find((e) => e.event.type === 'triage_dispatch')?.event).toMatchObject({
      type: 'triage_dispatch',
      reviewTypes: ['code_quality'],
    });
  });
});
```

- [ ] **Step 2: Run the webhook flow tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/webhooks/automationLogFlows.test.ts
```

Expected: the new integration guard passes once Task 1 is implemented; if the mock path makes it pass before Task 1, keep it as a regression guard for the route/rules/log path and rely on Task 1's unit test for the downstream action validation.

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts
git commit -m "test(code-agent): cover ready-for-review automation log flow (INT-1603)"
```

## Task 4: Verify The Code-Agent Workspace

**Files:**
- No new source files.

- [ ] **Step 1: Run tracked workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: code-agent lint, typecheck, tests, and coverage pass.

- [ ] **Step 2: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: the full tracked CI completes successfully.

- [ ] **Step 3: Self-review against INT-1603**

Confirm:

```bash
rg -n "ready_for_review|Expected opened/synchronize" apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts apps/code-agent/src/domain/services/automationCommentRenderer.ts apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts
```

Expected:
- `ready_for_review` appears in the GitHub Agent allowlist and tests.
- The old rejection text `Expected opened/synchronize action` no longer appears.
- `automationCommentRenderer` wraps `triage_failed` details with `Details`, not `Error`.

- [ ] **Step 4: Final commit only after CI passes**

If formatting or verification edits were needed:

```bash
git add apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts apps/code-agent/src/domain/services/automationCommentRenderer.ts apps/code-agent/src/domain/services/__tests__/automationCommentRenderer.test.ts apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts
git commit -m "test(code-agent): verify ready-for-review triage (INT-1603)"
```

## Handoff Notes

- This is a single-service plan for `apps/code-agent`; no parallel subtasks are required.
- Preserve the existing universal draft PR gate. Do not make draft PRs triage on `opened`; only `ready_for_review` should trigger initial review after a draft transition.
- No Firestore migration, schema migration, Terraform change, or endpoint contract change is expected.
- The implementation should not rename `AutomationEvent.triage_failed.error`; the rendered label is enough to fix the misleading PR log wording without rippling through persistence and tests.
