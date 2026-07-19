# Intex Session Timeline Safe Presentation Design

## Context

The logged-in Home Dev UI audit found that the Intex Agent timeline can render an
entire event payload through `JSON.stringify(payload)`. Live data proved that this
can expose transport identifiers and other technical metadata. A message `text`
value can also itself be serialized structured JSON, bypassing the generic payload
fallback while producing the same unsafe result.

## Decision

Use a strict frontend allow-list for timeline titles and body text. The UI renders only
fields that are intentionally meaningful for a specific event type. Enum-like values
must belong to a closed canonical set before they are formatted. It never serializes
an entire payload and never displays a `text` or `message` string that parses as a JSON
object or array.

This is preferred over recursively redacting arbitrary payloads because a deny-list
cannot anticipate new nested identifiers. Moving display projection into the API is
also unnecessary for this fix because the authenticated endpoint contract and stored
events remain useful to other consumers and do not need to change.

## Presentation Contract

| Event type | Allowed timeline body |
| --- | --- |
| `user_message`, `assistant_message` | Non-empty, non-structured `text` |
| `clarification_requested`, `confirmation_requested`, `unsupported_request` | Non-empty, non-structured `message`, with safe `text` as the existing compatible fallback |
| `session_started` | A canonical session start reason and the existing explicit-announcement label |
| `session_closed` | A canonical session end reason and session status |
| `tool_call_started`, `tool_call_completed`, `tool_call_failed` | A canonical Intex Agent tool name only; an unknown name uses a fixed generic title and no body |
| `confirmation_resolved` | Canonical `accepted`, `rejected`, or `superseded` resolution only |
| `agent_fallback` | A canonical fallback reason only; arbitrary source outcomes remain hidden |
| Missing or unrecognized display data | No body paragraph; title and timestamp remain visible |

Structured JSON means a string that successfully parses to an object or array.
JSON primitives remain ordinary text because they cannot contain nested transport
metadata. A syntactically invalid string remains ordinary text; wrong field types and
noncanonical enum-like values fail closed. The projection does not inspect, redact, or
render unknown keys.

The canonical sets are the existing frontend session status, start reason, end reason,
and tool-name unions, plus fallback reasons `classifier_unsupported`,
`runner_declared_unsupported`, `runner_output_malformed`, `tool_result_mismatch`, and
`llm_call_failed`. The confirmation resolution set is `accepted`, `rejected`, and
`superseded`.

## Components and Data Flow

`IntexSessionTimeline` owns the presentation projection. Small pure helpers validate
canonical values, build a safe title, and select the safe body from an
`IntexAgentSessionEvent` as `string | undefined`. Rendering omits the body paragraph
when the helper returns `undefined`. Event icon, timestamp, ordering, session summary,
session metadata, API responses, and persistence are unchanged. Session summaries are
already user-facing content and are not arbitrary payload serialization; this task does
not change their established presentation.

## Error Handling

Wrongly typed, noncanonical, or structured values fail closed to no body. JSON parsing
is used only as a structural guard; syntactically invalid strings remain ordinary
human-readable text. No parse error is surfaced to the user and no payload value is
logged.

## Testing

Component regressions must prove:

- all twelve event types use only their declared display fields;
- ordinary user and assistant text, compatible message/text fallback priority, and JSON
  primitives remain visible;
- serialized object/array text and its technical key names are absent;
- all three canonical confirmation resolutions render and an unknown one is absent;
- confirmation events without an allowed value keep their card, title, and timestamp
  but omit the body;
- all tool event variants use canonical names, ignore extra result/metadata, and replace
  an unknown name with a fixed generic title;
- lifecycle and agent-fallback fields render only canonical values;
- an unknown technical payload is never serialized;
- existing metadata, responsive layout, search, and timeline projection tests remain
  green.

After unit and repository CI pass, deploy the exact merge to Home Dev and repeat the
logged-in desktop/mobile audit. The live acceptance check requires zero JSON fallback
bodies, no horizontal overflow, successful session refresh/selection, clean console,
and only successful session API requests.

## Out of Scope

- Changing the Intex Agent session API or stored event schema.
- Removing diagnostic data from authenticated API responses.
- Implementing the deferred per-user Intex Agent model selector or language setting.
- Changing endpoint evaluation, mocked tools, MiniMax M3 judging, or Matrix ordering.
