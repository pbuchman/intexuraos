# Intex Agent Technical Reference

Intex Agent is the WhatsApp text conversation runtime. It accepts `intex.message.ingest` events, keeps WhatsApp sessions in Firestore, selects at most one supported direct tool, calls the downstream typed client, and publishes the reply through the WhatsApp send topic.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/internal/intex-agent/messages` | internal auth or Pub/Sub push OIDC header | Accept a direct or Pub/Sub-wrapped `intex.message.ingest` payload and return `202` with the session ID. |
| `GET` | `/sessions` | bearer auth | List the authenticated user's Intex Agent sessions. |
| `GET` | `/sessions/:sessionId` | bearer auth | Return one authenticated-user session. |
| `GET` | `/sessions/:sessionId/events` | bearer auth | Return ordered timeline events for one authenticated-user session. |

## Tool Boundary

The current tools are defined in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`:

- `create_note`
- `create_calendar_event`
- `create_research`
- `create_link`
- `create_code_task`

The system prompt in `apps/intex-agent/src/domain/agent/systemPrompt.ts` is the runtime contract. Requests outside those jobs must return `unsupported` rather than being routed through a fallback action system.

`classifyIntexAgentIntent` gates tool exposure before the LLM call. It exposes only the single matched tool for explicit create/save intent, exposes `create_link` for bare URL shares, blocks read-only calendar questions, and rejects messages that contain multiple supported resource intents.

## Downstream Services

| Tool | Downstream service |
| --- | --- |
| `create_note` | notes-agent |
| `create_calendar_event` | calendar-agent |
| `create_research` | research-agent |
| `create_link` | bookmarks-agent |
| `create_code_task` | code-agent |

Code tasks default to planning mode unless the user explicitly asks for execution mode.

## Sessions And Replies

Sessions are stored in `intex_agent_sessions`; timeline events are stored in `intex_agent_session_events`. Open statuses are `active`, `waiting_for_user`, and `executing_tool`.

The message handler finds the newest open session for the user, starts a new one when none exists, supersedes an open session on explicit new-session commands, and expires stale sessions according to `INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS`.

After completed, clarification, no-action, or unsupported outcomes, the session remains `waiting_for_user`. Replies are published with the original WhatsApp message ID as `replyToMessageId` and the session ID as `correlationId`.
