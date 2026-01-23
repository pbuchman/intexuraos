# Task 0-0: Shared Configuration & Prompts

**Tier:** 0 (Setup)
**Context:** Need to prepare the database schema and LLM prompts before implementing logic.

## Problem Statement

The system needs to store failed calendar events and have specific prompts to classify and extract calendar data from natural language.

## Scope

- `firestore-collections.json`
- `packages/llm-common`

## Steps

1. [ ] Add `calendar_failed_events` to `firestore-collections.json`.
   - Owner: `calendar-agent`
   - Description: "Failed calendar event extractions for manual review"
2. [ ] Update `packages/llm-common/src/classification/commandClassifierPrompt.ts`.
   - Update instructions to prioritize `calendar` category for time-based requests.
   - Add examples (English/Polish) for calendar events.
3. [ ] Create `packages/llm-common/src/classification/calendarActionExtractionPrompt.ts`.
   - Define input interface: `text`, `currentDate`.
   - Define output schema: `summary`, `start`, `end`, `location`, `description`.
   - Prompt logic: Extract JSON, handle relative dates.
4. [ ] Export new prompt in `packages/llm-common/src/index.ts`.
5. [ ] Verify build of `llm-common`.

## Verification

```bash
pnpm --filter @intexuraos/llm-common build
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
