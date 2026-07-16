# Intex Agent Technical Reference

Intex Agent is the WhatsApp text conversation runtime. It accepts `intex.message.ingest` events, keeps WhatsApp sessions in Firestore, selects at most one supported direct tool, calls the downstream typed client, and publishes the reply through the WhatsApp send topic.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/internal/intex-agent/messages` | internal auth or Pub/Sub push OIDC header | Accept a direct or Pub/Sub-wrapped `intex.message.ingest` payload and return `202` with the session ID. |
| `POST` | `/internal/intex-agent/test/conversation` | internal auth only, local/dev only | Run a test conversation with captured replies, real session persistence, real prompt/classifier/runner flow, and mocked tool execution. Production returns `404`. |
| `GET` | `/preferences` | bearer auth | Return prompt instructions and External Save configuration with the Cloudflare secret masked. |
| `PUT` | `/preferences` | bearer auth | Save prompt instructions and External Save configuration. |
| `DELETE` | `/preferences` | bearer auth | Clear prompt instructions and External Save configuration. |
| `POST` | `/preferences/external-save/test` | bearer auth | Test the saved or submitted External Save configuration. |
| `GET` | `/sessions` | bearer auth | List the authenticated user's Intex Agent sessions. |
| `GET` | `/sessions/:sessionId` | bearer auth | Return one authenticated-user session. |
| `GET` | `/sessions/:sessionId/events` | bearer auth | Return ordered timeline events for one authenticated-user session. |

## Tool Boundary

The current tools are defined in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`:

- `create_note`
- `create_calendar_event`
- `query_calendar_events`
- `create_research`
- `create_link`
- `create_code_task`
- `save_external`

The system prompt in `apps/intex-agent/src/domain/agent/systemPrompt.ts` is the runtime contract. Requests outside those jobs must return `unsupported` rather than being routed through a fallback action system.

`classifyIntexAgentIntent` gates tool exposure before the LLM call. It exposes only the single matched tool for explicit create/save intent, exposes `create_link` for bare URL shares, exposes `save_external` for English and Polish external-save phrases, routes read-only calendar list/count questions only through `query_calendar_events`, and rejects messages that contain multiple supported resource intents. Other read-only personal-data requests remain unsupported.

WhatsApp image messages skip the LLM and call `save_external` directly when External Save is enabled. The signed stored-image URL is passed as `sourceUrl` for the current turn only; the long-lived Intex session event stores `hasSourceUrl: true` instead of the full signed URL.

## Downstream Services

| Tool | Downstream service |
| --- | --- |
| `create_note` | notes-agent |
| `create_calendar_event` | calendar-agent |
| `query_calendar_events` | calendar-agent |
| `create_research` | research-agent |
| `create_link` | bookmarks-agent |
| `create_code_task` | code-agent |
| `save_external` | User-configured External Save endpoint |

Code tasks default to planning mode unless the user explicitly asks for execution mode.

## Internal Test Conversation Endpoint

`POST /internal/intex-agent/test/conversation` is an operator/testing endpoint for
local and dev. Call it directly on the host-local `intex-agent` service, for example
`http://localhost:8134/internal/intex-agent/test/conversation`, with
`X-Internal-Auth: <INTEXURAOS_INTERNAL_AUTH_TOKEN>`.

Production returns `404` for this endpoint before request-body parsing. On
nginx-backed public domains, `/api/intex-agent/internal/...` remains blocked by
nginx. The supported operator path is the direct host-local service URL.

The request must use `contractVersion: "2026-07-01"`, `mode:
"live_llm_mock_tools"`, a lowercase `runId`, and `userId` exactly equal to
`test-intex-agent-<runId>`. The endpoint writes sessions and events to the
normal Intex Agent Firestore collections, so every run must use a unique
`runId` and test user id.

Requests accept 1 through exactly 20 turns and reject 0 or 21.
The independent provider tool-loop limit remains unchanged. See the
[Intex Agent evaluation runbook](../../testing/intex-agent-evals.md).

Example:

```bash
RUN_ID="intex-e2e-$(date -u +%Y%m%d%H%M%S)"

curl -sS \
  -H "content-type: application/json" \
  -H "X-Internal-Auth: ${INTEXURAOS_INTERNAL_AUTH_TOKEN}" \
  -d "{
    \"contractVersion\": \"2026-07-01\",
    \"mode\": \"live_llm_mock_tools\",
    \"runId\": \"${RUN_ID}\",
    \"scenarioId\": \"calendar-empty-tomorrow\",
    \"userId\": \"test-intex-agent-${RUN_ID}\",
    \"currentDateTime\": \"2026-07-01T10:00:00.000Z\",
    \"timeZone\": \"Europe/Warsaw\",
    \"turns\": [
      {
        \"kind\": \"message\",
        \"messageId\": \"wamid-${RUN_ID}-001\",
        \"text\": \"Jakie wydarzenia mam jutro w kalendarzu? ${RUN_ID}\",
        \"timestamp\": \"2026-07-01T10:00:00.000Z\",
        \"sourceType\": \"whatsapp_text\"
      }
    ],
    \"toolMocks\": {
      \"query_calendar_events\": {
        \"mode\": \"success\",
        \"result\": {
          \"status\": \"completed\",
          \"mode\": \"list\",
          \"count\": 0,
          \"events\": []
        }
      }
    }
  }" \
  "http://localhost:8134/internal/intex-agent/test/conversation"
```

Replies are captured in the API response instead of being published to WhatsApp.
All downstream tools are mocked, including prompt preference mutation tools.
The endpoint may read real prompt preferences for prompt context, but it does not
write notes, calendar events, research drafts, bookmarks, code tasks, external
save payloads, or prompt preferences.

The response is sanitized: it omits raw `toolArgs`, raw tool results, raw URLs,
`replyContext`, `sourceUrl`, `whatsappSender`, auth tokens, secret-like fields,
and prompt preference blocks. Assistant replies are returned as redacted test
DTOs, not as raw WhatsApp payloads. Behavioral evidence is returned through
`turns`, `sessions`, `sessionTransitions`, `eventsBySessionId`, `toolCalls`, and
`behavioralTranscript`.

Cleanup is guarded and defaults to dry-run. It requires service-account
credentials, refuses non-test users, and requires `userId` to exactly match
`test-intex-agent-<runId>`. It targets the dev project by default and deletes
matching documents from `intex_agent_sessions`, `intex_agent_session_events`,
`intex_agent_prompt_preferences`, and
`intex_agent_prompt_preference_versions`.

Dry-run first:

```bash
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
node scripts/cleanup-intex-agent-test-conversations.mjs \
  --user-id "test-intex-agent-${RUN_ID}" \
  --run-id "$RUN_ID" \
  --dry-run
```

Execute deletion only after reviewing the dry-run counts:

```bash
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
node scripts/cleanup-intex-agent-test-conversations.mjs \
  --user-id "test-intex-agent-${RUN_ID}" \
  --run-id "$RUN_ID" \
  --execute
```

Fastify body-limit parser errors return structured `413` responses without
Sentry capture. This is a platform-wide app-server behavior because the shared
`@intexuraos/infra-sentry` Fastify error handler owns request-parser failures.

## External Save Endpoint

The external endpoint is protected by Cloudflare Access Service Auth. Intex sends:

```http
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
content-type: application/json
```

Request body:

```json
{
  "source": "ios-shortcuts",
  "message": "User caption or pasted text",
  "source_url": "https://optional-image-or-shared-url"
}
```

`source_url` is omitted when no URL is available. Intex does not fetch or inspect `source_url`.

The web client in `apps/web/src/services/intexAgentApi.ts` exposes:

- `getIntexAgentPreferences(token)`
- `saveIntexAgentPreferences(token, { instructions, externalSave })`
- `testIntexAgentExternalSave(token, externalSave)`
- `clearIntexAgentPreferences(token)`

## Sessions And Replies

Sessions are stored in `intex_agent_sessions`; timeline events are stored in `intex_agent_session_events`. Open statuses are `active`, `waiting_for_user`, and `executing_tool`.

The message handler finds the newest open session for the user, starts a new one when none exists, supersedes an open session on explicit new-session commands, and expires stale sessions according to `INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS`.

After completed, clarification, no-action, or unsupported outcomes, the session remains `waiting_for_user`. Replies are published with the original WhatsApp message ID as `replyToMessageId` and the session ID as `correlationId`.
