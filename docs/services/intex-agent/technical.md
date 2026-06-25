# Intex Agent Technical Reference

Intex Agent is the WhatsApp text conversation runtime. It exposes `POST /internal/intex-agent/messages`, selects one of the supported direct tools, calls the downstream typed client, and returns a structured outcome.

## Tool Boundary

The current tools are defined in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`:

- `create_note`
- `create_calendar_event`
- `create_research`
- `create_link`
- `create_code_task`

The system prompt in `apps/intex-agent/src/domain/agent/systemPrompt.ts` is the runtime contract. Requests outside those jobs must return `unsupported` rather than being routed through a fallback action system.

## Downstream Services

| Tool | Downstream service |
| --- | --- |
| `create_note` | notes-agent |
| `create_calendar_event` | calendar-agent |
| `create_research` | research-agent |
| `create_link` | bookmarks-agent |
| `create_code_task` | code-agent |

Code tasks default to planning mode unless the user explicitly asks for execution mode.

