# WhatsApp Service — Technical Reference

## Overview

WhatsApp-service is the integration layer between WhatsApp Business API and IntexuraOS. It receives webhooks from Meta, validates signatures, stores messages in Firestore, downloads media to GCS, tracks outbound messages for reply correlation, and publishes events via Pub/Sub for async processing. Audio transcription is delegated to srt-service via event-driven architecture. Runs on Cloud Run with auto-scaling.

## Architecture

```mermaid
graph TB
    WhatsApp[WhatsApp Business API] -->|Webhook| WS[WhatsApp Service]

    WS -->|HMAC-SHA256 validation| WV[Webhook Verifier]
    WS --> EventRepo[(Firestore:<br/>whatsapp_webhook_events)]
    WS --> MsgRepo[(Firestore:<br/>whatsapp_messages)]
    WS --> OutboundRepo[(Firestore:<br/>whatsapp_outbound_messages)]
    WS --> MappingRepo[(Firestore:<br/>whatsapp_user_mappings)]
    WS --> VerifyRepo[(Firestore:<br/>whatsapp_phone_verifications)]
    WS --> PubSub[Pub/Sub]

    WS --> MediaStorage[GCS Storage]

    WS -->|command.ingest| CA[Commands Agent]
    WS -->|linkpreview.extract| WA2[Web Agent]
    WS -->|audio.stored| SRT[SRT Service]
    WS -->|action.approval.reply| AA[Actions Agent]

    SRT -->|transcription.completed| WS

    WS -->|Send text/interactive/CTA msg| WhatsApp
```

## Data Flow

### Inbound Message Flow

```mermaid
sequenceDiagram
    autonumber
    participant WA as WhatsApp
    participant WS as WhatsApp Service
    participant FS as Firestore
    participant PS as Pub/Sub
    participant SRT as SRT Service

    WA->>+WS: POST /whatsapp/webhooks
    WS->>WS: Validate HMAC-SHA256 signature
    WS->>WS: Validate WABA ID & Phone Number ID
    WS->>FS: Save webhook_event (status=pending)
    WS->>PS: Publish whatsapp.webhook.process
    WS-->>-WA: 200 OK (fast response)

    Note over WS: Async processing via Pub/Sub

    PS->>+WS: POST /internal/.../process-webhook
    WS->>FS: Lookup user by phone number
    WS->>FS: Save whatsapp_message
    WS->>FS: Update webhook_event (status=completed)

    alt Audio Message
        WS->>PS: Publish whatsapp.audio.stored
        SRT->>SRT: Transcribe audio asynchronously
        SRT->>PS: Publish srt.transcription.completed
        PS->>WS: POST /internal/.../transcription-completed
        WS->>FS: Update message transcription state
        WS->>WA: Send transcription result to user
        WS->>PS: Publish command.ingest (voice)
    else Button Response (Interactive)
        WS->>WA: markAsReadWithTyping (fire-and-forget)
        WS->>WS: Parse buttonId (intent:actionId)
        WS->>PS: Publish action.approval.reply (with actionId, buttonId, buttonTitle)
    else Text Reply to Approval Message
        WS->>FS: Find OutboundMessage by replyToWamid
        WS->>WS: Extract actionId from correlationId
        WS->>PS: Publish action.approval.reply (with actionId)
        Note over WS: Skip command.ingest for approval replies
    else Regular Text Message
        WS->>PS: Publish command.ingest
        WS->>PS: Publish whatsapp.linkpreview.extract
    end

    WS-->>-PS: Ack
```

### Approval Reply Correlation

```mermaid
sequenceDiagram
    autonumber
    participant AA as Actions Agent
    participant WS as WhatsApp Service
    participant WA as WhatsApp
    participant FS as Firestore
    participant User

    AA->>WS: POST /internal/.../send-message
    Note over WS: correlationId: action-todo-approval-{actionId}
    WS->>WA: Send approval request message
    WA-->>WS: Return wamid
    WS->>FS: Save OutboundMessage (wamid, correlationId)
    WS-->>AA: 200 OK with wamid

    User->>WA: Tap button OR reply "yes"

    WA->>WS: Webhook (button or text reply)
    WS->>FS: Find OutboundMessage by wamid
    WS->>WS: Parse correlationId for actionId
    WS->>AA: Publish action.approval.reply (with actionId)
    Note over AA: Process approval with known actionId
```

## Recent Changes

| Commit     | Description                                                       | Date       |
| ---------- | ----------------------------------------------------------------- | ---------- |
| `44ea683a` | Release v3.2.0                                                    | 2026-03-07 |
| `9cd1f458` | Resolve conflicts with development branch                         | 2026-03-07 |
| `d0d38f53` | Refactor: address code review feedback for INT-738                | 2026-03-07 |
| `55b959e6` | feat: add deep link ctaUrl to WhatsApp notifications              | 2026-03-07 |
| `a41ca812` | feat: replace PR URL text with WhatsApp CTA URL buttons           | 2026-03-06 |
| `9e2184ea` | test: add missing test coverage for INT-684 review                | 2026-03-06 |
| `1a71a52e` | fix: address code review feedback for INT-684                     | 2026-03-06 |
| `96ae9463` | INT-684: Migrate from Speechmatics to event-driven transcription  | 2026-03-06 |
| `78214f01` | Fix critical schema gap: add planningPr fields                    | 2026-03-01 |
| `e1c2bcc2` | Fix Implement button + planning PR lifecycle                      | 2026-03-01 |
| `b3f34d85` | Release v3.1.0                                                    | 2026-02-22 |
| `c8a42105` | Release v3.0.0                                                    | 2026-02-19 |
| `6063175b` | Add dev-mode log formatting for PM2 readability                   | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration                               | 2026-02-16 |

## API Endpoints

### Webhook Endpoints

| Method | Path                 | Description                                  | Auth           |
| ------ | -------------------- | -------------------------------------------- | -------------- |
| GET    | `/whatsapp/webhooks` | Webhook verification (returns hub.challenge) | None           |
| POST   | `/whatsapp/webhooks` | Receive webhook events                       | HMAC signature |

### Public Endpoints

| Method | Path                                       | Description                                | Auth         |
| ------ | ------------------------------------------ | ------------------------------------------ | ------------ |
| GET    | `/whatsapp/messages`                       | List user's messages (paginated)           | Bearer token |
| GET    | `/whatsapp/messages/:message_id/media`     | Get signed URL for media                   | Bearer token |
| GET    | `/whatsapp/messages/:message_id/thumbnail` | Get signed URL for thumbnail               | Bearer token |
| DELETE | `/whatsapp/messages/:message_id`           | Delete message                             | Bearer token |
| POST   | `/whatsapp/connect`                        | Connect/update mapping (requires verified) | Bearer token |
| GET    | `/whatsapp/status`                         | Get mapping status                         | Bearer token |
| DELETE | `/whatsapp/disconnect`                     | Disconnect mapping                         | Bearer token |
| POST   | `/whatsapp/verify/send`                    | Send phone verification code               | Bearer token |
| POST   | `/whatsapp/verify/confirm`                 | Confirm verification code                  | Bearer token |
| GET    | `/whatsapp/verify/status/:phone`           | Check phone verification status            | Bearer token |

### Internal Endpoints

| Method | Path                                                | Description                                             | Auth         |
| ------ | --------------------------------------------------- | ------------------------------------------------------- | ------------ |
| POST   | `/internal/whatsapp/pubsub/process-webhook`         | Process webhook or link preview extraction from Pub/Sub | Pub/Sub OIDC |
| POST   | `/internal/whatsapp/pubsub/transcription-completed` | Handle transcription result from srt-service            | Pub/Sub OIDC |
| POST   | `/internal/whatsapp/pubsub/send-message`            | Send WhatsApp message (text, interactive, or CTA)       | Pub/Sub OIDC |
| POST   | `/internal/whatsapp/pubsub/media-cleanup`           | Delete GCS media files                                  | Pub/Sub OIDC |

## Domain Models

### WhatsAppMessage

| Field              | Type                                     | Description                        |
| ------------------ | ---------------------------------------- | ---------------------------------- |
| `id`               | `string`                                 | Unique message identifier          |
| `userId`           | `string`                                 | User who received the message      |
| `waMessageId`      | `string`                                 | WhatsApp message ID                |
| `fromNumber`       | `string`                                 | Sender's phone number              |
| `toNumber`         | `string`                                 | Recipient phone number             |
| `text`             | `string`                                 | Message text (text messages)       |
| `mediaType`        | `'text' \                                | 'image' \                          | 'audio'` | Message type |
| `gcsPath`          | `string \                                | undefined`                         | GCS path to media file |
| `thumbnailGcsPath` | `string \                                | undefined`                         | GCS path to thumbnail |
| `caption`          | `string \                                | undefined`                         | Media caption |
| `transcription`    | `TranscriptionState \                    | undefined`                         | Audio transcription result |
| `linkPreview`      | `LinkPreviewState \                      | undefined`                         | Extracted link metadata |
| `timestamp`        | `string`                                 | WhatsApp timestamp                 |
| `receivedAt`       | `string`                                 | ISO 8601 receive time              |
| `webhookEventId`   | `string`                                 | Associated webhook event           |
| `metadata`         | `WhatsAppMessageMetadata \               | undefined`                         | Additional data (senderName, etc.) |

### OutboundMessage

Tracks sent messages for reply correlation. Uses wamid as document ID for efficient lookups.

| Field           | Type     | Description                                 |
| --------------- | -------- | ------------------------------------------- |
| `wamid`         | `string` | WhatsApp message ID (document ID)           |
| `correlationId` | `string` | Format: `action-{type}-approval-{actionId}` |
| `userId`        | `string` | Target user ID                              |
| `sentAt`        | `string` | ISO 8601 send time                          |
| `expiresAt`     | `number` | Unix timestamp for TTL (7 days)             |

### PhoneVerification

Tracks phone number verification attempts with rate limiting and cooldown.

| Field           | Type                                                         | Description                  |
| --------------- | ------------------------------------------------------------ | ---------------------------- |
| `id`            | `string`                                                     | Unique verification ID       |
| `userId`        | `string`                                                     | User requesting verification |
| `phoneNumber`   | `string`                                                     | Phone number being verified  |
| `code`          | `string`                                                     | 6-digit verification code    |
| `attempts`      | `number`                                                     | Failed attempt count         |
| `status`        | `'pending' \                                                 | 'verified' \                 | 'expired' \ | 'max_attempts'` | Verification progress |
| `createdAt`     | `string`                                                     | ISO 8601 creation time       |
| `expiresAt`     | `number`                                                     | Unix timestamp (10 min TTL)  |
| `lastAttemptAt` | `string \                                                    | undefined`                   | Last failed attempt time |
| `verifiedAt`    | `string \                                                    | undefined`                   | When verification succeeded |

### TranscriptionState

| Field         | Type                                                         | Description               |
| ------------- | ------------------------------------------------------------ | ------------------------- |
| `status`      | `'pending' \                                                 | 'processing' \            | 'completed' \ | 'failed'` | Transcription progress |
| `jobId`       | `string \                                                    | undefined`                | Provider job ID |
| `text`        | `string \                                                    | undefined`                | Full transcribed text |
| `summary`     | `string \                                                    | undefined`                | AI-generated key points |
| `error`       | `TranscriptionError \                                        | undefined`                | Error details if failed |
| `startedAt`   | `string \                                                    | undefined`                | When processing started |
| `completedAt` | `string \                                                    | undefined`                | When completed or failed |

### WebhookEvent

| Field            | Type                                                                              | Description                   |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| `id`             | `string`                                                                          | Unique event ID               |
| `payload`        | `unknown`                                                                         | Raw webhook payload           |
| `signatureValid` | `boolean`                                                                         | Signature verification result |
| `receivedAt`     | `string`                                                                          | ISO 8601 timestamp            |
| `phoneNumberId`  | `string \                                                                         | null`                         | WhatsApp phone number ID |
| `status`         | `'pending' \                                                                      | 'completed' \                 | 'failed' \ | 'ignored' \ | 'user_unmapped'` | Processing status |

### UserMapping

| Field          | Type       | Description              |
| -------------- | ---------- | ------------------------ |
| `userId`       | `string`   | User ID                  |
| `phoneNumbers` | `string[]` | Associated phone numbers |
| `connected`    | `boolean`  | Connection status        |
| `createdAt`    | `string`   | ISO 8601 creation time   |
| `updatedAt`    | `string`   | ISO 8601 update time     |

## Pub/Sub Events

### Published Events

| Event Type                     | Topic                      | Purpose                                    |
| ------------------------------ | -------------------------- | ------------------------------------------ |
| `whatsapp.webhook.process`     | `whatsapp-webhook-process` | Async webhook processing                   |
| `whatsapp.media.cleanup`       | `whatsapp-media-cleanup`   | Media deletion                             |
| `whatsapp.audio.stored`        | `whatsapp-audio-stored`    | Audio stored in GCS, triggers srt-service  |
| `whatsapp.linkpreview.extract` | `whatsapp-linkpreview`     | Link preview extraction via web-agent      |
| `command.ingest`               | `command-ingest`           | Command processing (text and voice)        |
| `action.approval.reply`        | `action-approval-reply`    | Approval response                          |

### Subscribed Events

| Event Type                     | Handler                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `whatsapp.webhook.process`     | `/internal/whatsapp/pubsub/process-webhook`               |
| `whatsapp.linkpreview.extract` | `/internal/whatsapp/pubsub/process-webhook`               |
| `srt.transcription.completed`  | `/internal/whatsapp/pubsub/transcription-completed`       |
| `whatsapp.message.send`        | `/internal/whatsapp/pubsub/send-message`                  |
| `whatsapp.media.cleanup`       | `/internal/whatsapp/pubsub/media-cleanup`                 |

### ApprovalReplyEvent

```typescript
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string; // Original approval message wamid
  replyText: string; // "yes"/"no"/"convert"/"cancel-task"/"view-task"/"proceed-implementation"
  userId: string;
  timestamp: string;
  actionId?: string; // Extracted from buttonId or correlationId
  buttonId?: string; // Button ID for interactive button clicks
  buttonTitle?: string; // Button title for interactive button clicks
}
```

## Dependencies

### Firestore Collections

| Collection                     | Purpose                             | Owner            |
| ------------------------------ | ----------------------------------- | ---------------- |
| `whatsapp_messages`            | Message persistence                 | whatsapp-service |
| `whatsapp_webhook_events`      | Webhook event log                   | whatsapp-service |
| `whatsapp_user_mappings`       | Phone number mappings               | whatsapp-service |
| `whatsapp_outbound_messages`   | Outbound message tracking           | whatsapp-service |
| `whatsapp_phone_verifications` | Phone verification records          | whatsapp-service |

### External APIs

| Service            | Purpose                       |
| ------------------ | ----------------------------- |
| WhatsApp Cloud API | Media download, send messages |

### Internal Services

| Service        | Endpoint/Topic          | Purpose                                  |
| -------------- | ----------------------- | ---------------------------------------- |
| actions-agent  | `action-approval-reply` | Process approval responses               |
| commands-agent | `command-ingest`        | Command classification                   |
| web-agent      | Internal HTTP API       | Link preview Open Graph metadata         |
| srt-service    | `whatsapp-audio-stored` | Audio transcription (event-driven)       |

## Configuration

| Environment Variable                           | Required | Description                                     |
| ---------------------------------------------- | -------- | ----------------------------------------------- |
| `INTEXURAOS_WHATSAPP_APP_SECRET`               | Yes      | WhatsApp app secret for signature validation    |
| `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`             | Yes      | Webhook verification token                      |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`             | Yes      | WhatsApp Graph API access token                 |
| `INTEXURAOS_WHATSAPP_WABA_ID`                  | Yes      | Allowed WABA IDs (comma-separated)              |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`          | Yes      | Allowed phone number IDs (comma-separated)      |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`             | Yes      | GCS bucket for media storage                    |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`        | Yes      | Media cleanup Pub/Sub topic                     |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION` | Yes      | Media cleanup subscription                      |
| `INTEXURAOS_GCP_PROJECT_ID`                    | Yes      | Google Cloud project ID                         |
| `INTEXURAOS_WEB_AGENT_URL`                     | Yes      | Web-agent URL for link preview extraction       |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`               | Yes      | Shared secret for internal endpoints            |
| `INTEXURAOS_USER_SERVICE_URL`                  | Yes      | User service URL for user lookup                |
| `INTEXURAOS_AUTH_JWKS_URL`                     | Yes      | JWKS URL for JWT validation                     |
| `INTEXURAOS_AUTH_ISSUER`                       | Yes      | JWT issuer for token validation                 |
| `INTEXURAOS_AUTH_AUDIENCE`                     | Yes      | JWT audience for token validation               |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`      | Yes      | Commands ingest topic                           |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`        | Yes      | Send message topic                              |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`      | Yes      | Webhook processing topic                        |
| `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`         | Yes      | Audio stored event topic (triggers srt-service) |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`       | Yes      | Approval reply topic                            |

## Gotchas

### Webhook Signature Validation

Uses HMAC-SHA256 with app secret. Must validate before any processing. Signature is in `X-Hub-Signature-256` header. Uses timing-safe comparison to prevent timing attacks.

### Reply Correlation Pattern

When sending approval messages, use correlationId format: `action-{type}-approval-{actionId}`. This pattern is parsed by whatsapp-service to extract the actionId when processing text replies.

### Preventing Duplicate Actions

When a text message is a reply to an approval message with a known actionId, the service:

1. Publishes `action.approval.reply` with the actionId
2. Skips publishing `command.ingest`

This prevents the same reply from creating duplicate actions through both approval and command flows.

### Interactive Button Format

Approval messages use interactive buttons. Button ID format encodes intent and action ID:

- `approve:{actionId}` — Approve action
- `cancel:{actionId}` — Cancel/reject action
- `reject:{actionId}` — Explicitly reject action
- `convert:{actionId}` — Convert action to different type
- `cancel-task:{taskId}` — Cancel a running code task
- `view-task:{taskId}` — View task status
- `proceed-implementation:{taskId}` — Proceed with implementation

Button titles are truncated to 20 characters (WhatsApp API limit).

### CTA URL Messages

When `ctaUrl` is provided in a `SendMessageEvent`, the message is sent as a WhatsApp CTA URL message with a clickable button that opens a link in the user's browser. CTA URL messages and interactive reply buttons are mutually exclusive (WhatsApp API constraint).

### Read Receipts on Button Click

When a user taps an interactive button, whatsapp-service fires `markAsReadWithTyping` before publishing the approval event. This shows the user blue checkmarks and a typing indicator immediately. The call is fire-and-forget and does not block event publishing.

### Emoji Reactions No Longer Supported

Emoji reactions no longer trigger approval events. Reactions are marked as `ignored` with status code `REACTION_NOT_SUPPORTED`. Use interactive buttons instead.

### Phone Verification Flow

Phone numbers must be verified before connecting via `/whatsapp/connect`. The verification flow:

1. `POST /whatsapp/verify/send` sends a 6-digit code via WhatsApp
2. `POST /whatsapp/verify/confirm` validates the code
3. Once verified, `POST /whatsapp/connect` accepts the phone number

Rate limits: 3 requests per phone per hour, 60-second cooldown between requests. Codes expire after 10 minutes. Maximum 3 incorrect attempts before lockout.

### Event-Driven Transcription (INT-684)

Audio transcription is fully event-driven. The whatsapp-service no longer calls any transcription provider directly. Instead:

1. Audio is downloaded from WhatsApp and stored in GCS
2. `whatsapp.audio.stored` event is published to Pub/Sub
3. srt-service picks up the event and handles transcription
4. srt-service publishes `srt.transcription.completed` when done
5. whatsapp-service receives the completed event and updates the message, sends the transcript to the user, and publishes `command.ingest`

### `extractButtonResponse()` Accepts Both Button Types

WhatsApp sends `interactive.type = "button_reply"` for button clicks in practice, but the WhatsApp API documentation also describes `"button"`. The `extractButtonResponse()` function (in `routes/shared.ts`) accepts both formats to handle API inconsistencies.

### OutboundMessage TTL

Messages in `whatsapp_outbound_messages` expire after 7 days via Firestore TTL policy. Ensure the policy is configured on the `expiresAt` field.

### GCS Path Format

- Media: `whatsapp-media/{userId}/{messageId}.{extension}`
- Thumbnails: `whatsapp-media/{userId}/thumbnails/{messageId}.jpg`

### Signed URL Expiry

Media URLs expire after 15 minutes. Clients should regenerate via GET endpoint when needed.

### User Unmapped Handling

Messages from unknown phone numbers are marked `user_unmapped` but not failed. This allows tracking without losing data.

### Language-Aware Transcription Messages

When sending transcription results back to users, the service uses language-specific intro phrases for summaries. Polish (`pl`) audio gets a Polish intro phrase; all other languages get English. Markdown headers in summaries are stripped before sending since WhatsApp does not render markdown headers.

## File Structure

```
apps/whatsapp-service/src/
  domain/
    whatsapp/
      ports/
        eventPublisher.ts
        messageSender.ts              # sendTextMessage, sendInteractiveMessage, sendCtaUrlMessage
        outboundMessageRepository.ts
        repositories.ts               # PhoneVerificationRepository
        whatsappCloudApi.ts           # markAsReadWithTyping
        linkPreviewFetcher.ts
        mediaStorage.ts
        thumbnailGenerator.ts
      usecases/
        processAudioMessage.ts        # Download + store audio in GCS
        processImageMessage.ts        # Download + thumbnail + store image
        handleTranscriptionCompleted.ts  # Handle srt-service transcription result
        extractLinkPreviews.ts        # Open Graph metadata extraction
      events/
        events.ts                     # AudioStoredEvent, ApprovalReplyEvent, etc.
      models/
        WhatsAppMessage.ts
        PhoneVerification.ts
        LinkPreview.ts
        error.ts                      # ALREADY_VERIFIED, COOLDOWN_ACTIVE, RATE_LIMIT_EXCEEDED
      utils/
        phoneNumber.ts
        mimeType.ts
        logger.ts
  infra/
    firestore/
      webhookEventRepository.ts
      messageRepository.ts
      userMappingRepository.ts
      outboundMessageRepository.ts
      phoneVerificationRepository.ts
    gcs/
      mediaStorageAdapter.ts
    whatsapp/
      cloudApiAdapter.ts              # markAsReadWithTyping
      sender.ts                       # sendInteractiveMessage, sendCtaUrlMessage
    media/
      thumbnailGenerator.ts
      thumbnailAdapter.ts
    linkpreview/
      webAgentLinkPreviewClient.ts
    pubsub/
      publisher.ts
  routes/
    webhookRoutes.ts                  # Button handling, reject intent, proceed-implementation
    messageRoutes.ts
    mappingRoutes.ts                  # Verification-gated connect
    pubsubRoutes.ts                   # send-message, media-cleanup, transcription-completed, process-webhook
    verificationRoutes.ts
    shared.ts                         # extractButtonResponse (button/button_reply fix)
    schemas.ts
    routes.ts
  signature.ts
  adapters.ts                         # PhoneVerificationRepositoryAdapter
  config.ts
  services.ts                         # phoneVerificationRepository, linkPreviewFetcher in ServiceContainer
  server.ts
  index.ts
```
