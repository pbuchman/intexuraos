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

## Unsupported Voice Handling

Voice messages are intentionally unsupported for now. The service replies with a clear text-only message and does not start transcription for Intex conversations.

Interactive button replies from retired workflows are also ignored. They are marked as read when possible and are not routed into Intex Agent.

## Notifications

Other services can publish outbound WhatsApp messages through the send-message topic. Messages can carry an importance flag so user notification preferences can suppress low-priority updates.

Outbound sends can be plain text, interactive buttons, or CTA URL messages. Successful sends are recorded best-effort for reply correlation.
