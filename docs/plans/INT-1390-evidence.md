# INT-1390 Evidence

## Task Summary
Enable tracking and display of LLM prompt type for each call.

## Plan Outcome
- **Decision**: PLAN-DOC (no subtasks)
- **Reasoning**: Task spans backend (llm-factory, llm-pricing, infra-gemini, infra-openrouter, llm-usage-service) and frontend (web UI), requiring data schema changes, service modifications, and UI updates. Multiple implementation steps across service boundaries.

## Artifacts
- Plan document: `docs/plans/INT-1390-llm-prompt-type-tracking.md`

## Key Decisions
1. Add `promptType?: string` to `LlmGenerateClient.generate()` options
2. Propagate through `UsageLogParams` → `buildUsageEvent` → Firestore `UsageEvent`
3. Display in web UI events table and detail view
4. Use `PromptBuilder.name` as the promptType value (e.g., `linearIssueTitlePrompt.name`)

## Timestamp
2026-04-16T14:33:00Z