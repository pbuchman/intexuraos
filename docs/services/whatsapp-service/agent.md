# WhatsApp Service Agent Reference

Use whatsapp-service for WhatsApp Business webhook intake, user phone verification, outbound message delivery, and text ingestion into Intex.

## Current Inbound Behavior

- Text messages are persisted and published as `intex.message.ingest`.
- URL shares are treated as text messages and routed through Intex.
- Button payloads from retired workflows are ignored.
- Voice/audio messages receive this explicit reply: `Voice messages are not supported by Intex yet. Please send text for now.`

## Important Boundaries

- Do not reintroduce general approval reply matching.
- Do not route audio transcripts into Intex.
- Do not publish retired command/action events.
- Keep webhook handlers idempotent and log incoming internal requests before auth validation.

