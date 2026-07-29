# WhatsApp Service Technical Debt

## Current Watch Points

- Keep text ingestion and unsupported voice handling covered by tests.
- Preserve idempotent webhook replay for text messages.
- Keep outbound send payloads compatible with existing notification publishers.
- Keep the approved Message Digest template and run authorization contract frozen until a coordinated template migration is available.
- Add provider-status reconciliation automation for ambiguous Message Digest sends without ever allowing a blind retry.
- Do not add approval reply matching without a new Intex tool-call policy design.
- Keep private Matrix ingest idempotent by Matrix event ID.
- Preserve private chat group classification when later bridge events report weaker metadata.
- Keep private read routes read-only and scoped to the authenticated user's active private account.
- Keep internal private routes from logging message bodies or raw Matrix events.
- Keep sender-day aggregate rebuilds bounded by their request limit.

## Future Work

- Design a new voice-to-text product flow if voice support returns.
- Consider richer user controls for notification importance.
- Keep webhook processing observability high because WhatsApp delivery failures are user-visible.
- Add product-facing private workspace controls only after the read-only mirror semantics are intentionally changed.
- Revisit sender-day summary generation when a summarizer owns the `summaryStatus` and `summaryText` fields end to end.
