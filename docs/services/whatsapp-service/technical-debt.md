# WhatsApp Service Technical Debt

## Current Watch Points

- Keep text ingestion and unsupported voice handling covered by tests.
- Preserve idempotent webhook replay for text messages.
- Keep outbound send payloads compatible with existing notification publishers.
- Do not add approval reply matching without a new Intex tool-call policy design.

## Future Work

- Design a new voice-to-text product flow if voice support returns.
- Consider richer user controls for notification importance.
- Keep webhook processing observability high because WhatsApp delivery failures are user-visible.

