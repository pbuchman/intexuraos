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

## Analyze A Private Conversation

1. Open one private chat and start Conversation Assistant.
2. Select a date range and an available model, then prepare the analysis.
3. Inspect its captured context and ask a question; the answer streams as it is generated.
4. Use PDF export to save the analysis. Large context can fail the selected model’s input budget; narrow the range if needed.

In the private chat, open stored images or play audio/video attachments. Enable the chat’s transcription setting to request private voice/video transcripts. Reactions appear with their source message. These controls do not enable voice commands for Intex.

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

## Verify Message Digest readiness

Message Digest Service calls the internal readiness contract with the owning user ID:

```text
POST /internal/whatsapp/delivery-readiness/get
```

A ready response exposes only a masked form of the first mapped phone. Missing mapping, disconnected account, or disabled delivery is returned as an explicit status. The digest UI must direct the user to repair the existing WhatsApp connection; it must not ask for a separate destination number.

To inspect a digest source safely, first validate the owned chat through `/internal/whatsapp/private/digest-source/validate`, then use the returned account generation and source revision with `/internal/whatsapp/private/digest-source/messages/query`. Never copy request or response content into operational logs.

## Test Audio Transcription And Reply Context

Send a voice message and inspect its stored audio and transcription state. Audio should publish an audio-stored event for transcription, without directly publishing an Intex action ingest or the old unsupported-voice reply.

After transcription completes, reply to that audio with a text request. The completed transcript may be included as bounded context for the text request. Check that pending or unsafe transcript context is not forwarded.

## Send An Outbound Notification

Publish a WhatsApp send-message payload from a platform service. whatsapp-service delivers it through the WhatsApp Cloud API and records send state for observability.

For an idempotent send, inspect `POST /internal/whatsapp/outbound-deliveries/get` with internal auth, `userId`, and `idempotencyKey`. Provider acceptance and `transportConfirmation` are separate: verify a delivered/read confirmation and its timestamp before reporting confirmed delivery. A `sent` callback alone leaves confirmation pending.

For a tracked calendar run, use `POST /internal/whatsapp/notification-runs/get` with internal auth, `userId`, `source: "calendar"`, and the run ID. Follow the stage through ingress, processing, and delivery. All final reply parts must be confirmed; the preparation acknowledgment is insufficient. Inspect existing receipts before considering recovery and never resend an ambiguous outcome blindly.

For private mirror recovery, follow the [controlled recovery procedure](../../setup/16-private-whatsapp-matrix-sync.md#controlled-history-recovery). Review relation repairs explicitly and use media-only recovery for missing generic files; do not replay message ingest to repair media.
