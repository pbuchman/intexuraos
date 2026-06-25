# WhatsApp Service Tutorial

## Send Text Into Intex

1. Connect a WhatsApp number in the web app.
2. Send a text message to the connected WhatsApp Business number.
3. Confirm the webhook event is persisted.
4. Confirm an `intex.message.ingest` event is published for Intex.

Example supported message:

```text
Save a note: review the Q4 report before Friday
```

## Test Unsupported Voice

Send a voice message. The expected reply is:

```text
Voice messages are not supported by Intex yet. Please send text for now.
```

No Intex ingestion event should be published for that audio message.

## Send An Outbound Notification

Publish a WhatsApp send-message payload from a platform service. whatsapp-service delivers it through the WhatsApp Cloud API and records send state for observability.

