# WhatsApp Service

WhatsApp Service is the mobile edge for IntexuraOS. It receives WhatsApp Business webhooks, stores inbound messages, verifies phone ownership, and sends outbound notifications.

## Text To Intex

Text messages are forwarded to Intex as `intex.message.ingest` events. Intex can then create notes, calendar events, research drafts, bookmarks, or code tasks.

## Unsupported Voice Handling

Voice messages are intentionally unsupported for now. The service replies with a clear text-only message and does not start transcription for Intex conversations.

## Notifications

Other services can publish outbound WhatsApp messages through the send-message topic. Messages can carry an importance flag so user notification preferences can suppress low-priority updates.

