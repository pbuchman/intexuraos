# Draft PR Gate: Block All Code-Tasks on Draft Pull Requests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pull request is in draft state, block all automated code-tasks (reviews, remediations, CI fixes, merge conflict fixes). When the PR transitions from draft to ready-for-review, immediately trigger a review.

**Architecture:** Add an `isDraft` field to the `GitHubPREvent` domain model, extract it from GitHub webhook payloads, and introduce a new `DraftPRRule` in the hard rules chain that short-circuits with `skip` when `isDraft === true`. Additionally, handle the `ready_for_review` action in `ActionableEventRule` so the draft-to-ready transition triggers LLM triage (which will dispatch a review). The rule fails open: when `isDraft` is `null` (e.g., `issue_comment` events where GitHub doesn't include draft info), the event passes through unchanged.

**Tech Stack:** TypeScript, Vitest, Firestore

---

## Design Decision (from user comment 2026-04-13)

The user explicitly decided against the complex per-PR opt-out mechanisms proposed in the original issue. Instead, the solution is universal and simple:

> "When a pull request is in a state of draft, there must be: no reviews, no remediations, no merge conflict fixes. Generally, no code-task must be allowed when a pull request is in a state of draft. When the draft changes to 'ready to review', then we immediately start with the review of the code."

This means:
- **All event types** are blocked for draft PRs (not just reviews)
- **No per-PR opt-out markers** needed — draft state IS the opt-out
- **ready_for_review** transition is the trigger for initial review

## File Structure

| Action   | File                                                                       | Responsibility                                                               |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/models/gitHubPREvent.ts`                       | Add `isDraft: boolean \                                                      | null` to `GitHubPREvent` and `CreateGitHubPREventInput` |
| Modify   | `apps/code-agent/src/infra/github-event-parser.ts`                         | Extract `pull_request.draft` / `issue.draft` from webhook payloads           |
| Modify   | `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`                | Add `DraftPRRule` class; update `ActionableEventRule` for `ready_for_review` |
| Modify   | `apps/code-agent/src/services.ts`                                          | Wire `DraftPRRule` into the rules chain                                      |
| Modify   | `apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts`          | Persist/read `isDraft` field                                                 |
| Modify   | `apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts` | Tests for `DraftPRRule` and `ActionableEventRule` ready_for_review handling  |
| Modify   | `apps/code-agent/src/__tests__/infra/github-event-parser.test.ts`          | Tests for `isDraft` extraction from payloads                                 |
| Create   | `.claude/reference/draft-pr-policy.md`                                     | Reference doc explaining draft PR gating behavior                            |

## Key Design Decisions

1. **Fail open on missing draft info.** For event types where GitHub doesn't include `pull_request.draft` (e.g., some `issue_comment` payloads), `isDraft` is `null` and the rule passes through. The primary vectors (pull_request, pull_request_review, pull_request_review_comment) all include draft status.

2. **DraftPRRule position in chain.** Placed after `CodeWorkerOutputRule` (which prevents feedback loops) but before `CIFailureRule` and `ActionableEventRule`. This ensures draft PRs are blocked before any LLM triage cost is incurred, and before CI failure tasks are created.

3. **`ready_for_review` as `needs_triage`.** The `ready_for_review` action is added to `ActionableEventRule` as a `needs_triage` outcome (not hard dispatch). This lets the LLM decide the appropriate review types, consistent with how `pull_request.opened` and `pull_request.synchronize` are handled.

4. **No Firestore migration needed.** The `isDraft` field is added to the domain model and Firestore adapter, but existing documents without the field will read as `undefined` which gets defaulted to `null` — fail-open behavior.

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints

---

### Task 1: Add `isDraft` field to domain model

**Files:**
- Modify: `apps/code-agent/src/domain/models/gitHubPREvent.ts`

- [ ] **Step 1: Add `isDraft` to `GitHubPREvent` interface**

In `apps/code-agent/src/domain/models/gitHubPREvent.ts`, add the `isDraft` field to the `GitHubPREvent` interface after the `state` field:

```typescript
export interface GitHubPREvent {
  // ... existing fields ...
  state: string | null;
  isDraft: boolean | null;
  baseBranch: string | null;
  // ... rest of fields ...
}
```

- [ ] **Step 2: Add `isDraft` to `CreateGitHubPREventInput` interface**

In the same file, add `isDraft` to `CreateGitHubPREventInput` after the `state` field:

```typescript
export interface CreateGitHubPREventInput {
  // ... existing fields ...
  state: string | null;
  isDraft: boolean | null;
  baseBranch: string | null;
  // ... rest of fields ...
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | head -50`

Expected: Build errors in files that construct `GitHubPREvent` or `CreateGitHubPREventInput` objects without `isDraft`. This confirms the type system catches all call sites — they will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/models/gitHubPREvent.ts
git commit -m "feat(code-agent): add isDraft field to GitHubPREvent domain model (INT-1345)"
```

---

### Task 2: Extract `isDraft` from webhook payloads

**Files:**
- Modify: `apps/code-agent/src/infra/github-event-parser.ts`
- Test: `apps/code-agent/src/__tests__/infra/github-event-parser.test.ts`

- [ ] **Step 1: Write the failing test for `isDraft` extraction in `parsePullRequestEvent`**

Add tests to the existing `parsePullRequestEvent` describe block in `apps/code-agent/src/__tests__/infra/github-event-parser.test.ts`:

```typescript
it('should extract isDraft as true when pull_request.draft is true', () => {
  const payload = {
    action: 'opened',
    repository: { full_name: 'test-org/intexuraos', id: 1 },
    pull_request: {
      number: 42,
      id: 100,
      title: 'Draft PR',
      body: 'WIP',
      state: 'open',
      draft: true,
      base: { ref: 'development' },
      user: { login: 'test-user' },
      merged_at: null,
    },
    sender: { login: 'test-user', id: 1, type: 'User' },
  };

  const result = parsePullRequestEvent(payload);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.isDraft).toBe(true);
  }
});

it('should extract isDraft as false when pull_request.draft is false', () => {
  const payload = {
    action: 'opened',
    repository: { full_name: 'test-org/intexuraos', id: 1 },
    pull_request: {
      number: 42,
      id: 100,
      title: 'Ready PR',
      body: 'Done',
      state: 'open',
      draft: false,
      base: { ref: 'development' },
      user: { login: 'test-user' },
      merged_at: null,
    },
    sender: { login: 'test-user', id: 1, type: 'User' },
  };

  const result = parsePullRequestEvent(payload);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.isDraft).toBe(false);
  }
});

it('should default isDraft to null when pull_request.draft is missing', () => {
  const payload = {
    action: 'opened',
    repository: { full_name: 'test-org/intexuraos', id: 1 },
    pull_request: {
      number: 42,
      id: 100,
      title: 'Old PR',
      body: 'No draft field',
      state: 'open',
      base: { ref: 'development' },
      user: { login: 'test-user' },
      merged_at: null,
    },
    sender: { login: 'test-user', id: 1, type: 'User' },
  };

  const result = parsePullRequestEvent(payload);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.isDraft).toBeNull();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/github-event-parser.test.ts 2>&1 | tail -20`

Expected: FAIL — `isDraft` property doesn't exist on the returned type.

- [ ] **Step 3: Add `isDraft` extraction to `parsePullRequestEvent`**

In `apps/code-agent/src/infra/github-event-parser.ts`, in the `parsePullRequestEvent` function, extract the `draft` field from the `pull_request` object. Add this line after `const prMergedAt = pr['merged_at'];` (around line 124):

```typescript
const prDraft = pr['draft'];
```

Then add `isDraft` to the returned object, after the `state` field (around line 160):

```typescript
state: typeof prState === 'string' ? prState : null,
isDraft: typeof prDraft === 'boolean' ? prDraft : null,
baseBranch,
```

- [ ] **Step 4: Add `isDraft` extraction to `parsePullRequestReviewEvent`**

In the `parsePullRequestReviewEvent` function, extract `draft` from the `pull_request` object. Add after the `prMergedAt` extraction (around line 263):

```typescript
const prDraft = pr['draft'];
```

Then add `isDraft` to the returned object after `state`:

```typescript
state: typeof prState === 'string' ? prState : null,
isDraft: typeof prDraft === 'boolean' ? prDraft : null,
baseBranch,
```

- [ ] **Step 5: Add `isDraft` extraction to `parsePullRequestReviewCommentEvent`**

In the `parsePullRequestReviewCommentEvent` function, extract `draft` from the `pull_request` object. Add after `const prMergedAt = pr['merged_at'];` (around line 351):

```typescript
const prDraft = pr['draft'];
```

Then add `isDraft` to the returned object after `state`:

```typescript
state: typeof prState === 'string' ? prState : null,
isDraft: typeof prDraft === 'boolean' ? prDraft : null,
baseBranch,
```

- [ ] **Step 6: Add `isDraft` to `parseIssueCommentEvent`**

In the `parseIssueCommentEvent` function, the `issue` object may or may not have a `draft` field. Extract it after `const prState = issueObj['state'] ?? null;` (around line 456):

```typescript
const prDraft = issueObj['draft'];
```

Then add `isDraft` to the returned object after `state`:

```typescript
state: typeof prState === 'string' ? prState : null,
isDraft: typeof prDraft === 'boolean' ? prDraft : null,
baseBranch: null,
```

- [ ] **Step 7: Add `isDraft: null` to `parsePushEvent` and `parseCheckSuiteEvent`**

Push events and check_suite events don't have PR draft information. Add `isDraft: null` to both returned objects.

In `parsePushEvent`, after the `state: null` line:

```typescript
state: null,
isDraft: null,
baseBranch: null,
```

In `parseCheckSuiteEvent`, after the `state` line:

```typescript
state: typeof prState === 'string' ? prState : null,
isDraft: null,
baseBranch: headBranch,
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/github-event-parser.test.ts 2>&1 | tail -20`

Expected: All tests pass, including the new `isDraft` tests.

- [ ] **Step 9: Commit**

```bash
git add apps/code-agent/src/infra/github-event-parser.ts apps/code-agent/src/__tests__/infra/github-event-parser.test.ts
git commit -m "feat(code-agent): extract isDraft from webhook payloads (INT-1345)"
```

---

### Task 3: Update Firestore repository to persist `isDraft`

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts`

- [ ] **Step 1: Add `isDraft` to the `save` method**

In `apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts`, in the `save` method, add `isDraft` to the `eventData` object after the `state` field (around line 98):

```typescript
state: input.state,
isDraft: input.isDraft,
baseBranch: input.baseBranch,
```

Also add it to the returned `ok(...)` object after `state` (around line 126):

```typescript
state: eventData.state,
isDraft: eventData.isDraft,
baseBranch: eventData.baseBranch,
```

- [ ] **Step 2: Add `isDraft` to all `findBy*` read methods**

In each of the `findByPullRequest`, `findByRepository`, `findReviewComments`, and `findAll` methods, the Firestore document data is mapped to `GitHubPREvent`. Add `isDraft` to each mapping, defaulting to `null` for backwards compatibility with existing documents that lack the field.

For each `snapshot.docs.map` or `events.push` call, add after the `baseBranch` line:

```typescript
isDraft: (data as Record<string, unknown>)['isDraft'] === true ? true
  : (data as Record<string, unknown>)['isDraft'] === false ? false
  : null,
```

This handles: `true` → `true`, `false` → `false`, `undefined`/missing → `null` (fail open for old documents).

- [ ] **Step 3: Verify build compiles**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | tail -20`

Expected: Build succeeds (or fewer errors than before — remaining errors in test files that construct mock events without `isDraft`).

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts
git commit -m "feat(code-agent): persist isDraft in Firestore PR events (INT-1345)"
```

---

### Task 4: Fix all test fixtures to include `isDraft`

**Files:**
- Modify: All test files that construct `GitHubPREvent` mock objects

- [ ] **Step 1: Find all test files with `GitHubPREvent` mock objects**

Run: `cd /repo && grep -rn "mockEvent\|GitHubPREvent\b" apps/code-agent/src/__tests__/ --include="*.ts" -l`

These files contain mock event objects that need `isDraft: null` (or `isDraft: false`) added.

- [ ] **Step 2: Add `isDraft` to each mock event object**

For every mock `GitHubPREvent` or inline event spread (`{ ...mockEvent, ... }`), add `isDraft: null` after the `state` field. The base `mockEvent` objects (like the one in `gitHubWebhookRules.test.ts` at line 18) are the most important — updating them cascades to all spread-based overrides.

Example for `gitHubWebhookRules.test.ts`:

```typescript
const mockEvent: GitHubPREvent = {
  // ... existing fields ...
  state: 'open',
  isDraft: null,
  baseBranch: null,
  // ... rest ...
};
```

- [ ] **Step 3: Build and verify all type errors are resolved**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | tail -30`

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Run full test suite to verify nothing broke**

Run: `cd /repo && pnpm vitest run --project code-agent 2>&1 | tail -30`

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/__tests__/
git commit -m "test(code-agent): add isDraft to all test fixtures (INT-1345)"
```

---

### Task 5: Add `DraftPRRule` and update `ActionableEventRule`

**Files:**
- Modify: `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts`

- [ ] **Step 1: Write failing tests for `DraftPRRule`**

Add a new `describe('DraftPRRule', ...)` block in `apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts`:

```typescript
describe('DraftPRRule', () => {
  const rule = new DraftPRRule();

  it('should skip when isDraft is true', () => {
    const event = { ...mockEvent, isDraft: true };
    const result = rule.evaluate(event);

    expect(result).toEqual({
      action: 'skip',
      reason: 'DRAFT_PR',
      context: { pullRequestNumber: 123 },
    });
  });

  it('should dispatch when isDraft is false', () => {
    const event = { ...mockEvent, isDraft: false };
    const result = rule.evaluate(event);

    expect(result).toEqual({
      action: 'dispatch',
      reason: 'NOT_DRAFT_PR',
    });
  });

  it('should dispatch when isDraft is null (fail open)', () => {
    const event = { ...mockEvent, isDraft: null };
    const result = rule.evaluate(event);

    expect(result).toEqual({
      action: 'dispatch',
      reason: 'DRAFT_STATUS_UNKNOWN',
    });
  });
});
```

- [ ] **Step 2: Write failing tests for `ActionableEventRule` `ready_for_review` handling**

Add to the existing `describe('ActionableEventRule', ...)` block:

```typescript
it('should return needs_triage for pull_request ready_for_review', () => {
  const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'ready_for_review' as const };
  const rule = new ActionableEventRule(allowedBots);
  const result = rule.evaluate(event);

  expect(result).toEqual({ action: 'needs_triage', reason: 'PR_READY_FOR_REVIEW' });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts 2>&1 | tail -30`

Expected: FAIL — `DraftPRRule` is not exported; `ready_for_review` returns `EVENT_NOT_ACTIONABLE`.

- [ ] **Step 4: Implement `DraftPRRule`**

Add the following class to `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`, after the `CodeWorkerOutputRule` class (so it's positioned logically near the top of the file):

```typescript
/**
 * Rule that skips ALL events for pull requests in draft state.
 *
 * Draft PRs should receive no automated code-tasks: no reviews,
 * no remediations, no CI fixes, no merge conflict fixes.
 * When isDraft is null (event type doesn't carry draft info), fails open.
 */
export class DraftPRRule implements WebhookRule {
  evaluate(event: GitHubPREvent): RuleOutcome {
    if (event.isDraft === true) {
      return {
        action: 'skip',
        reason: 'DRAFT_PR',
        context: { pullRequestNumber: event.pullRequestNumber },
      };
    }

    if (event.isDraft === false) {
      return { action: 'dispatch', reason: 'NOT_DRAFT_PR' };
    }

    // isDraft is null — event type doesn't include draft status (e.g., issue_comment).
    // Fail open: allow the event through.
    return { action: 'dispatch', reason: 'DRAFT_STATUS_UNKNOWN' };
  }
}
```

- [ ] **Step 5: Update `ActionableEventRule` to handle `ready_for_review`**

In `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`, in the `ActionableEventRule.evaluate` method, add a new condition BEFORE the existing `pull_request opened/synchronize` check (around line 114):

```typescript
// pull_request ready_for_review → needs_triage (triggers review on draft→ready transition)
if (event.eventType === 'pull_request' && event.action === 'ready_for_review') {
  return { action: 'needs_triage', reason: 'PR_READY_FOR_REVIEW' };
}
```

- [ ] **Step 6: Add `DraftPRRule` to the exports**

Ensure `DraftPRRule` is exported from `gitHubWebhookRules.ts`. It's a named export by virtue of being an `export class`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts 2>&1 | tail -30`

Expected: All tests pass, including the new `DraftPRRule` and `ready_for_review` tests.

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubWebhookRules.ts apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts
git commit -m "feat(code-agent): add DraftPRRule and ready_for_review handling (INT-1345)"
```

---

### Task 6: Wire `DraftPRRule` into the rules chain

**Files:**
- Modify: `apps/code-agent/src/services.ts`

- [ ] **Step 1: Import `DraftPRRule`**

In `apps/code-agent/src/services.ts`, add `DraftPRRule` to the import from `gitHubWebhookRules.js` (line 62):

```typescript
import { CodeWorkerOutputRule, DraftPRRule, ActionableEventRule, ProtectedBaseBranchRule, SenderWhitelistRule, SkipPrefixRule, CIFailureRule, createWebhookRulesService, type WebhookRulesService } from './domain/services/gitHubWebhookRules.js';
```

- [ ] **Step 2: Add `DraftPRRule` to the rules array**

In the `createWebhookRulesService([...])` call (around line 417), add `new DraftPRRule()` after `CodeWorkerOutputRule` and before `CIFailureRule`:

```typescript
const webhookRules = createWebhookRulesService([
  // Note: RepositoryScopeRule is NOT included here because the route handler
  // already filters via shouldProcessRepository() which correctly handles
  // both intexuraos/* and */intexuraos patterns. Adding it here would be
  // redundant and risks scope mismatch (see PR #997 review).
  new CodeWorkerOutputRule(CODE_WORKER_BOTS),
  // DraftPRRule must come before CIFailureRule and ActionableEventRule
  // to block ALL code-tasks on draft PRs before any dispatch/triage cost.
  new DraftPRRule(),
  // CIFailureRule must come BEFORE ActionableEventRule to catch check_suite
  // events before ActionableEventRule short-circuits with "skip" (check_suite
  // is not in ActionableEventRule's list of known event types).
  new CIFailureRule(),
  new ActionableEventRule(ALLOWED_BOTS),
  new ProtectedBaseBranchRule(),
  new SenderWhitelistRule(ALLOWED_BOTS),
  new SkipPrefixRule(['@claude', '@codex', '@ignore']),
]);
```

- [ ] **Step 3: Build to verify**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/services.ts
git commit -m "feat(code-agent): wire DraftPRRule into webhook rules chain (INT-1345)"
```

---

### Task 7: Add reference documentation

**Files:**
- Create: `.claude/reference/draft-pr-policy.md`

- [ ] **Step 1: Create the reference document**

```markdown
# Draft PR Policy

## Rule

When a pull request is in **draft** state, **no automated code-tasks are allowed**:

- No reviews
- No remediations (nitpick-nuker)
- No CI failure fixes
- No merge conflict fixes

When the PR transitions from draft to **ready for review**, the system immediately triggers an LLM-triaged review.

## How It Works

1. GitHub sends a `draft: true/false` boolean in the `pull_request` object of webhook payloads.
2. The `DraftPRRule` (in `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`) checks `event.isDraft` and returns `skip` for draft PRs.
3. The rule is positioned early in the hard rules chain (after `CodeWorkerOutputRule`, before `CIFailureRule`), so draft PRs are blocked before any LLM triage cost.
4. The `ActionableEventRule` treats `ready_for_review` as `needs_triage`, which triggers LLM evaluation → review dispatch.

## Fail-Open Behavior

For event types where GitHub doesn't include draft status (e.g., `issue_comment`, `check_suite`), `isDraft` is `null` and the rule passes through. The primary vectors — `pull_request`, `pull_request_review`, and `pull_request_review_comment` events — all include draft status.

## Usage for Long-Lived PRs

To prevent automated interference on a long-lived PR (e.g., Hetzner migration):
1. Convert the PR to draft via GitHub UI
2. Work on the branch freely — no automated tasks will fire
3. When ready for review, mark the PR as ready — review will trigger automatically

## Related

- INT-1345: Original issue
- INT-750: Hetzner migration PR that motivated this policy
- `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`: Rule implementation
```

- [ ] **Step 2: Commit**

```bash
git add .claude/reference/draft-pr-policy.md
git commit -m "docs: add draft PR policy reference (INT-1345)"
```

---

### Task 8: Run full CI verification

- [ ] **Step 1: Run the workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tee /tmp/ci-output-int1345.txt | tail -40`

Expected: All tests pass, coverage meets thresholds.

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int1345-full.txt | tail -40`

Expected: All workspaces pass. If failures occur in unrelated workspaces, investigate and fix — ownership mindset applies.

- [ ] **Step 3: Fix any coverage gaps**

If new code paths have uncovered branches, either:
- Add test coverage (preferred)
- Add v8 ignore comments with valid exemption categories and explanations that name the testing BLOCKER

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(code-agent): address coverage gaps for draft PR gate (INT-1345)"
```
