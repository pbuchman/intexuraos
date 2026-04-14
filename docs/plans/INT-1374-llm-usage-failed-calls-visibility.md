# LLM Usage: Failed Call Visibility & Zero-Token Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make failed LLM API calls visually distinguishable from successful ones in the LLM usage table, so users understand why some entries show 0 tokens and $0.0000 cost.

**Architecture:** The fix is frontend-only in `apps/web`. The usage event data already contains `request.success` (boolean) and `error` (object with code/message) fields -- the detail view page (`LlmUsageViewPage.tsx`) already renders a success/failed badge. The list table (`LlmUsagePage.tsx`) simply doesn't surface this information. We add a visual status indicator to the list table rows.

**Tech Stack:** React, TypeScript, TailwindCSS

---

## Root Cause Analysis

**What the user observed:** Pairs of events at the same timestamp -- one with 0 tokens/$0.0000 and one with real token counts. All from `google/gemma-4-31b-it:free` via OpenRouter.

**What's actually happening:** Production logs confirm the 0-token events are **failed API calls** (`"success": false`). The OpenRouter client in `packages/infra-openrouter/src/client.ts` (lines 218-225, 302-314, 333-343) logs `emptyUsage` (0 tokens, $0 cost) for every failed request before returning the error. These failed events are correctly stored in Firestore with `request.success: false` and an `error` object.

**Why the UI is misleading:** The list table in `LlmUsagePage.tsx` (lines 360-408) displays 8 columns (Time, Owner, Provider, Model, Component, Service, Tokens, Cost) but does NOT show the `request.success` field. A failed call with 0 tokens looks identical to a successful call with 0 tokens. The detail view (`LlmUsageViewPage.tsx`, lines 72-79) already shows a green/red success badge -- this pattern just needs to be applied to the list table.

**Why cost is $0.0000 even for successful calls:** The model `google/gemma-4-31b-it:free` has pricing `promptPerToken: '0'` and `completionPerToken: '0'` in `packages/infra-openrouter/src/defaultAllowlist.ts`. This is correct -- it's a free model. The provider also reports `cost: 0` in the response. The $0.0000 display for successful calls is accurate.

---

## File Structure

| Action   | File                                  | Responsibility                              |
| -------- | ------------------------------------- | ------------------------------------------- |
| Modify   | `apps/web/src/pages/LlmUsagePage.tsx` | Add status indicator column to events table |

---

### Task 1: Add Success/Failed Status Indicator to LLM Usage Events Table

**Files:**
- Modify: `apps/web/src/pages/LlmUsagePage.tsx:360-408`

- [ ] **Step 1: Add a Status column header to the events table**

In `LlmUsagePage.tsx`, locate the `<thead>` section (around line 363) and add a "Status" column header after the "Time" column:

```tsx
<tr className="border-b border-slate-200 dark:border-slate-700">
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Time</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Status</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Owner</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Provider</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Model</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Component</th>
  <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Service</th>
  <th className="py-2 pr-4 text-right font-medium text-slate-500 dark:text-slate-400">Tokens</th>
  <th className="py-2 text-right font-medium text-slate-500 dark:text-slate-400">Cost</th>
</tr>
```

- [ ] **Step 2: Add the Status cell to each table row**

In the `<tbody>` section (around line 376), add a status cell after the Time cell. Use the same badge pattern already used in `LlmUsageViewPage.tsx` (lines 72-78):

```tsx
{events.map((event) => (
  <tr key={event.eventId} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50">
    <td className="py-2.5 pr-4">
      <Link to={`/llm-usage/${event.eventId}`} className="text-blue-600 hover:underline dark:text-blue-400" title={formatDateTime(event.occurredAt)}>
        {formatRelative(event.occurredAt)}
      </Link>
    </td>
    <td className="py-2.5 pr-4">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        event.request.success
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      }`}>
        {event.request.success ? 'OK' : 'Fail'}
      </span>
    </td>
    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.owner.id}</td>
    <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">{event.request.provider}</td>
    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.request.model}</td>
    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.source.component}</td>
    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.source.service}</td>
    <td className="py-2.5 pr-4 text-right font-mono text-slate-700 dark:text-slate-300">{formatTokens(event.usage.totalTokens)}</td>
    <td className="py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">{formatCost(event.cost.billedUsd)}</td>
  </tr>
))}
```

- [ ] **Step 3: Verify the change visually**

Run: `cd /repo && pnpm --filter web dev`

Expected: The LLM Usage page now shows a "Status" column with green "OK" badges for successful calls and red "Fail" badges for failed calls. The 0-token entries will now clearly show as "Fail", making it obvious they are error responses, not mysteriously silent calls.

- [ ] **Step 4: Run CI**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All checks pass. The web app has no enforced test coverage, so no new tests are required for this UI change.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LlmUsagePage.tsx
git commit -m "feat(web): add success/failure status column to LLM usage events table

Failed API calls (0 tokens, $0 cost) were indistinguishable from
successful ones. Add a Status column with OK/Fail badges matching
the pattern already used in the detail view page."
```

---

## What This Does NOT Change

- **Backend behavior:** Failed calls are correctly logged with `success: false` and error details. No backend changes needed.
- **Cost calculation:** $0.0000 is correct for free models (`google/gemma-4-31b-it:free`). No pricing changes needed.
- **Token tracking:** 0 tokens for failed calls is correct -- the API returned an error, no tokens were consumed. No tracking changes needed.
- **Aggregate queries:** Failed calls are already included in aggregates. Filtering them out could be a future enhancement but is not part of this task.
