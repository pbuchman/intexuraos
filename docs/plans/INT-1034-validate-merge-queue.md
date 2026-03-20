# Validate Merge Queue Architecture, UI, and Theme Compliance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform a comprehensive review of the merge queue (auto-PR merge) feature across three dimensions: architectural design review, UI navigation verification, and theme/responsive compliance — then produce actionable findings as Linear comments.

**Architecture:** The merge queue feature exists as design specs and implementation plans only (`docs/superpowers/specs/2026-03-19-merge-queue-design.md`, `docs/superpowers/plans/2026-03-19-merge-queue-backend.md`, `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md`). No implementation code has been written yet. The review evaluates the design artifacts against existing codebase patterns (code-agent backend + web frontend).

**Tech Stack:** TypeScript, Fastify, Firestore, React 18, TailwindCSS, lucide-react.

---

## Endpoint Changes

### Created
None (this is a review task, not an implementation task).

### Modified
None.

### Removed
None.

### Unchanged
All existing endpoints.

---

## Key Finding: Implementation Status

The merge queue feature has **not been implemented**. The codebase contains:

- **Design spec:** `docs/superpowers/specs/2026-03-19-merge-queue-design.md` (complete)
- **Backend plan:** `docs/superpowers/plans/2026-03-19-merge-queue-backend.md` (11 tasks)
- **Frontend plan:** `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md` (9 tasks)

But zero implementation files exist:
- No `MergeQueuePage.tsx` in `apps/web/src/pages/`
- No `merge-queue/` components in `apps/web/src/components/`
- No merge queue routes, use cases, or repositories in `apps/code-agent/src/`
- No `merge-queue` entry in the sidebar `codeTasksItems` array
- No `/#/merge-queue` route in `App.tsx`

This means the sidebar link does **not** exist, and there is no UI to review for theme/responsive compliance. The review must therefore evaluate the **planned design tokens and patterns** against existing codebase conventions.

---

## Task 1: Backend Architecture Review

**Scope:** Review the backend design spec and implementation plan for architectural soundness, security, performance, and compliance with code-agent patterns.

**Files to review:**
- `docs/superpowers/specs/2026-03-19-merge-queue-design.md`
- `docs/superpowers/plans/2026-03-19-merge-queue-backend.md`
- `apps/code-agent/src/services.ts` (existing DI pattern)
- `apps/code-agent/src/domain/ports/gitHubPRClient.ts` (existing port interface)
- `apps/code-agent/src/routes/webhooks/github.ts` (ALLOWED_BOTS reference)
- `firestore-collections.json` (existing collection registry)

- [ ] **Step 1: Review domain model design**

Evaluate `MergeQueueWatch` interface for:
- Field completeness (does it capture all state needed for the tick loop?)
- Timestamp handling (Firestore `Timestamp` vs ISO strings)
- Status machine validity (`active` -> `drained`/`cancelled` transitions)
- Whether `gitHubUsername` resolution at creation time is the right trade-off vs. per-tick resolution

- [ ] **Step 2: Review tick use case logic**

Evaluate the tick algorithm in the spec for:
- Race conditions: concurrent ticks from Cloud Scheduler overlap
- Idempotency: 405 handling for already-merged PRs
- Author filtering: `ALLOWED_BOTS` import from webhooks route (tight coupling?)
- Drain logic: edge case where non-eligible PRs exist but zero eligible PRs
- Error isolation: one watch failure shouldn't abort processing of other watches
- Token resolution per-watch (fan-out concern with many active watches)

- [ ] **Step 3: Review endpoint design**

Evaluate the 6 new endpoints for:
- Auth model consistency (`/internal/` = HMAC, `/code/` = JWT — matches existing pattern?)
- Request validation (missing schema validation for POST body?)
- Error response codes (409 for duplicate watch, 403 for non-owner cancel — correct?)
- Query parameter design for GET endpoints
- Missing pagination on `GET /code/merge-queue/watches` and `GET /code/merge-queue/prs`

- [ ] **Step 4: Review Firestore design**

Evaluate the collection and query patterns for:
- Composite index requirement for `findActiveByUserAndBranch` (5-field compound query)
- `arrayUnion` for `mergedPrs` — unbounded array growth concern
- Missing TTL/cleanup for drained/cancelled watches
- Collection ownership in `firestore-collections.json`

- [ ] **Step 5: Review security considerations**

Evaluate for:
- Token scope: user's GitHub OAuth token used for merge operations — does the OAuth scope include `repo` write access?
- Push access verification before watch creation
- No rate limiting on watch creation endpoint
- Internal auth on tick endpoint (matches existing `/internal/` pattern)

- [ ] **Step 6: Document findings**

Create a structured findings document with severity levels (Critical / Warning / Info) and recommended actions.

---

## Task 2: Frontend Architecture & UI Navigation Review

**Scope:** Review the frontend implementation plan for component design, navigation integration, and compliance with existing web app patterns.

**Files to review:**
- `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md`
- `apps/web/src/components/Sidebar.tsx` (existing sidebar structure — lines 73-78 for `codeTasksItems`)
- `apps/web/src/App.tsx` (existing route registration pattern)
- `apps/web/src/pages/CodeTasksPage.tsx` (reference page for patterns)
- `apps/web/src/components/code-tasks/IssueGroupRow.tsx` (card row pattern)
- `apps/web/src/components/code-tasks/IssueTimeline.tsx` (timeline pattern)

- [ ] **Step 1: Verify sidebar link status**

Confirm that no merge queue entry exists in:
1. `codeTasksItems` array in `Sidebar.tsx` (lines 73-78)
2. Any other sidebar section
3. Route table in `App.tsx`

Document finding: **Merge Queue is NOT in the left menu sidebar.** The planned placement is inside `codeTasksItems` as `{ to: '/merge-queue', label: 'Merge Queue', icon: GitMerge }`.

- [ ] **Step 2: Review navigation design decision**

Evaluate whether merge queue should be:
- A sub-item under Code Tasks (as planned) — groups it with related developer tools
- A top-level sidebar item — gives it more visibility as a distinct feature
- Under a new "GitHub" or "Automation" section

Consider: merge queue is conceptually a GitHub automation, not a "code task". Placing it under Code Tasks may confuse users who associate that section with AI-driven code generation tasks.

- [ ] **Step 3: Review component decomposition**

Evaluate the 8 planned components for:
- SRP compliance (~150 lines per component per CLAUDE.md guidelines)
- Prop drilling vs. context usage
- Component reuse from existing code-tasks components vs. new components
- Missing components (error boundary? loading skeleton?)

- [ ] **Step 4: Review data flow and polling**

Evaluate:
- 30s watch polling + 60s PR polling — appropriate intervals?
- `document.visibilityState` for pause — correct pattern
- Missing: WebSocket/SSE for real-time updates (is polling acceptable?)
- Missing: optimistic UI updates for toggle (toggle → immediate visual → API call)
- Error recovery: what happens when a poll fails mid-session?

- [ ] **Step 5: Review hardcoded owner/repo concern**

The plan hardcodes `DEFAULT_OWNER = 'pbuchman'` and `DEFAULT_REPO = 'intexuraos'`. Evaluate:
- Is this acceptable for MVP?
- What's the migration path to multi-repo support?
- Should the repo selector be a requirement before shipping?

- [ ] **Step 6: Document findings**

Create structured findings with severity levels.

---

## Task 3: Theme Compliance Review (Light & Dark Mode)

**Scope:** Review all planned CSS classes and design tokens in the frontend plan against existing theme patterns to ensure full light/dark mode compliance.

**Files to review:**
- `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md` (all Tailwind classes in the plan)
- `apps/web/src/pages/CodeTasksPage.tsx` (reference theme patterns — `GROUP_STATUS_CONFIG`, `INACTIVE_SEGMENT_CLASS`)
- `apps/web/src/components/code-tasks/IssueGroupRow.tsx` (card row dark mode classes)
- `apps/web/src/components/code-tasks/IssueTimeline.tsx` (timeline dark mode classes)
- `apps/web/src/components/Sidebar.tsx` (sidebar dark mode pattern)

- [ ] **Step 1: Audit WatchStatusCard dark mode tokens**

Review the 4 watch states for dark: variant completeness:

| State    | Light classes                      | Dark classes needed                              |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Active   | `border-blue-200 bg-blue-50`       | `dark:border-blue-800 dark:bg-blue-900/30`       |
| Error    | `border-red-200 bg-red-50`         | `dark:border-red-800 dark:bg-red-900/30`         |
| Drained  | `border-emerald-200 bg-emerald-50` | `dark:border-emerald-800 dark:bg-emerald-900/30` |
| Inactive | (no card)                          | (no card)                                        |

Verify text colors also have dark variants. Check that the spec includes dark text for stats line, error message, and timestamp.

- [ ] **Step 2: Audit PrRow dark mode tokens**

Review card row classes against existing IssueGroupRow pattern:
- Light: `border-slate-200 bg-white` → Dark: needs `dark:border-slate-700 dark:bg-slate-800` (matches IssueGroupRow)
- Accent shadows use `theme()` function — verify dark mode doesn't cause contrast issues with dark backgrounds
- Badge colors (`rounded-full px-2.5 py-1`) — verify text readability on dark backgrounds
- Non-eligible opacity (`opacity-50`) — verify sufficient contrast in dark mode

- [ ] **Step 3: Audit BranchSelector dark mode tokens**

Review branch pill classes against existing StatusPipeline:
- Active: plan specifies `dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400` — matches `GROUP_STATUS_CONFIG.active.activeClass` pattern
- Inactive: plan specifies `dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400` — matches `INACTIVE_SEGMENT_CLASS` pattern
- Verify dot colors don't need dark variants (dots are typically static)

- [ ] **Step 4: Audit PrStatusPipeline dark mode tokens**

Review the 3 filter pill states:
- Mergeable: `dark:border-green-400 dark:bg-green-900/30 dark:text-green-400`
- Pending: `dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400`
- Blocked: `dark:border-red-400 dark:bg-red-900/30 dark:text-red-400`

Cross-reference with `GROUP_STATUS_CONFIG` patterns in CodeTasksPage to verify consistency.

- [ ] **Step 5: Audit MergeHistoryTimeline dark mode tokens**

Review against existing `IssueTimeline.tsx` (line 281):
- Container: `border-t border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/50` — matches
- Timeline line: `border-l-2 border-slate-300 dark:border-zinc-700` — matches
- Dot: `bg-emerald-500` — static, no dark variant needed
- Text: verify PR title, timestamp, and author text have dark variants

- [ ] **Step 6: Audit page-level dark mode**

Review MergeQueuePage for:
- Page background: inherits from Layout component — verify
- Section headings: `text-2xl font-bold` — needs `dark:text-slate-100` (or `dark:text-white`)
- Subtitle text: `text-slate-500` → `dark:text-slate-400`
- Empty state messages: verify dark text colors
- Loading spinner: verify contrast on dark background

- [ ] **Step 7: Identify missing dark mode patterns**

Cross-check ALL Tailwind classes in the frontend plan for missing `dark:` variants. Flag any class that sets a color without a corresponding dark variant as a potential issue.

- [ ] **Step 8: Document theme findings**

Create a compliance matrix: component × theme state (light/dark) × pass/fail with specific remediation for each gap.

---

## Task 4: Mobile / Responsive Design Review

**Scope:** Review all planned responsive breakpoints and mobile layouts against existing patterns.

**Files to review:**
- `docs/superpowers/plans/2026-03-19-merge-queue-frontend.md` (responsive classes)
- `apps/web/src/pages/CodeTasksPage.tsx` (existing responsive patterns)
- `apps/web/src/components/code-tasks/IssueGroupRow.tsx` (desktop/mobile card layout)
- `apps/web/src/components/Sidebar.tsx` (mobile sidebar behavior)

- [ ] **Step 1: Audit PR row responsive layout**

Review the planned PrRow responsive approach:
- Desktop: `hidden lg:grid grid-cols-[60px_1fr_120px_100px_100px]` — 5 columns
- Mobile: `flex flex-col gap-2 lg:hidden` — stacked layout

Verify:
- Column header hides on mobile (`hidden lg:grid`) — matches CodeTasksPage
- Mobile card shows all essential info (PR#, title, status, checks) in stacked format
- Touch targets are large enough (minimum 44px per Apple HIG)
- Accent shadow renders correctly in stacked layout

- [ ] **Step 2: Audit BranchSelector mobile behavior**

Review:
- Branch pills should wrap on narrow screens — verify `flex flex-wrap gap-2` is specified
- Pills should not overflow horizontally
- Touch targets for pills (min 44px height with padding)

- [ ] **Step 3: Audit WatchStatusCard mobile layout**

Review:
- Toggle switch position on narrow screens — should it stack below the label?
- Stats line wrapping on narrow screens
- Error message truncation on small viewports

- [ ] **Step 4: Audit PrStatusPipeline mobile behavior**

Review:
- Filter pills should wrap (`flex flex-wrap gap-2`)
- On very narrow screens (320px), 3 pills may not fit on one line — verify wrapping behavior

- [ ] **Step 5: Audit page-level mobile layout**

Review:
- PageHeader: title and repo selector — stacking on mobile?
- Spacing between sections on mobile vs. desktop
- Scroll behavior: page should scroll naturally, no horizontal overflow
- Sidebar integration: `/#/merge-queue` route must work with mobile slide-out sidebar

- [ ] **Step 6: Identify missing responsive patterns**

Cross-check ALL layout classes in the frontend plan for:
- Missing `flex-wrap` on horizontally-arranged elements
- Fixed pixel widths that could cause overflow
- Missing `min-w-0` for text truncation in flex children
- Missing `overflow-hidden` or `text-ellipsis` for long PR titles

- [ ] **Step 7: Document mobile/responsive findings**

Create a compliance checklist: component × viewport size (320px / 375px / 768px / 1024px+) × pass/fail.

---

## Task 5: Aggregate Findings and Report

**Scope:** Combine all review findings into a single structured report posted as a Linear comment on INT-1034.

- [ ] **Step 1: Compile findings from Tasks 1-4**

Merge all findings documents. Categorize each finding:
- **Critical** — blocks implementation (must fix in design before coding)
- **Warning** — should fix during implementation (design improvement)
- **Info** — minor observation, acceptable as-is

- [ ] **Step 2: Create summary table**

| #   | Area     | Severity   | Finding   | Recommendation   |
| --- | -------- | ---------- | --------- | ---------------- |
| 1   | Backend  | ...        | ...       | ...              |
| 2   | Frontend | ...        | ...       | ...              |
| ... | ...      | ...        | ...       | ...              |

- [ ] **Step 3: Post findings as Linear comment on INT-1034**

Post the compiled report as a comment on the issue.

- [ ] **Step 4: Update issue description with outcome**

Update INT-1034 description to reflect the review outcome, linking to the plan document.
