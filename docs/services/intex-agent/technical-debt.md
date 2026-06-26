# Intex Agent Technical Debt

## Current Scope Decisions

- Voice messages are intentionally unsupported until a new text-first product flow is designed.
- General approval handling is intentionally absent. Future destructive-operation review should be implemented as a new Intex tool-call policy.
- The tool set is deliberately small: notes, calendar events, research drafts, bookmarks, and code tasks.
- Read-only personal-data tools are intentionally absent. Calendar inspection, note search, bookmark lookup, WhatsApp history lookup, and code-task inspection should remain unsupported until explicit read tools exist.
- Old duplicated command/action-agent behavior is intentionally removed. New supported actions should be added through the Intex Agent tool boundary, not through compatibility routes.

## Watch Points

- Keep the system prompt, tool definitions, and tests aligned whenever a new direct tool is added.
- Do not add compatibility routes for retired command/action workflows.
- Preserve the unsupported outcome for requests outside the direct-tool boundary.
- Preserve the intent gate before tool calling. Broad questions, greetings, missing-link complaints, read-only calendar requests, and multi-resource messages should not accidentally expose creation tools.
- Keep session continuation behavior covered when changing statuses, timeout handling, reply publication, or timeline event ordering.
