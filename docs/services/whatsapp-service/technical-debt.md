# WhatsApp Service Technical Debt

## Current Watch Points

- Keep text ingestion, audio storage/transcription, and transcript reply-context boundaries covered by tests.
- Preserve idempotent webhook replay for text messages.
- Keep outbound send payloads compatible with existing notification publishers.
- Keep the approved Message Digest template and run authorization contract frozen until a coordinated template migration is available.
- Preserve provider-status callback correlation and Message Digest receipt reconciliation without ever allowing a blind retry of ambiguous sends or accepted sends awaiting confirmation.
- Preserve `intex_confirm:` button routing and Intex confirmation replay checks; do not revive retired workflow buttons.
- Keep private Matrix ingest idempotent by Matrix event ID.
- Preserve private chat group classification when later bridge events report weaker metadata.
- Keep private read routes read-only and scoped to the authenticated user's active private account.
- Keep internal private routes from logging message bodies or raw Matrix events.
- Keep sender-day aggregate rebuilds bounded by their request limit.

## Release Watch Points

- Keep model-specific context budgets, immutable snapshots, explicit continuation, PDF export, and replay recovery aligned.
- Cover media backfill, inline reaction relations, and account-generation changes without crossing private-account ownership boundaries.
- Preserve metadata redaction and strict mocked actions in Matrix corpus evaluations.
- Keep receipt-before-acceptance ordering, status-only/mixed batches, final-part completeness, and delivered/read precedence covered. Never count a preparation acknowledgment as final calendar delivery.
- Keep reviewed policy relation repairs and generic-file media recovery separate from ordinary message replay.

## Future Work

- Direct voice-to-action execution would require a separate explicit product and confirmation policy.
- Consider richer user controls for notification importance.
- Keep webhook processing observability high because WhatsApp delivery failures are user-visible.
- Keep per-chat transcription controls separate from source-message mutation and enforce ownership on media access.
- Revisit sender-day summary generation when a summarizer owns the `summaryStatus` and `summaryText` fields end to end.
