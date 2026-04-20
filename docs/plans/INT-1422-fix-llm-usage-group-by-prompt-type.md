# INT-1422 — Fix internal server error when grouping LLM usage by prompt type

> **For agentic workers:** Use superpowers:executing-plans to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1422](https://linear.app/pbuchman/issue/INT-1422/fix-internal-server-error-when-grouping-events-by-prompt-type-and-date)

**Goal:** Stop the LLM Usage page from returning HTTP 500 when "Group by → Prompt Type" is selected. Make the UI's list of group-by options match what the backend aggregates actually support.

**Architecture:** The backend use case `queryUsage` groups over the `DailyUsageAggregate` model. That model has no `promptType` field. The fix is to make the backend's `ALLOWED_GROUP_BY` and the frontend's group-by options honest about what can actually be grouped — by removing `request.promptType`. Supporting prompt-type aggregation for real requires extending `DailyUsageAggregate` + backfill and is explicitly out of scope (tracked as a follow-up).

**Tech stack:** Fastify + Vitest (llm-usage-service), React + Vite + Vitest (web app), monorepo CI via `pnpm run ci:tracked`.

---

## Root cause (evidence)

- `apps/llm-usage-service/src/domain/models/usageQuery.ts:25-37` — `ALLOWED_GROUP_BY` includes `'request.promptType'`.
- `apps/llm-usage-service/src/domain/usecases/queryUsage.ts:55-66` — `GROUP_KEY_EXTRACTORS` has **no** entry for `'request.promptType'`.
- `apps/llm-usage-service/src/domain/usecases/queryUsage.ts:68-72` — `getGroupKey()` uses a non-null assertion (`GROUP_KEY_EXTRACTORS[field]!(agg)`). For `'request.promptType'` the lookup is `undefined`, so invoking it throws `TypeError: GROUP_KEY_EXTRACTORS[field] is not a function`, which bubbles up to the route handler as an unhandled exception and is returned as HTTP 500.
- `apps/llm-usage-service/src/domain/models/dailyAggregate.ts:1-34` — `DailyUsageAggregate` has no `promptType` field, so an extractor cannot be added without extending the aggregate pipeline (model + writer + backfill).
- Frontend path that produces the bad request:
  - `apps/web/src/components/llm-usage/filterConstants.ts:52` — `GROUP_BY_MAP.promptType = ['request.promptType']`.
  - `apps/web/src/components/llm-usage/filterConstants.ts:62` — `GROUP_BY_OPTIONS` exposes `{ key: 'promptType', label: 'Prompt Type' }`.
  - `apps/web/src/components/llm-usage/filterConstants.ts:10-17` — `GroupByMode` union includes `'promptType'`.
  - `apps/web/src/pages/LlmUsagePage.tsx:64` — `isGroupByMode` type guard whitelists `'promptType'` from localStorage.

`promptType` on the individual raw event (shown in `LlmUsagePage.tsx:184` and `LlmUsageViewPage.tsx:92`) is a per-event field and must remain — it is unrelated to the aggregate group-by path.

---

## Endpoint Changes

- **Modified:** `POST /llm-usage/query` — request validation for `groupBy` no longer accepts `"request.promptType"`. Response shape unchanged. Backwards compatible for all other group-by values.
- **Created:** none
- **Removed:** none
- **Unchanged:** all other llm-usage-service routes (raw events list, event detail) continue to expose `request.promptType` per-event.

---

## Out of scope (follow-up)

Actually supporting "Group by Prompt Type" requires:

1. Adding `promptType` to `DailyUsageAggregate`.
2. Updating the aggregator that writes daily aggregates to split by `promptType`.
3. Running a backfill migration for historical data.
4. Adding a `GROUP_KEY_EXTRACTORS['request.promptType']` entry.
5. Re-adding the frontend option.
6. Possibly adding composite Firestore indexes if the repository query gains a new filter surface.

Track as a separate Linear issue after this fix lands. Not part of INT-1422.

---

## File structure

- Modify: `apps/llm-usage-service/src/domain/models/usageQuery.ts` — remove `'request.promptType'` from `ALLOWED_GROUP_BY`.
- Modify: `apps/llm-usage-service/src/__tests__/domain/usecases/queryUsage.test.ts` — add a regression test that posting `groupBy: ['request.promptType']` now returns an `INVALID_GROUP_BY` error instead of throwing.
- Modify: `apps/web/src/components/llm-usage/filterConstants.ts` — remove `promptType` from `GroupByMode` union, `GROUP_BY_MAP`, and `GROUP_BY_OPTIONS`.
- Modify: `apps/web/src/pages/LlmUsagePage.tsx` — remove `'promptType'` from the `isGroupByMode` string allowlist so stale localStorage values fall through to `DEFAULT_GROUP_BY` (same pattern already used in `isSortState` for removed sort fields).

No new files. No migrations.

---

## Tasks

### Task 1 — Add failing backend test for the crash path

**Files:**
- Modify: `apps/llm-usage-service/src/__tests__/domain/usecases/queryUsage.test.ts`

- [ ] **Step 1: Add a new test case just below the existing `'rejects invalid groupBy fields'` test**

Append (immediately after the block that ends at the closing `});` of `'rejects invalid groupBy fields'`):

```ts
  it('rejects request.promptType as a groupBy field (DailyUsageAggregate does not track promptType)', async () => {
    const result = await queryUsage(
      { logger, usageAggregateRepository: aggregateRepo },
      {
        timeRange: { from: '2026-04-10T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        groupBy: ['request.promptType'],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_GROUP_BY');
    }
  });
```

- [ ] **Step 2: Run the test and confirm it FAILS**

```bash
pnpm --filter @intexuraos/llm-usage-service test -- queryUsage.test.ts
```

Expected: the new test FAILS — either because (a) the validation currently passes, and then the use case throws `TypeError: GROUP_KEY_EXTRACTORS[field] is not a function`, or (b) `result.ok` is unexpectedly `true`. Either symptom confirms the bug.

### Task 2 — Remove `request.promptType` from backend ALLOWED_GROUP_BY

**Files:**
- Modify: `apps/llm-usage-service/src/domain/models/usageQuery.ts:25-37`

- [ ] **Step 1: Edit the allowed list**

Change lines 25-37 from:

```ts
export const ALLOWED_GROUP_BY = [
  'day',
  'owner.type',
  'owner.id',
  'source.service',
  'source.component',
  'source.client',
  'request.provider',
  'request.model',
  'request.operation',
  'request.success',
  'request.promptType',
] as const;
```

to:

```ts
export const ALLOWED_GROUP_BY = [
  'day',
  'owner.type',
  'owner.id',
  'source.service',
  'source.component',
  'source.client',
  'request.provider',
  'request.model',
  'request.operation',
  'request.success',
] as const;
```

- [ ] **Step 2: Run the backend tests and confirm all pass**

```bash
pnpm --filter @intexuraos/llm-usage-service test
```

Expected: all tests PASS, including the new regression test from Task 1.

- [ ] **Step 3: Typecheck the backend**

```bash
pnpm --filter @intexuraos/llm-usage-service run typecheck
```

Expected: exit 0. Removing the entry does not break anything because `GROUP_KEY_EXTRACTORS` never referenced it.

- [ ] **Step 4: Commit**

```bash
git add apps/llm-usage-service/src/domain/models/usageQuery.ts \
        apps/llm-usage-service/src/__tests__/domain/usecases/queryUsage.test.ts
git commit -m "fix(llm-usage-service): reject request.promptType groupBy [INT-1422]"
```

### Task 3 — Remove `promptType` from frontend group-by options

**Files:**
- Modify: `apps/web/src/components/llm-usage/filterConstants.ts`

- [ ] **Step 1: Drop `'promptType'` from the `GroupByMode` union (lines 10-17)**

Change:

```ts
export type GroupByMode =
  | 'none'
  | 'day'
  | 'component'
  | 'service'
  | 'model'
  | 'openrouter-model'
  | 'promptType';
```

to:

```ts
export type GroupByMode =
  | 'none'
  | 'day'
  | 'component'
  | 'service'
  | 'model'
  | 'openrouter-model';
```

- [ ] **Step 2: Remove the `promptType` entry from `GROUP_BY_MAP` (line 52)**

Delete the line:

```ts
  promptType: ['request.promptType'],
```

- [ ] **Step 3: Remove the `promptType` entry from `GROUP_BY_OPTIONS` (line 62)**

Delete the line:

```ts
  { key: 'promptType', label: 'Prompt Type' },
```

### Task 4 — Keep the `isGroupByMode` guard consistent with the union

**Files:**
- Modify: `apps/web/src/pages/LlmUsagePage.tsx:63-65`

- [ ] **Step 1: Drop `'promptType'` from the runtime allowlist**

Change:

```ts
function isGroupByMode(v: unknown): v is GroupByMode {
  return typeof v === 'string' && ['none', 'day', 'component', 'service', 'model', 'openrouter-model', 'promptType'].includes(v);
}
```

to:

```ts
function isGroupByMode(v: unknown): v is GroupByMode {
  // Stale 'promptType' values from localStorage fall through to DEFAULT_GROUP_BY
  // after that option was removed from the UI.
  return typeof v === 'string' && ['none', 'day', 'component', 'service', 'model', 'openrouter-model'].includes(v);
}
```

This mirrors the pattern already documented just above in `isSortState` for removed sort fields.

- [ ] **Step 2: Typecheck the web app**

```bash
pnpm --filter @intexuraos/web run typecheck
```

Expected: exit 0. The union narrowing now matches the runtime guard.

- [ ] **Step 3: Run web app tests**

```bash
pnpm --filter @intexuraos/web test
```

Expected: all existing tests PASS. (The web app has no unit tests for this specific code path; typecheck is the primary gate.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/llm-usage/filterConstants.ts \
        apps/web/src/pages/LlmUsagePage.tsx
git commit -m "fix(web): drop Prompt Type group-by option that returned 500 [INT-1422]"
```

### Task 5 — Full CI

- [ ] **Step 1: Run the tracked-workspace CI gate from repo root**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1422.txt
```

Expected: exit 0. If any workspace fails, fix it before proceeding (per CLAUDE.md Commit Gate).

- [ ] **Step 2: If CI is green, push and open the PR**

```bash
git push -u origin <feature-branch>
gh pr create --base development \
  --title "[INT-1422] Fix LLM Usage internal server error on group-by Prompt Type" \
  --body "$(cat <<'EOF'
## Summary
- Removes the non-functional `Prompt Type` group-by option from the LLM Usage UI and backend validation.
- The backend's `DailyUsageAggregate` model never carried `promptType`, so the extractor was missing; grouping by `request.promptType` threw at runtime and returned HTTP 500.
- Supporting real grouping by prompt type requires extending the daily aggregate pipeline; tracked as a follow-up.

## Test plan
- [ ] `pnpm --filter @intexuraos/llm-usage-service test` — new regression test rejects `request.promptType`.
- [ ] `pnpm run ci:tracked` green.
- [ ] Manual: in the LLM Usage page, the Group By menu no longer lists "Prompt Type"; stale `promptType` values in localStorage fall through to default.

Fixes INT-1422
EOF
)"
```

---

## Manual verification checklist (after deploy)

- [ ] Open LLM Usage page — "Group By" menu no longer lists "Prompt Type".
- [ ] Select each remaining Group By option — none return 500.
- [ ] If a user previously saved "Prompt Type" in localStorage, page loads with default grouping instead of throwing.

## Self-review

- Spec coverage: the only requirement in the issue is "stop the 500 when grouping by prompt type and date" — Task 2 (backend validation) removes the crash; Tasks 3-4 stop the client from ever asking for it.
- No placeholders, every step shows exact code or exact command.
- Type consistency: `GroupByMode` union, `GROUP_BY_MAP` keys, `GROUP_BY_OPTIONS` keys, and `isGroupByMode` allowlist all lose `'promptType'` together — they stay in sync.
