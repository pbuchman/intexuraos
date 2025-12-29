# 7-2: Research List Page

**Tier:** 7 - Frontend - Orchestrator UI
**Status:** Pending

## Context

Create ResearchListPage for viewing previous researches.

## Problem Statement

Users need a UI to view their previous research requests.

## Scope

**In Scope:**
- Paginated list (50 items)
- Each row: title, LLM badges, status, timestamps
- Click to view detail
- Delete button
- Sort by date (newest first)

**Out of Scope:**
- Research detail view (7-3)

## Required Approach

1. Follow existing list patterns
2. "Load More" pagination
3. Status badges with colors

## Step Checklist

- [ ] Create `apps/web/src/pages/ResearchListPage.tsx`
- [ ] Fetch researches on load
- [ ] Render list with title, badges, status, time
- [ ] Status display: "Pending (1/3)", "Completed", "Failed"
- [ ] Click row to navigate to detail
- [ ] Delete button per row
- [ ] "Load More" button for pagination
- [ ] Empty state message
- [ ] Add route in App.tsx

## Definition of Done

- [ ] List renders correctly
- [ ] Pagination works
- [ ] Delete works
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Delete page file and revert App.tsx.
