# WhatsApp Service Tutorial

## Send Text Into Intex Agent

1. Connect a WhatsApp number in the web app.
2. Send a text message to the connected WhatsApp Business number.
3. Confirm the webhook event is persisted.
4. Confirm an `intex.message.ingest` event is published for Intex Agent.
5. For messages containing URLs, confirm a link preview extraction event is also published.

Example supported message:

```text
Save a note: review the Q4 report before Friday
```

## Enable The Private WhatsApp Mirror

1. Connect the user's assistant phone through the normal WhatsApp connection flow.
2. Call `PUT /private/account` as that authenticated user with the same phone number.
3. Confirm the response includes an active private mirror account and a `sourceAccountId`.
4. Use `GET /private/account` to verify the account remains active.

The service rejects private mirror setup when the requested phone number is not one of the user's connected assistant phones.

## Ingest Private Matrix Events

Call `POST /internal/whatsapp/private/events` with internal auth. The request body must include `sourceAccountId`, `deliveryMode`, and at least one Matrix event.

Minimal shape:

```json
{
  "sourceAccountId": "private-wa-example",
  "deliveryMode": "live",
  "events": [
    {
      "matrixRoomId": "!room:matrix.example",
      "matrixEventId": "$event-1",
      "matrixSenderId": "@whatsapp_48123456789:matrix.example",
      "eventTimestamp": "2026-06-22T12:00:00.000Z",
      "chat": {
        "type": "group",
        "displayName": "Project chat"
      },
      "sender": {
        "displayName": "Pat",
        "phoneNumber": "+48 123 456 789"
      },
      "message": {
        "direction": "incoming",
        "type": "text",
        "text": "hello from private whatsapp"
      }
    }
  ]
}
```

Expected result counts separate created messages, duplicates, and rejected events. Repeating the same `matrixEventId` should return a duplicate outcome instead of creating another message.

## Read Private Workspace Data

Use authenticated user routes for the web app:

- `GET /private/chats`
- `GET /private/chats/:chatId/messages`
- `GET /private/senders`
- `GET /private/messages?senderKey=...`
- `GET /private/sender-days?senderKey=...`

Use internal routes for agent or maintenance reads that already know the `sourceAccountId`:

- `GET /internal/whatsapp/private/messages`
- `GET /internal/whatsapp/private/sender-days`
- `POST /internal/whatsapp/private/aggregates/rebuild`

## Continue A Conversation Assistant Analysis

1. Open a completed Conversation Assistant analysis.
2. Select **Include new messages**. This freezes a cutoff; it does not yet modify the analysis.
3. Review the prepared summary or preview. If newer messages arrive, choose **Refresh** to replace the uncommitted draft with a newly frozen cutoff.
4. Write the question and send. The context update and question commit atomically.
5. Confirm the response begins with the persisted receipt containing the exact included count and range, followed by the model answer.
6. Reload the page and confirm the context card, receipt, and answer are still represented once.

To exercise corrections, complete a pending transcription or edit/redact an earlier source message after the initial snapshot. The next update should report that change as a correction. Removed text must not appear in the preview, prompt, receipt, PDF, logs, or API response.

If preparation reaches the hard size limit, reduce the selected scope or start a new analysis. The service never sends a truncated snapshot.

## Physically Erase A Private Account

Physical erasure is an operator-only internal workflow and is intentionally different from disabling the mirror in the UI.

1. Send an internally authenticated `POST /internal/whatsapp/private/accounts/:sourceAccountId/erasure` with `{ "userId": "...", "erasureRequestId": "..." }`.
2. Retry the same request id safely if the response is interrupted.
3. Poll `GET /internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId` until `completed`.
4. Confirm the response contains only status, stage, attempt, timestamps, and deletion counts.
5. Confirm the old source generation can no longer ingest or update messages. A later reconnect must receive a new source generation.

Do not use this workflow as ordinary disconnect. `DELETE /private/account` remains disable-only.

## Test Unsupported Voice

Send a voice message. The expected reply is:

```text
Voice messages are not supported by Intex yet. Please send text for now.
```

No Intex ingestion event should be published for that audio message.

## Send An Outbound Notification

Publish a WhatsApp send-message payload from a platform service. whatsapp-service delivers it through the WhatsApp Cloud API and records send state for observability.
