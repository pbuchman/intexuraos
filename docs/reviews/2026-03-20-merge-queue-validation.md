# Merge Queue Architecture, UI, and Theme Compliance Review

**Date:** 2026-03-20
**Reviewer:** Automated (INT-1034)
**Status:** Complete
**Scope:** Design spec + implementation plans (no implementation code exists yet)

## Executive Summary

The merge queue feature exists as design specifications and implementation plans only. No implementation code has been written. This review evaluates the planned architecture, UI design, theme compliance, and responsive behavior against existing codebase patterns.

**Key finding:** The sidebar link does NOT exist. No `MergeQueuePage`, no route in `App.tsx`, no entry in `codeTasksItems`. The merge queue is not visible in the left menu.

**Overall assessment:** The design is architecturally sound and follows established patterns with minor issues to address before implementation.

---

## Reviewed Artifacts

| Artifact      | Location                                                    |
| ------------- | ----------------------------------------------------------- |
| Design spec   | `docs/superpowers/specs/2026-03-19-merge-queue-design.md`   |
| Backend plan  | `docs/superpowers/plans/2026-03-19-merge-queue-backend.md`  |
| Frontend plan | `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md` |

---

## Findings Summary

| #   | Area     | Severity   | Finding                                                                                                                          | Recommendation                                                                                                                                                                       |
| --- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Backend  | Warning    | Migration path incorrect: plan says `apps/code-agent/migrations/` but all Firestore index migrations live in `/repo/migrations/` | Fix plan to reference `/repo/migrations/` (e.g., `migrations/064_merge-queue-watches-composite-index.mjs`)                                                                           |
| 2   | Backend  | Info       | `mergedPrs` array uses `FieldValue.arrayUnion()` which prevents duplicates but can grow unbounded over time                      | Add TTL/cleanup strategy for old drained/cancelled watches or cap array size                                                                                                         |
| 3   | Backend  | Info       | No rate limiting on watch creation endpoint `POST /code/merge-queue/watch`                                                       | Acceptable for single-user MVP; add rate limiting before multi-user deployment                                                                                                       |
| 4   | Backend  | Info       | Concurrent tick overlap mitigated by idempotent merge (405 handling) and atomic arrayUnion                                       | Design is sound; no additional transaction needed                                                                                                                                    |
| 5   | Backend  | Info       | Token resolution happens per-watch per-tick. With many active watches, this fans out to many `userServiceClient` calls           | Acceptable at current scale; consider caching tokens per-user if watch count grows                                                                                                   |
| 6   | Backend  | Info       | `ALLOWED_BOTS` imported from webhooks route creates coupling between tick logic and webhook module                               | Acceptable trade-off; extracting to shared constants is optional refactor                                                                                                            |
| 7   | Frontend | Warning    | Sidebar link NOT present. No merge queue entry exists in `codeTasksItems` array                                                  | Must be added during implementation as planned                                                                                                                                       |
| 8   | Frontend | Info       | Hardcoded `DEFAULT_OWNER = 'pbuchman'` and `DEFAULT_REPO = 'intexuraos'` limits multi-user support                               | Acceptable for MVP; add repo selector before multi-user deployment                                                                                                                   |
| 9   | Frontend | Info       | Polling intervals (30s watches, 60s PRs) are reasonable; `document.visibilityState` pause is correct                             | No change needed                                                                                                                                                                     |
| 10  | Frontend | Info       | Navigation design: merge queue placed under Code Tasks section. Conceptually it's GitHub automation, not a code task             | Acceptable grouping for developer tools section; could be reconsidered later                                                                                                         |
| 11  | Theme    | Info       | All planned Tailwind classes include `dark:` variants                                                                            | Theme compliance is complete in the design                                                                                                                                           |
| 12  | Theme    | Info       | WatchStatusCard: 4 states (active/error/drained/inactive) all have complete dark mode tokens                                     | Verified against existing patterns                                                                                                                                                   |
| 13  | Theme    | Info       | PrRow card classes match `IssueGroupRow` pattern exactly: `dark:border-slate-700 dark:bg-slate-800`                              | Consistent with codebase                                                                                                                                                             |
| 14  | Theme    | Info       | BranchSelector active/inactive classes match `GROUP_STATUS_CONFIG` and `INACTIVE_SEGMENT_CLASS` patterns                         | Consistent with codebase                                                                                                                                                             |
| 15  | Theme    | Info       | PrStatusPipeline filter pills follow `StatusPipeline` pattern with proper dark variants                                          | Consistent with codebase                                                                                                                                                             |
| 16  | Theme    | Info       | MergeHistoryTimeline matches `IssueTimeline` dark mode pattern: `dark:border-zinc-700 dark:bg-zinc-900/50`                       | Note: IssueTimeline uses `zinc-*` while most other components use `slate-*` for dark borders. Minor inconsistency exists in the EXISTING codebase, and the plan correctly mirrors it |
| 17  | Mobile   | Info       | PR row responsive layout: `hidden lg:grid` + `flex flex-col gap-2 lg:hidden` matches existing pattern                            | Consistent with `IssueGroupRow`                                                                                                                                                      |
| 18  | Mobile   | Info       | BranchSelector uses `flex flex-wrap gap-2` for pill wrapping on narrow screens                                                   | Correct pattern                                                                                                                                                                      |
| 19  | Mobile   | Info       | PrStatusPipeline uses `flex flex-wrap gap-2` matching `StatusPipeline` pattern                                                   | Correct pattern                                                                                                                                                                      |
| 20  | Mobile   | Warning    | WatchStatusCard toggle position on narrow screens not explicitly specified; should stack below label on mobile                   | Add explicit mobile layout for toggle positioning                                                                                                                                    |
| 21  | Mobile   | Info       | No fixed pixel widths that would cause horizontal overflow                                                                       | Design is responsive-safe                                                                                                                                                            |
| 22  | Mobile   | Info       | Long PR titles may need `min-w-0` + `text-ellipsis` + `overflow-hidden` in flex children                                         | Add truncation classes to PR title column during implementation                                                                                                                      |

---

## Detailed Analysis

### 1. Backend Architecture Review

#### Domain Model (MergeQueueWatch)
- **Field completeness:** All necessary state for the tick loop is captured (userId, gitHubUsername, owner, repo, baseBranch, status, mergedPrs, skippedPrs, lastError, timestamps)
- **Timestamp handling:** Uses Firestore `Timestamp` type consistently, matching existing patterns
- **State machine:** `active` -> `drained` (auto) and `active` -> `cancelled` (manual) transitions are well-defined. No backward transitions, which is correct
- **GitHub username resolution:** Resolved at creation time and stored on the watch document. This is the correct trade-off: avoids per-tick GitHub API calls for username lookup. The username is stable for the lifetime of a watch

#### Tick Use Case Logic
- **Race conditions:** Mitigated by idempotent merge API (405 = already merged treated as success) and atomic `FieldValue.arrayUnion()` for mergedPrs
- **Author filtering:** ALLOWED_BOTS set is a simple import from webhooks. The coupling is acceptable since both modules share the same definition of "bot accounts"
- **Drain logic:** Correctly differentiates between "no eligible PRs" (drain) and "eligible PRs exist but none mergeable" (skipped_all). Non-eligible-author PRs are excluded from drain calculation
- **Error isolation:** Each watch is processed independently. One watch failure does not abort other watches
- **One merge per tick per watch:** Prevents cascading merges that could cause conflicts

#### Endpoint Design
- **Auth model:** `/internal/` = HMAC, `/code/` = JWT. Matches existing patterns exactly
- **Missing pagination:** `GET /code/merge-queue/watches` and `GET /code/merge-queue/prs` lack pagination. Acceptable for MVP (a user will have few watches, and PR counts are bounded by GitHub's 100 per page)
- **Error codes:** 409 for duplicate watch, 403 for non-owner cancel. Standard REST semantics

#### Firestore Design
- **Composite index:** Required for `findActiveByUserAndBranch` (5-field query). Migration path is incorrect in plan (see Finding #1)
- **Collection ownership:** Correctly assigned to code-agent in firestore-collections.json

#### Security
- **OAuth scope:** User's GitHub token must have `repo` write access for merge operations. Push access verification at watch creation time is a good safeguard
- **Internal auth on tick:** Matches existing `/internal/` HMAC pattern

### 2. Frontend Architecture & UI Navigation Review

#### Sidebar Link Status: NOT PRESENT
- No merge queue entry in `codeTasksItems` array
- No `MergeQueuePage` component exists
- No `/#/merge-queue` route in `App.tsx`
- The planned placement is `{ to: '/merge-queue', label: 'Merge Queue', icon: GitMerge }` inside the Code Tasks section

#### Component Decomposition
- 8 planned components are well-scoped and follow SRP (~150 lines each)
- Component reuse from existing patterns: StatusPipeline, card row, timeline
- No prop drilling concerns; state is managed at the page level

#### Data Flow
- Polling approach is acceptable for MVP (30s/60s intervals with visibility API)
- Error recovery: failed polls should show a toast/banner but not break the UI
- Optimistic UI updates for toggle: toggling sets `isToggling` state immediately, API call follows

### 3. Theme Compliance (Light & Dark Mode)

All planned Tailwind classes have been audited against existing codebase patterns.

#### Compliance Matrix

| Component                    | Light Mode                                    | Dark Mode                                                        | Status                       |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| WatchStatusCard (Active)     | `border-blue-200 bg-blue-50`                  | `dark:border-blue-800 dark:bg-blue-900/30`                       | Pass                         |
| WatchStatusCard (Error)      | `border-red-200 bg-red-50`                    | `dark:border-red-800 dark:bg-red-900/30`                         | Pass                         |
| WatchStatusCard (Drained)    | `border-emerald-200 bg-emerald-50`            | `dark:border-emerald-800 dark:bg-emerald-900/30`                 | Pass                         |
| PrRow Card                   | `border-slate-200 bg-white`                   | `dark:border-slate-700 dark:bg-slate-800`                        | Pass                         |
| BranchSelector (Active)      | `border-blue-500 bg-blue-50 text-blue-700`    | `dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400`    | Pass                         |
| BranchSelector (Inactive)    | `border-slate-200 bg-white text-slate-600`    | `dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400`    | Pass                         |
| PrStatusPipeline (Mergeable) | `border-green-500 bg-green-50 text-green-700` | `dark:border-green-400 dark:bg-green-900/30 dark:text-green-400` | Pass                         |
| PrStatusPipeline (Pending)   | `border-amber-500 bg-amber-50 text-amber-700` | `dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400` | Pass                         |
| PrStatusPipeline (Blocked)   | `border-red-500 bg-red-50 text-red-700`       | `dark:border-red-400 dark:bg-red-900/30 dark:text-red-400`       | Pass                         |
| MergeHistoryTimeline         | `border-slate-200 bg-slate-50`                | `dark:border-zinc-700 dark:bg-zinc-900/50`                       | Pass (matches IssueTimeline) |
| Page heading                 | `text-slate-900`                              | `dark:text-slate-100`                                            | Pass                         |
| Subtitle text                | `text-slate-500`                              | `dark:text-slate-400`                                            | Pass                         |
| Accent shadows               | `theme(colors.green.500)` etc.                | No dark variant needed (colors work in both modes)               | Pass                         |

**Note:** `IssueTimeline` uses `zinc-*` for dark borders while most other components use `slate-*`. This is a pre-existing minor inconsistency in the codebase. The merge queue plan correctly mirrors the timeline pattern.

### 4. Mobile / Responsive Design Review

#### Compliance Checklist

| Component            | 320px           | 375px           | 768px        | 1024px+    | Notes                                  |
| -------------------- | --------------- | --------------- | ------------ | ---------- | -------------------------------------- |
| PrRow                | Stacked flex    | Stacked flex    | Stacked flex | 5-col grid | Pass                                   |
| BranchSelector       | Wraps           | Wraps           | Single row   | Single row | Pass (`flex-wrap gap-2`)               |
| PrStatusPipeline     | Wraps           | Wraps           | Single row   | Single row | Pass (`flex-wrap gap-2`)               |
| ColumnHeader         | Hidden          | Hidden          | Hidden       | Visible    | Pass (`hidden lg:grid`)                |
| WatchStatusCard      | Needs attention | Needs attention | OK           | OK         | Toggle position not explicit on mobile |
| MergeHistoryTimeline | Stacked         | Stacked         | OK           | OK         | Pass                                   |
| PageHeader           | Stacks          | Stacks          | Inline       | Inline     | Needs explicit mobile layout           |

**Potential issues to address during implementation:**
1. PR title truncation: add `min-w-0 overflow-hidden text-ellipsis` to the title flex child
2. WatchStatusCard: ensure toggle stacks below label on narrow viewports
3. No fixed pixel widths that would cause overflow (verified)

---

## Recommendations

### Before Implementation (Critical)
1. Fix migration path in backend plan: use `/repo/migrations/` not `apps/code-agent/migrations/`

### During Implementation (Warning)
2. Add explicit mobile layout for WatchStatusCard toggle positioning
3. Add text truncation utilities to PR title column in PrRow
4. Consider adding a brief loading skeleton for the PR list area

### Post-MVP (Info)
5. Add rate limiting on watch creation endpoint
6. Replace hardcoded owner/repo with dynamic repo selector
7. Add TTL/cleanup for drained/cancelled watch documents
8. Consider WebSocket/SSE for real-time updates instead of polling
