# Intex Agent Reference

Use Intex Agent when working on WhatsApp text conversations and direct tool calls.

## Entry Points

- `POST /internal/intex-agent/messages`
- `GET /sessions`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/events`

Every internal route must log incoming requests before auth validation.

## Supported Tools

- `create_note`
- `create_calendar_event`
- `create_research`
- `create_link`
- `create_code_task`
- `query_calendar_events`
- `save_external`

## Implementation Notes

- Tool definitions live in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.
- Tool execution lives in `apps/intex-agent/src/domain/agent/toolExecutor.ts`.
- The system prompt lives in `apps/intex-agent/src/domain/agent/systemPrompt.ts`.
- Unsupported requests should return an unsupported outcome and explain the currently supported jobs.
- Intent gating lives in `apps/intex-agent/src/domain/agent/intentGate.ts`. Keep tools hidden unless one supported create/save intent is explicit, a bounded read-only calendar list/count request is detected, a bare URL routes to `create_link`, or an English/Polish external-save phrase routes to `save_external`.
- External Save configuration is stored in Intex Agent preferences. Route responses mask `cfAccessClientSecret`; tool execution uses the unmasked stored value.
- WhatsApp image ingests with `sourceType: whatsapp_image` bypass the LLM and call `save_external` directly with `sourceUrl`.
- Session transitions live in `apps/intex-agent/src/domain/sessions/sessionController.ts`. Completed, clarification, no-action, and unsupported turns leave the session open for follow-up.
- WhatsApp replies are published through `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts` with `replyToMessageId` and session correlation.
- Do not reintroduce retired command/action-agent compatibility behavior. Add new supported jobs as explicit Intex Agent tools.
