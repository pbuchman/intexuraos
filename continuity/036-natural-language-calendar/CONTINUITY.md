# Continuity Ledger

Goal: Implement Natural Language Calendar Event Creation flow (Command -> Action -> Calendar Agent -> Google/Draft).
Success Criteria:

- Users can create calendar events via text (WhatsApp).
- Events are correctly classified as 'calendar'.
- Events are extracted and validated by Calendar Agent.
- Valid events are created in Google Calendar.
- Invalid events are saved as drafts in `calendar_failed_events`.
- Frontend displays both valid and failed events.
- Unit tests pass and coverage is maintained.

Constraints / Assumptions:

- 'whatsapp-service' is already covered.
- 'actions-agent' calls 'calendar-agent' synchronously (60s timeout).
- We support Polish and English.
- "33 of them" in requirements interpreted as showing top 3 failed events with expand option.

State:

- Done: 0-0-shared-config-prompts.md, 1-0-actions-agent-dispatcher.md
- Now: 1-1-calendar-agent-worker.md
- Next: 1-2-frontend-implementation.md
  Open questions:
  Working set:

## Log

### [2026-01-14] Initialization

- Created continuity task `036-natural-language-calendar`.
- Defined subtasks based on approved plan.
- Initialized ledger.

### [2026-01-14] Task 0-0: Shared Configuration & Prompts

**Completed:**
1. Added `calendar_failed_events` collection to `firestore-collections.json` (owner: calendar-agent)
2. Updated `commandClassifierPrompt.ts`:
   - Moved `calendar` to priority #1 (above todo)
   - Added comprehensive calendar detection rules
   - Added English/Polish examples for calendar vs reminder distinction
3. Created `calendarActionExtractionPrompt.ts`:
   - Input interface: `text`, `currentDate`
   - Output schema: `summary`, `start`, `end`, `location`, `description`, `valid`, `error`, `reasoning`
   - Supports relative date parsing (today, tomorrow, in X days, next Monday)
   - Supports English and Polish time expressions
   - Default time: 09:00 if not specified
   - Default duration: 1 hour if end time not specified
4. Exported new prompt in `classification/index.ts` and main `index.ts`
5. Verified typecheck passes

### [2026-01-14] Task 1-0: Actions Agent (Dispatcher)

**Completed:**
1. Created `src/domain/ports/calendarServiceClient.ts` - port interface for calendar service
2. Created `src/infra/http/calendarServiceHttpClient.ts` - HTTP client with 60s timeout
3. Created `src/domain/usecases/executeCalendarAction.ts` - use case for executing calendar actions
4. Created `src/domain/usecases/handleCalendarAction.ts` - use case for handling calendar actions
5. Updated `actionHandlerRegistry.ts` - added `calendar` to registry
6. Updated `services.ts`:
   - Added `CalendarServiceClient` to imports
   - Added `calendarAgentUrl` to `ServiceConfig`
   - Initialized `calendarServiceClient` and use cases
   - Added `calendar` to container registry
7. Created `src/__tests__/executeCalendarAction.test.ts` - 11 tests covering:
   - Error when action not found
   - Idempotency (already completed action)
   - Invalid status handling
   - Successful calendar event processing
   - Failed calendar service response handling
   - Retry from failed status
   - WhatsApp notification publishing
   - Best-effort notification (non-fatal failures)
   - Correct parameter passing
   - No notification when resource_url missing
8. Updated `src/__tests__/fakes.ts` - added `FakeCalendarServiceClient`
9. Fixed test in `routes.test.ts` - changed from `calendar` to `reminder` for no-handler test

**All tests pass:** 318 tests (including 11 new calendar tests)
