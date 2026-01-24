# Task 1-1: Calendar Agent (Worker)

**Tier:** 1 (Implementation)
**Context:** The `calendar-agent` needs to receive raw text actions, extract event data via LLM, and either create a Google Event or save a draft.

## Problem Statement

`calendar-agent` lacks the capability to process natural language actions and handle failures gracefully.

## Scope

- `apps/calendar-agent`

## Steps

1. [ ] Create `src/infra/firestore/failedEventRepository.ts`.
   - Methods: `create`, `list`, `get`, `delete`.
2. [ ] Create `src/infra/gemini/calendarActionExtractionService.ts`.
   - Use `calendarActionExtractionPrompt`.
   - Call LLM.
   - Validate output using Zod (ISO dates, required fields).
3. [ ] Create `src/domain/useCases/processCalendarAction.ts`.
   - Logic: Extract -> Validate -> Create Event (Google) OR Save Failed (Firestore).
   - Return result to caller.
4. [ ] Create `src/routes/internalRoutes.ts`.
   - `POST /internal/calendar/process-action`.
5. [ ] Update `src/routes/calendarRoutes.ts`.
   - Add `GET /calendar/failed-events`.
6. [ ] Register new services and routes.
7. [ ] Add unit tests for extraction service and use case.

## Verification

```bash
pnpm --filter calendar-agent test
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
