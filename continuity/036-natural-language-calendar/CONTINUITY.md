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

- Done: 0-0-shared-config-prompts.md
- Now: 1-0-actions-agent-dispatcher.md
- Next: 1-1-calendar-agent-worker.md
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
