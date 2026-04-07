# Fix Stale Merge Action After PR Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the "Merge" action from persisting in the web UI after a PR has been merged, by adding cache write-through in `linear-agent` and hardening the race-condition guard in `code-agent`.

**Architecture:** Two root causes. (1) The `linear-agent` PATCH `/metadata` endpoint updates labels on the Linear API but does NOT write-through to its Firestore cache — it relies on a delayed Linear webhook to sync. If the webhook is slow or lost, `fetchIssuesForDisplay` returns stale labels, and `derivePipeline` still shows the merge step. (2) In `code-agent`, the review-callback's `prAlreadyMerged` check depends on a cached PR summary document that may not yet reflect the merge, allowing `ready-to-merge` to be re-applied after `handlePrClose` already removed it.

**Tech Stack:** TypeScript, Fastify, Firestore, Linear API

---

## Root Cause Analysis

### Data flow (current, broken)

```
handlePrClose                          review callback (race)
  │                                       │
  ├─ removeLabel → linearAgentClient      ├─ checks prAlreadyMerged (stale)
  │    └─ PATCH /metadata → Linear API    │    └─ gitHubPRSummaryRepo (might not have mergedAt yet)
  │       (Firestore cache NOT updated)   ├─ adds ready-to-merge label → Linear API
  │                                       │    (Firestore cache NOT updated)
  ├─ recomputeWithLabels([], T_close)     ├─ recomputeWithLabels([...ready-to-merge], T_complete)
  │                                       │    (T_complete > T_close → overwrites!)
  │                                       │
  │  ... Linear webhook eventually ...    │
  │  (may or may not arrive in time)      │
```

### Root Cause 1: Missing write-through in `updateIssueMetadata`

**File:** `apps/linear-agent/src/routes/internalIssuesRoutes.ts:302-313`

After `linearApiClient.updateIssue()` succeeds, the response contains the updated labels (`updateResult.value.labels`). But this data is returned to the caller and **never written back to the Firestore cache** (`linear_issues` collection). The cache is only updated when Linear sends a webhook back, which is asynchronous and unreliable.

When `fetchIssuesForDisplay` is called (by the list or detail view), it reads from this stale Firestore cache via `findByIdentifiers`. The stale `ready-to-merge` label causes `hasMergeReadyLabel()` to return true, and `derivePipeline` adds the merge step.

### Root Cause 2: Race condition — review callback re-applies label after `handlePrClose`

**File:** `apps/code-agent/src/routes/webhookRoutes.ts:1248-1260`

When a review task completes with `needs_remediation === '0'`, the callback checks `prAlreadyMerged` using `gitHubPRSummaryRepo.findByPullRequest()`. This checks a Firestore document that is updated by the PR merge webhook handler — but the review callback may be processed before that document is updated. If `prAlreadyMerged` is false, the callback:
1. Adds `ready-to-merge` label back on Linear
2. Recomputes the group summary with `hasMergeReadyLabel: true`

If this happens AFTER `handlePrClose` has already cleaned up, the label and summary are re-polluted. The `sourceTimestamp` guard in `recomputeWithLabels` doesn't help because the review's `completedAt` can be later than the merge's `closedAt`.

---

## File Structure

| File                                                                  | Action              | Responsibility                                             |
| --------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `apps/linear-agent/src/routes/internalIssuesRoutes.ts`                | Modify (~302-313)   | Write-through cache + notify code-agent after label update |
| `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts` | Modify (~1139-1192) | Test cache write-through + notification                    |
| `apps/code-agent/src/routes/webhookRoutes.ts`                         | Modify (~1248-1260) | Use GitHub API as fallback for `prAlreadyMerged` check     |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`               | Modify              | Test improved merge check                                  |

---

## Task 1: Write-through cache in `updateIssueMetadata`

**Files:**
- Modify: `apps/linear-agent/src/routes/internalIssuesRoutes.ts:296-313`
- Test: `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`

This is the primary fix. After `linearApiClient.updateIssue()` succeeds, write the updated labels back to the Firestore cache AND notify code-agent to recompute the group summary.

- [ ] **Step 1: Write the failing test — verify Firestore cache is updated after label removal**

In `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`, inside the `describe('PATCH /internal/linear/issues/:issueId/metadata')` block, add a test after the existing "should remove label when called with Linear identifier" test:

```typescript
    it('should write-through updated labels to Firestore cache after successful update', async () => {
      fakeIssueRepo.seedIssue({
        id: 'uuid-wt-1',
        identifier: 'INT-2001',
        title: 'Write-Through Test',
        description: null,
        state: 'In Review',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
        url: 'https://linear.app/test/INT-2001',
        userId: testUserId,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        syncedAt: '2024-01-16T12:30:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      fakeLinearClient.setLabels([
        { id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' },
        { id: 'label-bug', name: 'bug', color: '#ff0000' },
      ]);

      fakeLinearClient.seedIssue({
        id: 'uuid-wt-1',
        identifier: 'INT-2001',
        title: 'Write-Through Test',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Review', type: 'started' },
        url: 'https://linear.app/test/INT-2001',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/INT-2001/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { removeLabels: ['ready-to-merge'] },
      });

      expect(response.statusCode).toBe(200);

      // Verify Firestore cache was updated — labels should now be empty
      const cachedIssue = await fakeIssueRepo.findById('uuid-wt-1');
      expect(cachedIssue.ok).toBe(true);
      if (cachedIssue.ok && cachedIssue.value !== null) {
        expect(cachedIssue.value.labels).toStrictEqual([]);
      }
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run verify:workspace:tracked -- linear-agent 2>&1 | tail -30
```

Expected: FAIL — the test will show that `cachedIssue.value.labels` still contains `ready-to-merge` because there's no write-through.

- [ ] **Step 3: Write the failing test — verify code-agent notification is sent**

Add another test in the same block:

```typescript
    it('should notify code-agent to recompute group summary after label update', async () => {
      fakeIssueRepo.seedIssue({
        id: 'uuid-notify-1',
        identifier: 'INT-2002',
        title: 'Notify Test',
        description: null,
        state: 'In Review',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
        url: 'https://linear.app/test/INT-2002',
        userId: testUserId,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        syncedAt: '2024-01-16T12:30:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      fakeLinearClient.setLabels([
        { id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' },
      ]);

      fakeLinearClient.seedIssue({
        id: 'uuid-notify-1',
        identifier: 'INT-2002',
        title: 'Notify Test',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Review', type: 'started' },
        url: 'https://linear.app/test/INT-2002',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/INT-2002/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { removeLabels: ['ready-to-merge'] },
      });

      expect(response.statusCode).toBe(200);

      // Verify code-agent was notified to recompute group summary
      const recomputeCalls = fakeCodeAgentClient.getRecomputeCalls();
      expect(recomputeCalls.length).toBe(1);
      expect(recomputeCalls[0]).toMatchObject({
        userId: testUserId,
        linearIssueId: 'INT-2002',
        labels: [],
      });
    });
```

Note: The `fakeCodeAgentClient` may need a `getRecomputeCalls()` method. Check if it exists; if not, add it to the fake (see Step 5).

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- linear-agent 2>&1 | tail -30
```

Expected: FAIL — no recompute call is made and `getRecomputeCalls()` may not exist yet.

- [ ] **Step 5: Add `getRecomputeCalls()` to `FakeCodeAgentClient` (if not already present)**

In `apps/linear-agent/src/__tests__/fakes.ts`, find the `FakeCodeAgentClient` class. Add tracking for recompute calls:

```typescript
  private recomputeCalls: Array<{ userId: string; linearIssueId: string; labels: { id: string; name: string }[]; sourceTimestamp: string }> = [];

  async notifyGroupSummaryRecompute(request: {
    userId: string;
    linearIssueId: string;
    labels: { id: string; name: string }[];
    sourceTimestamp: string;
  }): Promise<Result<void, CodeAgentError>> {
    this.recomputeCalls.push(request);
    return ok(undefined);
  }

  getRecomputeCalls(): Array<{ userId: string; linearIssueId: string; labels: { id: string; name: string }[]; sourceTimestamp: string }> {
    return this.recomputeCalls;
  }

  // Add to reset():
  // this.recomputeCalls = [];
```

- [ ] **Step 6: Implement the write-through and notification**

In `apps/linear-agent/src/routes/internalIssuesRoutes.ts`, after the `updateIssue` call succeeds (around line 306), add write-through and notification:

```typescript
      if (!updateResult.ok) return await handleLinearError(updateResult.error, reply);

      // Write-through: update the Firestore cache with the actual labels from Linear.
      // This prevents stale label data from being served by fetchIssuesForDisplay
      // until the next Linear webhook arrives.
      const updatedLabels = updateResult.value.labels.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      }));
      const saveResult = await services.issueRepository.save({
        ...syncedIssue,
        labels: updatedLabels,
        syncedAt: new Date().toISOString(),
      });
      if (!saveResult.ok) {
        request.log.warn(
          { issueId, error: saveResult.error },
          'updateIssueMetadata: write-through cache update failed (best-effort)'
        );
      }

      // Best-effort: notify code-agent to recompute group summary with updated labels.
      // This mirrors what processWebhook does when it receives a label-change webhook.
      void services.codeAgentClient.notifyGroupSummaryRecompute({
        userId,
        linearIssueId: syncedIssue.identifier,
        labels: updatedLabels.map((l) => ({ id: l.id, name: l.name })),
        sourceTimestamp: new Date().toISOString(),
      }).catch((notifyErr: unknown) => {
        request.log.warn(
          { issueId, error: notifyErr },
          'updateIssueMetadata: failed to notify code-agent of label change (best-effort)'
        );
      });

      return await reply.ok({
        id: updateResult.value.id,
        labels: updateResult.value.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
        assignee: updateResult.value.assignee ?? null,
        droppedLabels,
      });
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- linear-agent 2>&1 | tail -30
```

Expected: PASS — both new tests should pass, and all existing tests should still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/linear-agent/src/routes/internalIssuesRoutes.ts apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts apps/linear-agent/src/__tests__/fakes.ts
git commit -m "fix(linear-agent): write-through label cache in updateIssueMetadata

After successfully updating labels on the Linear API, also update the
Firestore cache and notify code-agent to recompute the group summary.
Previously, the cache was only updated by delayed Linear webhooks,
causing stale ready-to-merge labels to persist in the UI after PR merge.

Fixes INT-1286"
```

---

## Task 2: Harden `prAlreadyMerged` check with GitHub API fallback

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1248-1260`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

The existing `prAlreadyMerged` check uses `gitHubPRSummaryRepo.findByPullRequest()` which depends on a Firestore document that may lag behind the actual merge. Add a fallback that checks the GitHub API directly when the summary says "not merged."

- [ ] **Step 1: Identify the existing test for the `prAlreadyMerged` check**

Search for existing tests that cover this code path:

```bash
cd /repo && grep -n 'prAlreadyMerged\|Skipping review-outcome label.*already merged' apps/code-agent/src/__tests__/routes/webhooks.test.ts | head -10
```

Understand the test setup pattern (fakeGitHubPRSummaryRepo, etc.) before writing the new test.

- [ ] **Step 2: Write the failing test — verify GitHub API fallback detects merged PR**

In the existing `webhooks.test.ts` file, find the test section for review-outcome label handling and add:

```typescript
    it('should skip ready-to-merge label when GitHub API reports PR is merged (summary cache miss)', async () => {
      // Seed: PR summary says NOT merged (cache lag), but GitHub API says merged
      fakeGitHubPRSummaryRepo.seedSummary({
        repository: 'pbuchman/intexuraos',
        prNumber: 999,
        title: 'test PR',
        state: 'open', // stale: actually merged
        mergedAt: null, // stale: actually merged
        lastActivityAt: new Date().toISOString(),
      });

      // Configure fakeGitHubClient to report PR as merged
      fakeGitHubClient.setPrMerged('pbuchman/intexuraos', 999, true);

      // ... trigger review callback with needs_remediation '0' for PR 999 ...
      // ... assert that ready-to-merge label was NOT applied ...
      // ... assert log message about GitHub API fallback ...
    });
```

Note: Exact test setup depends on existing patterns in `webhooks.test.ts`. The agent implementing this task MUST read the existing tests first and follow the established patterns for seeding tasks, triggering callbacks, and asserting label operations.

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: FAIL — the fallback doesn't exist yet.

- [ ] **Step 4: Implement the GitHub API fallback**

In `apps/code-agent/src/routes/webhookRoutes.ts`, replace the `prAlreadyMerged` check block (lines ~1248-1260):

```typescript
              // Best-effort: set review-outcome label on the associated Linear issue
              // Skip if PR is already merged — handlePrClose already cleaned up labels.
              let prAlreadyMerged = false;
              try {
                const prMergeSummary = await gitHubPRSummaryRepo.findByPullRequest(task.repository, prNumber);
                prAlreadyMerged = prMergeSummary.ok && prMergeSummary.value !== null && prMergeSummary.value.mergedAt !== null;
              } catch {
                // gitHubPRSummaryRepo may not be fully initialized — assume not merged
              }

              // Fallback: if summary says not-merged, check GitHub API directly.
              // The summary is updated by a webhook that may arrive after this callback.
              if (!prAlreadyMerged) {
                try {
                  const prDetail = await gitHubClient.getPullRequest(task.repository, prNumber);
                  if (prDetail.ok && prDetail.value.merged === true) {
                    prAlreadyMerged = true;
                    request.log.info({ taskId, prNumber },
                      'prAlreadyMerged detected via GitHub API fallback (summary was stale)');
                  }
                } catch {
                  // GitHub API unavailable — proceed with summary-based decision
                }
              }
```

Note: The `gitHubClient` must already be available in scope (check existing deps). If `getPullRequest` doesn't exist, look for an equivalent method that returns PR state/merged status. The agent MUST read `gitHubClient` interface/implementation to find the correct method and adapt the code.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): add GitHub API fallback for prAlreadyMerged check

When the PR summary cache does not yet reflect a merge, fall back to
the GitHub API to check PR merge status before applying the
ready-to-merge label. Prevents the review callback from re-applying
the label after handlePrClose has already removed it.

Fixes INT-1286"
```

---

## Task 3: Full CI verification

- [ ] **Step 1: Run full CI from repo root**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1286.txt
```

Expected: All workspaces pass.

- [ ] **Step 2: If any failures, analyze and fix**

```bash
rg "error|FAIL" -C3 /tmp/ci-output-int-1286.txt
```

Fix any regressions. Re-run until clean.

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address CI feedback for INT-1286"
```

---

## Endpoint Changes

- **Modified:** `PATCH /internal/linear/issues/:issueId/metadata` (linear-agent) — now writes through to Firestore cache and notifies code-agent after label update. Response schema unchanged.
- **Unchanged:** `GET /code/issue-groups` (code-agent) — benefits from fixed cache data.
- **Unchanged:** `GET /code/tasks/:taskId` (code-agent) — benefits from fixed cache data.
- **Unchanged:** All other endpoints.
