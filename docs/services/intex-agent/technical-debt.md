# Intex Agent Technical Debt

## Current Scope Decisions

- Voice messages are intentionally unsupported until a new text-first product flow is designed.
- Explicit confirmation is implemented for supported mutations. General-purpose approval workflows remain outside the tool boundary.
- The tool set is deliberately small: notes, calendar creation/query/update, research drafts, bookmarks, code tasks, External Save, and itemized preferences.
- Calendar and personal-preference reads are supported. Note search, bookmark lookup, WhatsApp history lookup, and code-task inspection should remain unsupported until explicit read tools exist.
- Old duplicated command/action-agent behavior is intentionally removed. New supported actions should be added through the Intex Agent tool boundary, not through compatibility routes.

## Release Watch Points

- Keep confirmation replay, stale calendar snapshots, duration defaults, and partially successful multi-event updates covered.
- Keep preference optimistic concurrency and immutable versions separate from External Save configuration.
- Preserve strict mocked action execution and sanitized evidence in Test Runs and Matrix corpus evaluations.
- Preserve the 30-second runtime-settings deadline and sanitized timeout failure without adding implicit retries or model fallback.
- Keep preparation acknowledgments separate from final notification outcomes, including multipart reply correlation and the calendar-query success requirement.

## Watch Points

- Keep the system prompt, tool definitions, and tests aligned whenever a new direct tool is added.
- Do not add compatibility routes for retired command/action workflows.
- Preserve the unsupported outcome for requests outside the direct-tool boundary.
- Preserve the intent gate before tool calling. Broad questions, greetings, missing-link complaints, unsupported read-only personal-data requests, and unrelated multi-resource messages should not accidentally expose creation tools. Preserve the intentional query-before-update and multiple-event confirmation paths.
- Keep session continuation behavior covered when changing statuses, timeout handling, reply publication, or timeline event ordering.
