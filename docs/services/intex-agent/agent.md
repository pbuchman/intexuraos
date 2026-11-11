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
- `update_calendar_event`
- `get_user_preferences`
- `add_user_preference`
- `update_user_preference`
- `delete_user_preference`
- `save_external`

## Release Contracts

- Confirm supported mutations before downstream execution; preserve matching-button and replay checks.
- `update_calendar_event` acts on an exact queried event and preserves unspecified fields. Multi-event confirmations contain independent updates.
- Use `/preferences/prompt` and its item/version routes for versioned instructions; `/preferences` owns External Save configuration.
- Model selection belongs to user-service. Gated `/test-runs` views expose sanitized operator evidence and never authorize real tools in evaluations.
- Runtime-settings resolution has a 30-second deadline. Failure keeps the existing sanitized response; it does not retry or choose a fallback model.
- Preserve scheduled notification source/run context through the acknowledgment and every final reply part. Only a completed `query_calendar_events` outcome satisfies a calendar-summary run; WhatsApp delivery confirmation remains separate.

## Implementation Notes

- Tool definitions live in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.
- Tool execution lives in `apps/intex-agent/src/domain/agent/toolExecutor.ts`.
- The system prompt lives in `apps/intex-agent/src/domain/agent/systemPrompt.ts`.
- Unsupported requests should return an unsupported outcome and explain the currently supported jobs.
- Intent gating lives in `apps/intex-agent/src/domain/agent/intentGate.ts`. Expose only tools permitted for the supported intent. Calendar updates require lookup, readiness, and confirmation; preferences have explicit read/mutation tools.
- External Save configuration is stored in Intex Agent preferences. Route responses mask `cfAccessClientSecret`; tool execution uses the unmasked stored value.
- WhatsApp image ingests with `sourceType: whatsapp_image` bypass the LLM and prepare `save_external` with `sourceUrl` for confirmation.
- Session transitions live in `apps/intex-agent/src/domain/sessions/sessionController.ts`. Completed, clarification, no-action, and unsupported turns leave the session open for follow-up.
- WhatsApp replies are published through `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts` with `replyToMessageId` and session correlation.
- Do not reintroduce retired command/action-agent compatibility behavior. Add new supported jobs as explicit Intex Agent tools.
