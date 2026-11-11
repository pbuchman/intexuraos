# WhatsApp Service

WhatsApp Service is the mobile edge for IntexuraOS. It receives WhatsApp Business webhooks, stores inbound messages, verifies phone ownership, sends outbound notifications, and maintains the private WhatsApp mirror used by the private workspace.

It is also the source and delivery boundary for Message Digests. Group and direct-chat summaries read a fenced projection of private WhatsApp messages, and completed summaries are delivered to the user's first connected mapping without a second destination setting.

Scheduled calendar summaries now distinguish preparation progress from final WhatsApp delivery. Delivery and read receipts confirm the final response; accepting a send request or delivering a preparation acknowledgment does not complete the summary.

## Text To Intex Agent

Text messages are persisted and forwarded as `intex.message.ingest` events with `sourceType: "whatsapp_text"`. Intex Agent handles the assistant session and any permitted actions downstream.

URL shares stay on the text path. After a text message is saved, whatsapp-service also publishes a link preview extraction event for web-agent.

## Private WhatsApp Workspace

Authenticated users can enable a private WhatsApp mirror for a phone number that is already connected as their assistant phone. The service stores the private account and exposes read-only views for:

- private mirror account status
- chats, including direct, group, and unknown chat types
- chat messages
- senders
- sender-day aggregates

The private workspace is populated through an internal Matrix bridge sync endpoint. The ingest path accepts live and backfill delivery modes, stores incoming and outgoing Matrix events, de-duplicates by Matrix event ID, and records original Matrix metadata for auditability.

Sender-day aggregates group private messages by sender and Warsaw day key. They include message counts, message type counts, summary status fields, and pagination cursors for agent reads.

Group classification is preserved during ingest. If an existing chat is already classified as `group`, a later `direct` or `unknown` event does not downgrade it.

## Media, Transcripts, And Reactions

Private chats show stored image previews, audio/video playback, and inline reactions beside their source messages. Per-chat transcription controls enable private voice/video transcripts. This is separate from the Intex voice-input boundary below. WhatsApp Business video messages also have a storage and transcription path.

Media access is owner-checked. Matrix synchronization and media recovery preserve source-account boundaries, including legacy relations and retried/backfilled attachments.

## Conversation Assistant

Conversation Assistant lets an authenticated user discuss a frozen slice of one private WhatsApp conversation with an AI model. Users choose a date range and an available model, inspect captured messages, and receive streamed answers. They can export the analysis as a PDF. The original slice never changes after preparation, so its captured context remains inspectable. Model-specific input budgets still bound every request.

During a longer analysis, the user can choose **Include new messages** and write the next question in the same composer. The service freezes everything available after the last committed boundary, prepares it as a visible context update, and attaches that immutable update to the question only when the user sends. The AI answer begins with a server-produced receipt that states exactly how many messages were included, the captured range, and any omissions or corrections.

Important behavior:

- preparing an update does not silently change the analysis
- sending the question and committing the prepared update is one atomic operation
- messages arriving after the frozen cutoff remain available for an explicit refresh
- zero included messages is a valid update
- edits, Matrix redactions (including WhatsApp message removal as represented by the bridge), reactions, late imports, and completed transcriptions are reported as corrections rather than disguised as new messages; no unsupported separate deletion category is inferred
- hard size limits fail visibly and never truncate context
- a browser reload recovers an unfinished request without appending the question twice
- the context history and PDF show immutable summaries, not raw hidden attachment bodies

Legacy analyses that do not have reliable continuation boundaries fail closed and offer a new analysis instead of guessing which messages are new.

## Audio Transcription And Text Actions

WhatsApp Business voice messages are stored and sent for transcription. They do not automatically execute an Intex action. Reply with text to a completed audio message to supply its transcript as context for the text request.

Buttons with an `intex_confirm:` identifier are forwarded as `whatsapp_button` events to confirm or cancel Intex actions. Other retired workflow buttons remain ignored.

## Notifications

Other services can publish outbound WhatsApp messages through the send-message topic. Messages can carry an importance flag so user notification preferences can suppress low-priority updates.

Outbound sends can be plain text, interactive buttons, or CTA URL messages. Successful sends are recorded best-effort for reply correlation.

Message Digest sends use the frozen Polish `intexuraos_message_digest_v4` template, a run-scoped idempotency key, and an authorization acquired from Message Digest Service. The approved template owns the scan-friendly line breaks and section hierarchy; each runtime value is compacted to one provider-safe line. WhatsApp Service resolves the user's first mapped phone, records pending/sent/ambiguous/failed delivery state, and permits a byte-identical retry only after a definitive failure. An ambiguous provider outcome is never retried blindly.

## Message Digest Source

Message Digest Service can validate one owned private group or direct chat and query only that chat's messages in a bounded time window. The resulting source revision binds account generation, chat identity, chat type, and context-change sequence. Reconnects, redactions, late imports, or other context changes invalidate stale reads instead of silently mixing versions.

Source projections omit raw Matrix identifiers and exclude deleted or redacted content. Request logging for these internal routes uses no body preview.
