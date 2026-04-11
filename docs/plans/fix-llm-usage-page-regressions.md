# Fix LLM Usage Page Regressions

## Context

The `/#/llm-usage` page has five interacting regressions that make it unusable:

1. Page gets stuck showing "Loading…" even after the initial request succeeds.
2. Changing a filter triggers an infinite loop of `POST /llm-usage/events/list` requests.
3. Selecting "Most expensive" sort crashes with `INVALID_ARGUMENT: order by clause cannot contain more fields after the key`.
4. Selecting the "Custom" time-range preset immediately fires a request with empty `from`/`to`, failing backend date-time validation.
5. Selecting "Oldest first" fails with `FAILED_PRECONDITION: The query requires an index`. Separately, `firestore.indexes.json` is missing every `llm_usage_events` index that migrations 086 & 087 declared.

This plan fixes each at its real root cause with the smallest reasonable change.

## Endpoint Changes

- **Modified / Created / Removed:** none.
- **Unchanged:** `POST /llm-usage/events/list`, `POST /llm-usage/query`, `GET /llm-usage/events/:eventId`.

## Fix 1 — Stop the render-churn at the caller (closes Issue 2)

**Root cause:** `LlmUsagePage.tsx:494` calls `resolveTimeRange(timeRange)` **inline on every render**. `resolveTimeRange()` uses `new Date()` for the `today`/`last7days`/`last30days` branches (`apps/web/src/utils/llmUsageTimeRange.ts:35,38,45,49`), so `to: now.toISOString()` ticks on every render. That produces a new object identity *and* new ISO string every render → the hook's `JSON.stringify({timeRange,...})` guard never matches → each `setLoading(true)` re-render produces a new "now" → infinite `refresh()` loop once `loading` is ever `false`.

**Change:**

- `apps/web/src/pages/LlmUsagePage.tsx` — wrap `resolveTimeRange(timeRange)` in `useMemo(() => resolveTimeRange(timeRange), [timeRange])`. `timeRange` state only changes when the user interacts, so the resolved object is reference-stable across unrelated renders.

**Deliberately not touched:** `resolveTimeRange` itself. Day-aligning "last 7 days" would silently change user-visible semantics (events from the current hour would vanish until UTC rolls over). The caller-side fix is sufficient.

**Tests:** `apps/web/src/pages/__tests__/LlmUsagePage.test.tsx` if present (otherwise skip — the real regression test is manual smoke plus the Strict Mode test in Fix 2).

## Fix 2 — One-line `isMountedRef` re-mount fix (closes Issue 1)

**Root cause:** `apps/web/src/hooks/useLlmUsageEvents.ts:100-109` (and `useLlmUsageQuery.ts:94-103`):

```ts
useEffect(() => {
  if (!enabled) return;
  if (optionsJson === optionsJsonRef.current) return; // early return
  optionsJsonRef.current = optionsJson;
  isMountedRef.current = true;                         // never runs on 2nd Strict Mode mount
  void refresh();
  return (): void => { isMountedRef.current = false; };
}, [...]);
```

React 18 Strict Mode runs the effect, then the cleanup (flipping the ref `false`), then the effect again. On the second invocation the guard catches (the ref was already written on the first invocation), so the re-assignment to `true` is skipped. The original in-flight `refresh()` then resolves, sees `isMountedRef.current === false`, and drops every `setState` — `loading` stays `true` forever.

**Change (minimal, both hooks):** move `isMountedRef.current = true;` **before** the guard:

```ts
useEffect(() => {
  if (!enabled) return;
  isMountedRef.current = true;
  if (optionsJson === optionsJsonRef.current) return;
  optionsJsonRef.current = optionsJson;
  void refresh();
  return (): void => { isMountedRef.current = false; };
}, [...]);
```

This preserves the existing `isMountedRef` semantics for `refresh`, `loadMore`, polling, and visibility handlers (all of which read the same ref). No cancellation architecture changes; no new mechanisms.

**Cross-service audit (CLAUDE.md rule):** `apps/web/src/hooks/useIssueGroups.ts` is the blueprint `useLlmUsageEvents` was copied from (see `docs/plans/INT-1340-track-1-llm-usage-web-ui.md:44`). Audit it for the same pattern. If it has the same bug, fix it in the same PR.

**Tests:**
- `apps/web/src/hooks/__tests__/useLlmUsageEvents.test.ts` — add a Strict Mode case using `<StrictMode>` wrapper in `renderHook`; assert `loading` transitions to `false` after a single fetch.
- `apps/web/src/hooks/__tests__/useLlmUsageQuery.test.ts` — same.

## Fix 3 — Drop the broken alt-sort buttons (closes Issue 3)

**Root cause:** `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts:96` builds `orderBy(sortField, dir).orderBy('__name__', dir)` with no leading `orderBy('occurredAt', ...)`. Because the query has a range filter on `occurredAt`, Firestore auto-appends that orderBy **after** the explicit clauses, producing `cost.billedUsd, __name__, occurredAt` — a field after the document key → the observed INVALID_ARGUMENT error.

**Why not fix the query:** Even after adding `orderBy('occurredAt')` first, the existing composite index (`occurredAt DESC, cost.billedUsd DESC, __name__ DESC`) would make `cost.billedUsd` a tiebreaker under `occurredAt`. Since `occurredAt` is effectively unique per event, `cost.billedUsd` sort order never kicks in, so "Most expensive" would silently become "newest first". An in-memory sort path (fetch range → cap at 500 → sort in JS → paginate in memory) avoids that, but introduces three new correctness cliffs:

1. Events beyond the 500-row cap are invisible to the sort — user sees "top 50 of most-recent 500", not "top 50 of all matches".
2. `LlmUsagePage.tsx:144-148` renders "Showing X of Y events" from `count().get()`, which is accurate over the full range → header would claim the 50 shown are "the 50 most expensive of 12,000", but they're the 50 most expensive of the 500 newest. Silent lie.
3. `nextCursor` semantics diverge between sort modes, breaking a single `ListLlmUsageEventsResponse` contract.

**Change (UI only):** remove "Most expensive" and "Most tokens" from `SORT_OPTIONS` in `apps/web/src/pages/LlmUsagePage.tsx:64-69`. File a follow-up issue for proper aggregate-backed alt-sort architecture.

**Deliberately not touched:** the Firestore repository, the backend use case, migrations 086/087, `fakeUsageEventRepository.ts`. Zero backend risk.

**Tests:** update the UI snapshot / button-list test if one exists; otherwise no backend tests need changes because the code path isn't removed — just unreachable from the UI.

## Fix 4 — Don't fetch when Custom preset has no dates (closes Issue 4)

**Root cause:** `LlmUsagePage.tsx:172` sets `preset: 'custom'` but leaves `customFrom`/`customTo` undefined on first click. `resolveTimeRange` returns `{ from: '', to: '' }` (`llmUsageTimeRange.ts:52`). The backend Fastify schema (`publicUsageRoutes.ts:52-53`) rejects empty strings with `format: 'date-time'`.

**Change (caller only, no type churn):**

In `apps/web/src/pages/LlmUsagePage.tsx`:

```ts
const isCustomIncomplete =
  timeRange.preset === 'custom' &&
  (timeRange.customFrom === undefined || timeRange.customTo === undefined);

const eventsResult = useLlmUsageEvents({
  timeRange: resolvedTimeRange,
  filters,
  sortBy,
  enabled: isRawMode && !isCustomIncomplete,
});
const queryResult = useLlmUsageQuery({
  timeRange: resolvedTimeRange,
  filters,
  groupBy: queryGroupBy,
  enabled: !isRawMode && !isCustomIncomplete,
});
```

**Deliberately not touched:** `resolveTimeRange` return type stays `ResolvedTimeRange`; neither hook signature changes; no "Pick a start and end date" copy (out of scope).

**Tests:** `LlmUsagePage` test (if present) — assert that clicking Custom with no dates does not call `listLlmUsageEvents` / `queryLlmUsage`. Otherwise manual smoke.

## Fix 5 — New migration + regenerate `firestore.indexes.json`

**Root causes (two separate problems):**

1. **`firestore.indexes.json` is missing all `llm_usage_events` entries.** `grep llm_usage firestore.indexes.json` returns 0 matches. Migrations 086 & 087 were never materialized into the committed source-of-truth file (the file is tracked — see `.gitignore:61`).
2. **No ASC variant for the occurredAt sort.** "Oldest first" = `.orderBy('occurredAt', 'asc').orderBy('__name__', 'asc')`. Migrations 086/087 declare DESCENDING variants only.

**Constraints (from `.claude/CLAUDE.md`):** existing migrations are immutable; generated `firestore.indexes.json` must be committed.

**Changes:**

1. **Create `migrations/091_llm-usage-events-asc-index.mjs`** declaring a **single** unfiltered ASC index:

   ```js
   export const indexes = [
     {
       collectionGroup: 'llm_usage_events',
       queryScope: 'COLLECTION',
       fields: [
         { fieldPath: 'occurredAt',  order: 'ASCENDING' },
         { fieldPath: '__name__',    order: 'ASCENDING' },
       ],
     },
   ];
   ```

   Do **not** pre-add filter-combo ASC indexes. There is no evidence anyone sorts by "Oldest first + filter" today; add those reactively if a `FAILED_PRECONDITION` surfaces.

2. **Run `pnpm run migrate`** locally (or `--dry-run`) to regenerate `firestore.indexes.json`. The regeneration re-aggregates indexes from *all* migrations, so the output will include the previously-unmaterialized 086/087 entries **plus** the new 091 entry. Commit the regenerated file.

3. **Deploy to `intexuraos-dev-pbuchman`** via `pnpm run migrate`. Firestore index build is asynchronous — note this in the PR body so the reviewer knows "Oldest first" will 500 until the index finishes building.

## Ordering of Work

1. Plan (this document) → simplify skill review → accepted.
2. **Deploy indexes first** (Fix 5) — start asynchronously, it takes time to build.
3. Fix 1 (caller-side `useMemo`).
4. Fix 2 (one-line `isMountedRef` move in both hooks, plus `useIssueGroups.ts` audit).
5. Fix 3 (drop two UI buttons).
6. Fix 4 (caller-side `enabled` gate).
7. Wait for index build → `gcloud firestore indexes composite list | grep llm_usage_events | grep READY`.
8. `pm2 restart llm-usage-service` on dev host (not needed for web — Vite HMR).
9. `pnpm run ci:tracked` (both `web` and `llm-usage-service` workspaces).
10. Simplify skill on implementation → accepted.
11. Commit, push, PR against `development`.

## Verification

- `pnpm run verify:workspace:tracked -- llm-usage-service`
- `pnpm run verify:workspace:tracked -- web`
- `pnpm run ci:tracked`
- **Wait for index build to finish** before smoke test.
- **Manual smoke on `dev.intexuraos.cloud/#/llm-usage`:**
  1. Page loads, "Loading…" clears, events appear (Issue 1).
  2. Toggle provider filter → single request, no loop (Issue 2).
  3. "Oldest first" → results reverse, no index error (Issue 5).
  4. "Most expensive" / "Most tokens" buttons are gone (Issue 3).
  5. Click "Custom" preset → no request fires until both dates are set (Issue 4).
  6. Pick custom dates → request fires, events load.

## Non-Goals / Follow-Ups

- **Does not** implement cost/token sorting — filed as follow-up (proper architecture via aggregate collections or in-memory sort with honest UX labelling).
- **Does not** add filter-combo ASC indexes — added reactively if real queries need them.
- **Does not** change `resolveTimeRange` semantics — caller-side `useMemo` is enough.
- **Does not** bump `PromptBuilder` versions (zero prompts in `llm-usage-service`).
