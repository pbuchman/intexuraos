# WhatsApp Service

WhatsApp Service is the mobile edge for IntexuraOS. It receives WhatsApp Business webhooks, stores inbound messages, verifies phone ownership, sends outbound notifications, and maintains the private WhatsApp mirror used by the private workspace.

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

## Conversation Assistant

Conversation Assistant lets an authenticated user discuss a frozen slice of one private WhatsApp conversation with an AI model. The original slice never changes after preparation, so earlier answers remain reproducible.

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

## Unsupported Voice Handling

Voice messages are intentionally unsupported for now. The service replies with a clear text-only message and does not start transcription for Intex conversations.

Interactive button replies from retired workflows are also ignored. They are marked as read when possible and are not routed into Intex Agent.

## Notifications

Other services can publish outbound WhatsApp messages through the send-message topic. Messages can carry an importance flag so user notification preferences can suppress low-priority updates.

Outbound sends can be plain text, interactive buttons, or CTA URL messages. Successful sends are recorded best-effort for reply correlation.
