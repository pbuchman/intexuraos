# 2-2 Web UI

## Tier

2 (Dependent)

## Context

Add Inbox page to web app showing commands and actions.

## Problem

Need UI to view incoming commands and their classifications.

## Scope

- Add /#/inbox route
- InboxPage with tabs (Commands, Actions)
- CommandsPage - list commands
- ActionsPage - list actions
- API client for commands-router

## Non-Scope

- Command/action details view
- Filtering/search
- Pagination

## Approach

1. Create API client service
2. Create InboxPage with tab navigation
3. Create CommandsPage with table
4. Create ActionsPage with table
5. Add route to App.tsx
6. Add navigation link

## Files to Create

- `apps/web/src/services/commandsApi.ts`
- `apps/web/src/pages/InboxPage.tsx`
- `apps/web/src/pages/CommandsPage.tsx`
- `apps/web/src/pages/ActionsPage.tsx`

## Files to Modify

- `apps/web/src/App.tsx`
- `apps/web/src/components/Navigation.tsx` (if exists)

## UI Design

- Simple table layout
- Show: timestamp, source, text (truncated), status
- Actions: type, confidence, status

## Checklist

- [ ] API client created
- [ ] InboxPage with tabs
- [ ] CommandsPage table
- [ ] ActionsPage table
- [ ] Route added
- [ ] Navigation link added

## Definition of Done

Web app shows Inbox page with commands and actions lists.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/web
npm run build --workspace=@intexuraos/web
```

## Rollback

Delete new pages, revert App.tsx.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
