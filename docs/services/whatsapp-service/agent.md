# WhatsApp Service Agent Reference

Use whatsapp-service for WhatsApp Business webhook intake, user phone verification, outbound message delivery, text ingestion into Intex Agent, private WhatsApp mirror reads, and the fenced source/delivery boundary used by Message Digest Service.

## Current Inbound Behavior

- Text messages are persisted and published as `intex.message.ingest` with `sourceType: "whatsapp_text"`.
- URL shares are treated as text messages and routed through Intex.
- `intex_confirm:` buttons publish `whatsapp_button` ingests; other retired workflow buttons are ignored.
- Voice/audio messages are stored and dispatched for transcription; they do not directly create Intex action ingests.

## Private Workspace Behavior

- Authenticated user routes expose private account, chat, sender, message, and sender-day views.
- Public private read routes derive `sourceAccountId` from the authenticated user's active account. Do not accept caller-supplied `sourceAccountId` on those routes.
- Internal private routes accept `sourceAccountId` for bridge sync and agent reads.
- Private ingest accepts Matrix live and backfill events, including incoming and outgoing directions.
- Private ingest preserves group chat classification when later events would otherwise downgrade the chat type.
- Private sender-day aggregates use Warsaw day keys and can be rebuilt from stored messages through the internal rebuild route.

## Important Boundaries

- Preserve the explicit Intex confirmation policy and do not reintroduce retired workflow reply matching.
- Do not automatically execute audio transcripts as Intex commands. A text reply to a completed audio message may include its transcript as bounded reply context.
- Do not publish retired command/action events.
- Keep webhook handlers idempotent and log incoming internal requests before auth validation.
- Do not mutate private WhatsApp messages through read routes.
- Do not expose raw Matrix events or Matrix room IDs from authenticated private read responses. `/private/account` exposes the authenticated user's `sourceAccountId`; collection read routes must derive it server-side and reject caller-supplied values.

## Conversation And Media Contracts

- Conversation Assistant owns immutable initial context, explicit continuation updates, durable streamed turns, model selection at creation, and owner-scoped PDF export. Enforce model input budgets before provider execution.
- Private audio/video transcription is enabled per chat; direct voice-to-action execution remains separate.
- Signed media/thumbnail access checks ownership; Matrix ingest and recovery retain account fences and inline reaction relationships.
- Matrix corpus evaluations exercise transport with strict mocked product actions.

## Message Digest Contracts

- `POST /internal/whatsapp/private/digest-source/validate` validates one user-owned group or direct chat and issues a source revision.
- `POST /internal/whatsapp/private/digest-source/messages/query` reads one bounded window only when account generation and source revision still match.
- `POST /internal/whatsapp/delivery-readiness/get` reports whether the first mapped phone can receive a message; it does not expose a destination selector.
- `POST /internal/whatsapp/outbound-deliveries/get` reconciles idempotent provider state.
- Provider acceptance (`sent`) is separate from `transportConfirmation`. Require delivered/read confirmation before claiming delivery; missing confirmation never authorizes another send.
- `POST /internal/whatsapp/outbound-deliveries/retry` permits only a byte-identical retry of a definitively failed send.

## Scheduled Notification Evidence

- `POST /internal/whatsapp/notification-runs/get` requires internal auth and the owning `userId`, `source`, and `runId`. It returns execution stage and final delivery outcome.
- A preparation acknowledgment cannot complete a run. All expected final response parts must be confirmed delivered/read; failed final outcomes remain failures.
- `GET /internal/monitoring/status` exposes durable retry-job heartbeats and notification summaries under internal auth. It does not authorize replay or recovery mutations.
- Private Matrix recovery must use reviewed relation-repair evidence and media-only file recovery. Preserve raw-backed unknown poll messages without fabricating content.

Never log source request bodies, message projections, phone numbers, prompts, or summary text. Never retry an ambiguous provider outcome. Message Digest delivery must use the frozen template and acquire run authorization from message-digest-service before the provider call.
