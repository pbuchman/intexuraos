# Task 1-2: Frontend Implementation

**Tier:** 1 (Implementation)
**Context:** Users need to see failed events in the Calendar view.

## Problem Statement

Failed events are currently invisible to the user.

## Scope

- `apps/web`

## Steps

1. [ ] Update `src/services/calendarApi.ts`.
   - Add `listFailedEvents`.
2. [ ] Create `src/hooks/useFailedCalendarEvents.ts`.
   - Fetch logic.
3. [ ] Modify `src/pages/CalendarPage.tsx`.
   - Import hook.
   - Add "Needs Attention" section above the calendar.
   - Implement "Show 3 / Expand" logic.
   - Display failed events as compact cards.
4. [ ] Verify build.

## Verification

```bash
pnpm --filter web build
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
