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

- Done:
- Now: 0-0-shared-config-prompts.md
- Next: 1-0-actions-agent-dispatcher.md
  Open questions:
  Working set:

## Log

### [2026-01-14] Initialization

- Created continuity task `036-natural-language-calendar`.
- Defined subtasks based on approved plan.
- Initialized ledger.
