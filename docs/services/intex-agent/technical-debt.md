# Intex Agent Technical Debt

## Current Scope Decisions

- Voice messages are intentionally unsupported until a new text-first product flow is designed.
- General approval handling is intentionally absent. Future destructive-operation review should be implemented as a new Intex tool-call policy.
- The tool set is deliberately small: notes, calendar events, research drafts, bookmarks, and code tasks.

## Watch Points

- Keep the system prompt, tool definitions, and tests aligned whenever a new direct tool is added.
- Do not add compatibility routes for retired command/action workflows.
- Preserve the unsupported outcome for requests outside the direct-tool boundary.

