# whatsapp-service — Agent Interface

> Machine-readable specification for AI agent integration

---

## Identity

| Field    | Value                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------- |
| **Name** | whatsapp-service                                                                                     |
| **Role** | WhatsApp integration layer — receives inbound messages, sends outbound messages and approvals        |
| **Goal** | Enable mobile-first command capture, two-way approval workflows, and rich notifications via WhatsApp |

---

## Capabilities

### Send Plain Text Message

**Interface:** Pub/Sub — publish to `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`

**When to use:** Notify a user of a completed action, status update, or informational message.

**Input Schema:**

```typescript
interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string;        // IntexuraOS user ID — phone number looked up internally
  message: string;       // Message text
  correlationId: string; // Unique ID for tracking; arbitrary format for plain notifications
  timestamp: string;     // ISO 8601
}
```

**Example:**

```json
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "Your research task is complete.",
  "correlationId": "research-done-res-456",
  "timestamp": "2026-03-07T10:30:00Z"
}
```

---

### Send CTA URL Message

**Interface:** Pub/Sub — publish to `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`

**When to use:** Send a notification with a clickable button that opens a URL in the user's browser.

**Input Schema:**

```typescript
interface SendCtaUrlEvent {
  type: 'whatsapp.message.send';
  userId: string;
  message: string;
  ctaUrl: {
    displayText: string; // Button label shown to user
    url: string;         // URL to open on tap
  };
  correlationId: string;
  timestamp: string;
}
```

**Example:**

```json
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "PR #42 ready for review",
  "ctaUrl": { "displayText": "View PR", "url": "https://github.com/org/repo/pull/42" },
  "correlationId": "pr-ready-pr-42",
  "timestamp": "2026-03-07T10:30:00Z"
}
```

---

### Send Approval Request with Buttons

**Interface:** Pub/Sub — publish to `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`

**When to use:** Request user approval for an action. User can tap a button or reply with text.

**Input Schema:**

```typescript
interface SendApprovalEvent {
  type: 'whatsapp.message.send';
  userId: string;
  message: string;
  buttons: WhatsAppInteractiveButton[];
  correlationId: string; // MUST use format: action-{type}-approval-{actionId}
  timestamp: string;
}

interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;     // Format: "intent:actionId" (e.g., "approve:act-123")
    title: string;  // Max 20 characters
  };
}
```

**Button ID intents:**

| ID Format                         | Meaning                          |
| --------------------------------- | -------------------------------- |
| `approve:{actionId}`              | Approve the action               |
| `cancel:{actionId}`               | Cancel/reject the action         |
| `reject:{actionId}`               | Explicitly reject                |
| `convert:{actionId}`              | Convert to different type        |
| `cancel-task:{taskId}`            | Cancel a running code task       |
| `view-task:{taskId}`              | View task status                 |
| `proceed-implementation:{taskId}` | Proceed with implementation      |

**Example:**

```json
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "Create todo: 'Review quarterly report'?",
  "buttons": [
    { "type": "reply", "reply": { "id": "approve:act-xyz-789", "title": "Approve" } },
    { "type": "reply", "reply": { "id": "cancel:act-xyz-789", "title": "Cancel" } }
  ],
  "correlationId": "action-todo-approval-act-xyz-789",
  "timestamp": "2026-03-07T10:30:00Z"
}
```

---

### Receive Approval Reply

**Interface:** Pub/Sub — subscribe to `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`

**When to use:** After sending an approval request. This event fires when the user taps a button or replies with text.

**Output Schema:**

```typescript
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string;  // wamid of the original approval message
  replyText: string;     // Normalized intent: "yes" | "no" | "convert" | "cancel-task" | "view-task" | "proceed-implementation"
  userId: string;
  timestamp: string;
  actionId?: string;     // Extracted from buttonId (button tap) or correlationId (text reply)
  buttonId?: string;     // Present only for button taps
  buttonTitle?: string;  // Present only for button taps
}
```

**Response type mapping:**

| Response              | `replyText`                | `buttonId`                    | `actionId`         |
| --------------------- | -------------------------- | ----------------------------- | ------------------ |
| Button "Approve"      | `"yes"`                    | `"approve:act-123"`           | `"act-123"`        |
| Button "Cancel"       | `"no"`                     | `"cancel:act-123"`            | `"act-123"`        |
| Button "Reject"       | `"no"`                     | `"reject:act-123"`            | `"act-123"`        |
| Button "Proceed"      | `"proceed-implementation"` | `"proceed-implementation:id"` | from buttonId      |
| Text reply            | raw text                   | undefined                     | from correlationId |
| Emoji reaction        | not published              | not published                 | —                  |

---

### Receive Command from User

**Interface:** Pub/Sub — subscribe to `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`

**When to use:** When a user sends a text or voice message that should be classified and acted upon.

**Output Schema:**

```typescript
interface CommandIngestEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: 'whatsapp_text' | 'whatsapp_voice';
  externalId: string;  // WhatsApp message ID
  text: string;        // Message text or transcription
  summary?: string;    // AI-generated summary (voice messages only)
  timestamp: string;
}
```

---

### List User Messages

**Endpoint:** `GET /whatsapp/messages`

**Auth:** Bearer token

**When to use:** Retrieve a user's WhatsApp message history.

**Query params:**

```typescript
interface ListMessagesParams {
  limit?: number;  // 1–100, default 50
  cursor?: string; // Pagination cursor
}
```

**Output Schema:**

```typescript
interface MessagesListResult {
  messages: WhatsAppMessageSummary[];
  fromNumber: string | null; // User's registered phone number
  nextCursor?: string;       // Present if more results exist
}

interface WhatsAppMessageSummary {
  id: string;
  text: string;
  fromNumber: string;
  timestamp: string;
  receivedAt: string;
  mediaType: 'text' | 'image' | 'audio';
  hasMedia: boolean;
  caption?: string;
  transcriptionStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  transcription?: string;
  linkPreview?: LinkPreviewState;
}
```

---

### Get Media Signed URL

**Endpoint:** `GET /whatsapp/messages/:message_id/media`

**Auth:** Bearer token

**When to use:** Access the original media file for a message with `hasMedia: true`.

**Output Schema:**

```typescript
interface SignedUrlResult {
  url: string;       // GCS signed URL, valid for 15 minutes
  expiresAt: string; // ISO 8601 expiry time
}
```

---

### Get Thumbnail Signed URL

**Endpoint:** `GET /whatsapp/messages/:message_id/thumbnail`

**Auth:** Bearer token

**When to use:** Access the thumbnail for an image message (256px max edge).

**Output Schema:**

```typescript
interface SignedUrlResult {
  url: string;
  expiresAt: string;
}
```

---

## Key Types

```typescript
type MediaType = 'text' | 'image' | 'audio';
type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';
type LinkPreviewStatus = 'pending' | 'completed' | 'failed';
type PhoneVerificationStatus = 'pending' | 'verified' | 'expired' | 'max_attempts';

interface TranscriptionState {
  status: TranscriptionStatus;
  jobId?: string;
  text?: string;
  summary?: string; // AI-generated key points — lives on transcription, NOT on WhatsAppMessage directly
  error?: { code: string; message: string };
  startedAt?: string;
  completedAt?: string;
}

interface LinkPreviewState {
  status: LinkPreviewStatus;
  previews?: LinkPreview[];
  error?: { code: 'FETCH_FAILED' | 'PARSE_FAILED' | 'TIMEOUT' | 'TOO_LARGE'; message: string };
}

interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

interface OutboundMessage {
  wamid: string;         // WhatsApp message ID (document ID in Firestore)
  correlationId: string; // Format: action-{type}-approval-{actionId} for approvals
  userId: string;
  sentAt: string;
  expiresAt: number;     // Unix timestamp — documents expire after 7 days
}
```

---

## Constraints

**Do NOT:**

- Provide both `buttons` and `ctaUrl` in the same `SendMessageEvent` — they are mutually exclusive
- Expect emoji reactions to trigger `action.approval.reply` — reactions are silently ignored
- Rely on OutboundMessage correlation after 7 days — records expire via Firestore TTL
- Call `POST /whatsapp/connect` without first verifying the phone number via the verification flow

**Requires:**

- User must have a verified and connected WhatsApp phone number (`GET /whatsapp/status` returns `connected: true`) before messages can be delivered
- Approval correlationId MUST match `action-{type}-approval-{actionId}` for text-reply correlation to work
- Button titles must be 20 characters or fewer

---

## Usage Patterns

### Pattern 1: Send Notification

```
1. Publish SendMessageEvent (no buttons, no ctaUrl) to INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC
2. whatsapp-service looks up phone number for userId
3. Message sent via WhatsApp Cloud API
4. No response expected
```

### Pattern 2: Send Deep Link

```
1. Publish SendMessageEvent with ctaUrl to INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC
2. whatsapp-service sends CTA URL message with clickable button
3. User taps button — link opens in browser
4. No approval event published
```

### Pattern 3: Request Approval

```
1. Publish SendMessageEvent with buttons and correlationId: action-{type}-approval-{actionId}
2. whatsapp-service sends interactive message and saves OutboundMessage (wamid, correlationId)
3. User taps button OR replies with text
4. whatsapp-service publishes ApprovalReplyEvent to INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC
   — button tap: fires read receipt + typing indicator first (fire-and-forget)
5. Your service receives event with actionId and optional buttonId
6. Process approval/rejection based on replyText or buttonId
```

### Pattern 4: Access Message Media

```
1. GET /whatsapp/messages — find message with hasMedia: true
2. GET /whatsapp/messages/:id/media — get signed URL (valid 15 min)
3. GET /whatsapp/messages/:id/thumbnail — get thumbnail URL (images only)
4. Use URL before expiry; regenerate if needed
```

### Pattern 5: Phone Verification + Connect

```
1. POST /whatsapp/verify/send — sends 6-digit OTP via WhatsApp
2. POST /whatsapp/verify/confirm — validates code; marks phone verified
3. POST /whatsapp/connect — links verified phone to user account
```

---

## Events Consumed

| Event                         | Topic env var                              | Purpose                         |
| ----------------------------- | ------------------------------------------ | ------------------------------- |
| `whatsapp.message.send`       | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | Send outbound WhatsApp message  |
| `srt.transcription.completed` | (from srt-service subscription)            | Receive transcription results   |
| `whatsapp.webhook.process`    | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | Async webhook processing        |
| `whatsapp.media.cleanup`      | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | GCS media deletion              |

## Events Published

| Event                          | Topic env var                              | Purpose                              |
| ------------------------------ | ------------------------------------------ | ------------------------------------ |
| `action.approval.reply`        | `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | User responded to approval           |
| `command.ingest`               | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | Text/voice message for processing    |
| `whatsapp.audio.stored`        | `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`     | Audio ready for transcription        |
| `whatsapp.linkpreview.extract` | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | URLs found for preview extraction    |
| `whatsapp.media.cleanup`       | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | Media deletion requested             |

---

## Error Handling

| Error Code            | Meaning                                 | Recovery Action                       |
| --------------------- | --------------------------------------- | ------------------------------------- |
| `NOT_FOUND`           | Message not found or not owned by user  | Verify message ID and ownership       |
| `DOWNSTREAM_ERROR`    | Failed to communicate with WhatsApp/GCS | Retry with exponential backoff        |
| `PRECONDITION_FAILED` | Phone number not verified               | Complete verification flow first      |
| `CONFLICT`            | Phone already verified or mapped        | No action needed                      |
| `RATE_LIMITED`        | Too many verification requests          | Wait for cooldown or rate limit reset |
| `LOCKED`              | Max verification attempts exceeded      | Request a new verification code       |
| `GONE`                | Verification code expired               | Request a new verification code       |

---

## Rate Limits (Coded)

| Operation            | Limit           | Window      |
| -------------------- | --------------- | ----------- |
| Verify send          | 3 per phone     | 1 hour      |
| Verify send cooldown | 60 seconds      | Per request |
| Verify confirm       | 3 attempts      | Per code    |

---

## Dependencies

| Service      | Why Needed                  | Failure Behavior            |
| ------------ | --------------------------- | --------------------------- |
| WhatsApp API | Send/receive messages       | Message delivery fails      |
| srt-service  | Audio transcription         | Transcription stays pending |
| web-agent    | Link preview extraction     | Link preview stays pending  |
| GCS          | Media storage               | Media requests fail         |

---

**Last updated:** 2026-03-15
