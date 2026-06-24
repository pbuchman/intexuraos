# Intex Agent WhatsApp Sessions Goal

## Status

Goal definition for the first implementation phase.

## Functional Goal

Build `intex-agent` as the WhatsApp Assistant runtime for IntexuraOS.

The user-facing result of this phase is a WhatsApp assistant that can handle two supported jobs:

- Create calendar events.
- Create notes.

The assistant must operate through explicit visible sessions. A session is product state, not a separate GPT thread. The underlying LLM conversation can remain continuous, but the user must always know when the current IntexuraOS session starts and when the previous one has been closed, completed, expired, or superseded.

Required user-facing behavior:

- When no active valid session exists, the assistant starts a new session and says that a new session started.
- When a previous session has finished and the next user message starts another session, the assistant says that the previous session finished and that a new session started.
- When the user explicitly asks for a new session, the assistant closes any current active or waiting session, starts a new one, and says that it did so.
- When a calendar request is missing required details, the assistant asks a natural clarification and keeps the session waiting for the user.
- When the user answers the clarification, the assistant continues the same session and executes the tool if the required details are now complete.
- When the user asks for unsupported work, the assistant clearly says that the request is not supported yet and lists the currently supported capabilities: notes and calendar events.
- When a supported tool succeeds or fails, the assistant replies in WhatsApp and the session finalizes with a visible status.

Example calendar flow:

```text
User: Add dinner with Sarah at 7
Assistant: New session started. Which day should I create the event for?
User: Friday
Assistant: Created: dinner with Sarah on Friday at 7:00 PM.
```

Example next session flow:

```text
User: Remember that the gate code is 4938
Assistant: Previous session finished. New session started. Saved this as a note.
```

Example explicit new session flow:

```text
User: new session: add dentist appointment Friday at 2
Assistant: Previous session closed. New session started. Created the calendar event for Friday at 2:00 PM.
```

## Technical Goal

Create a new `intex-agent` service and deploy it to dev and production. The service owns assistant sessions, the LLM tool loop, tool execution, unsupported-intent handling, and the read model used by the web UI.

`commands-agent` and `actions-agent` must not be changed as the primary implementation target for this phase. Existing command/action behavior remains available for current flows, but WhatsApp Assistant input should be routed to `intex-agent` instead of the `command.ingest` classifier flow.

The selected tool-calling model for this phase is:

```text
or:google/gemini-3-flash-preview
```

This matches the existing repo pattern used by code-agent for OpenRouter tool calling and is stronger than Gemma for this first WhatsApp assistant phase. Gemma is not the default target for this phase.

## Core Components

`intex-agent` should contain these internal components:

- Inbound message route for WhatsApp Assistant messages.
- Session service for creating, continuing, closing, expiring, and superseding sessions.
- Session event repository for audit-friendly timelines.
- Agent runner that uses tool descriptions and current session state to decide whether to call a tool, ask a clarification, or decline unsupported work.
- Tool executor for the two initial tools.
- WhatsApp reply publisher using the existing `whatsapp.message.send` Pub/Sub path.
- Public web routes for browsing sessions and session timelines.

## Tools

### `create_note`

Use when the user asks to remember, save, note, write down, or keep information.

Inputs:

- `content`: required note body.
- `title`: optional short title.
- `tags`: optional tags, default empty.
- `sourceMessageIds`: optional source WhatsApp message IDs.

Execution target:

- Existing notes-agent internal endpoint: `POST /internal/notes`.

### `create_calendar_event`

Use when the user wants an event, appointment, meeting, reminder-like calendar block, or scheduled item added to Google Calendar.

Inputs:

- `summary`: required event title.
- `start`: required date or date-time.
- `end`: required date or date-time, unless the agent applies a documented default duration.
- `timeZone`: optional, derived from user/calendar context when possible.
- `location`: optional.
- `description`: optional.
- `attendees`: optional.

If the date, time, or title is ambiguous or missing, the assistant asks a clarification before executing the tool.

Execution target:

- New calendar-agent structured internal endpoint: `POST /internal/calendar/events`.

## Session Model

Sessions are persisted as first-class product records.

Recommended session fields:

```ts
interface IntexAgentSession {
  id: string;
  userId: string;
  channel: 'whatsapp';
  status:
    | 'active'
    | 'waiting_for_user'
    | 'executing_tool'
    | 'completed'
    | 'unsupported'
    | 'expired'
    | 'cancelled'
    | 'superseded';
  startedAt: string;
  endedAt?: string;
  lastUserMessageAt: string;
  lastAssistantMessageAt?: string;
  startReason:
    | 'no_active_session'
    | 'previous_completed'
    | 'previous_expired'
    | 'user_requested_new_session'
    | 'previous_superseded';
  endReason?:
    | 'tool_completed'
    | 'tool_failed'
    | 'unsupported_request'
    | 'timeout'
    | 'cancelled_by_user'
    | 'superseded_by_user';
  activeTool?: 'create_note' | 'create_calendar_event';
  summary?: string;
}
```

Recommended session event fields:

```ts
interface IntexAgentSessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  type:
    | 'session_started'
    | 'session_closed'
    | 'user_message'
    | 'assistant_message'
    | 'clarification_requested'
    | 'tool_call_started'
    | 'tool_call_completed'
    | 'tool_call_failed'
    | 'unsupported_request';
  payload: Record<string, unknown>;
  createdAt: string;
}
```

## Explicit Session Start

Explicit session control is handled before the LLM tool loop.

Recognized commands include:

- `/new`
- `new session`
- `start new session`
- `start over`
- `forget this and start over`
- `new session: <request>`

If the message is only a session command, the assistant closes any active session and replies that a new session started.

If the message includes a request after the session command, the assistant starts the new session and processes the remainder as the first user request in that session.

Explicit new-session commands always win over pending clarifications.

## WhatsApp Routing

WhatsApp service remains the transport adapter. It receives Meta webhooks, stores inbound message data, resolves the IntexuraOS user, and publishes an assistant ingest event.

`intex-agent` receives the assistant event, owns the session and tool behavior, and sends replies through the existing WhatsApp outbound Pub/Sub path.

Voice messages remain a two-step flow:

1. WhatsApp service stores audio and transcription service produces transcript.
2. Completed transcription publishes the assistant ingest event to `intex-agent`.

## Web UI Goal

Add an Intex Agent session browser similar to the Private WhatsApp log UI.

The UI should let the user browse:

- Sessions grouped by date and status.
- Where each session started.
- User messages.
- Assistant replies.
- Clarifications.
- Tool calls and tool arguments.
- Tool results or errors.
- How the session finalized.

Recommended layout:

- Left rail: sessions with status, date, active tool, and short summary.
- Main panel: chronological session timeline.
- Filters: status, tool type, date range.

## Endpoint Changes

### Created

- `POST /internal/intex-agent/messages`
  - Internal Pub/Sub push endpoint for WhatsApp Assistant text and transcription events.

- `GET /intex-agent/sessions`
  - Authenticated web endpoint for listing the current user's sessions.

- `GET /intex-agent/sessions/:sessionId`
  - Authenticated web endpoint for reading one session.

- `GET /intex-agent/sessions/:sessionId/events`
  - Authenticated web endpoint for reading the session timeline.

- `POST /internal/calendar/events`
  - Internal structured calendar event creation endpoint used by `intex-agent`.

### Modified

- WhatsApp text-message processing publishes `intex.message.ingest` for Assistant messages instead of `command.ingest`.

- WhatsApp transcription-completed processing publishes `intex.message.ingest` for Assistant voice messages instead of `command.ingest`.

- Web service manifest and generated service wiring add an `intex-agent` API path.

### Removed

- No existing endpoint is removed in this phase.

### Unchanged

- Existing `commands-agent` endpoints remain available.
- Existing `actions-agent` endpoints and approval flow remain available.
- Existing `whatsapp.message.send` outbound Pub/Sub flow remains the reply mechanism.
- Existing notes-agent `POST /internal/notes` remains the note creation target.

## Infrastructure Goal

Deploy `intex-agent` to both dev and production.

Required wiring:

- New service package under `apps/intex-agent`.
- Service entrypoint required env vars in `apps/intex-agent/src/index.ts`.
- PM2 service entry and URL wiring in `ecosystem.config.cjs`.
- Dev Terraform service wiring in `terraform/environments/dev/main.tf`.
- Production Hetzner/nginx/PM2 route wiring in `terraform/hetzner-prod`.
- New Pub/Sub topic/subscription for assistant ingest if the final implementation uses a new topic name.
- Pub/Sub emulator tooling updates for any new topic.
- Web service manifest update and generated service wiring for the new UI API path.

## Non-Goals For This Phase

- Do not replace all command/action functionality.
- Do not support research, links, reminders, Linear issues, code tasks, todos, bookmarks, or arbitrary notification replies.
- Do not use Gemma as the default model for the first `intex-agent` tool loop.
- Do not build a separate GPT thread per product session.
- Do not remove `commands-agent` or `actions-agent`.

## Acceptance Criteria

- A WhatsApp Assistant user can create a note through `intex-agent`.
- A WhatsApp Assistant user can create a calendar event through `intex-agent`.
- Missing calendar details trigger a clarification and preserve the same session.
- Explicit new-session commands close the current session and create a visible new one.
- Completed, unsupported, expired, and superseded sessions are visible in the UI.
- Unsupported requests receive a clear WhatsApp reply saying only notes and calendar events are supported.
- The session browser shows session start, user/assistant messages, tool calls, results, and finalization.
- Dev and production service wiring include `intex-agent`.
- Tests cover session lifecycle, tool routing, unsupported behavior, WhatsApp ingest, note tool execution, calendar tool execution, and session UI API responses.
- `pnpm run ci:tracked` passes before commit or PR finalization.
