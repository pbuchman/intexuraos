# Intex Agent Reference

Use Intex Agent when working on WhatsApp text conversations and direct tool calls.

## Entry Point

- `POST /internal/intex-agent/messages`

Every internal route must log incoming requests before auth validation.

## Supported Tools

- `create_note`
- `create_calendar_event`
- `create_research`
- `create_link`
- `create_code_task`

## Implementation Notes

- Tool definitions live in `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.
- Tool execution lives in `apps/intex-agent/src/domain/agent/toolExecutor.ts`.
- The system prompt lives in `apps/intex-agent/src/domain/agent/systemPrompt.ts`.
- Unsupported requests should return an unsupported outcome and explain the currently supported jobs.

