# WhatsApp Service Agent Reference

Use whatsapp-service for WhatsApp Business webhook intake, user phone verification, outbound message delivery, text ingestion into Intex Agent, and private WhatsApp mirror reads.

## Current Inbound Behavior

- Text messages are persisted and published as `intex.message.ingest` with `sourceType: "whatsapp_text"`.
- URL shares are treated as text messages and routed through Intex.
- Button payloads from retired workflows are ignored.
- Voice/audio messages receive this explicit reply: `Voice messages are not supported by Intex yet. Please send text for now.`

## Private Workspace Behavior

- Authenticated user routes expose private account, chat, sender, message, and sender-day views.
- Public private read routes derive `sourceAccountId` from the authenticated user's active account. Do not accept caller-supplied `sourceAccountId` on those routes.
- Internal private routes accept `sourceAccountId` for bridge sync and agent reads.
- Private ingest accepts Matrix live and backfill events, including incoming and outgoing directions.
- Private ingest preserves group chat classification when later events would otherwise downgrade the chat type.
- Private sender-day aggregates use Warsaw day keys and can be rebuilt from stored messages through the internal rebuild route.

## Important Boundaries

- Do not reintroduce general approval reply matching.
- Do not route audio transcripts into Intex.
- Do not publish retired command/action events.
- Keep webhook handlers idempotent and log incoming internal requests before auth validation.
- Do not mutate private WhatsApp messages through read routes.
- Do not expose raw Matrix events or Matrix room IDs from authenticated private read responses. `/private/account` exposes the authenticated user's `sourceAccountId`; collection read routes must derive it server-side and reject caller-supplied values.
