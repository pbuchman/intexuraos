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
  important?: boolean;   // When true, delivery bypasses 'important'-only notification filter
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

**Link rule:** Use canonical public URLs. For IntexuraOS APIs, that means public resource paths such as `/api/code/...` or `/api/whatsapp/...`; do not publish doubled service paths such as `/api/whatsapp/whatsapp/...`.

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
  important?: boolean;   // When true, delivery bypasses 'important'-only filter
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
  "important": true,
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
  important?: boolean;   // Should be true for approvals — they require user action
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
  "important": true,
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

**Reliability note:** whatsapp-service treats command ingestion as required for text/bookmark flows. If `command.ingest` publishing fails, the webhook event is marked `failed` with `retryable: true` so it can be replayed by the retry-pending recovery endpoint.

---

### Retry Pending WhatsApp Webhook Events

**Endpoint:** `POST /internal/whatsapp/webhooks/retry-pending`

**Auth:** Internal scheduler auth

**When to use:** Recover persisted WhatsApp webhook events that stayed `pending` after async processing or failed with `retryable: true`.

**Input Schema:**

```typescript
interface RetryPendingWebhookEventsInput {
  eventIds?: string[];
  limit?: number; // 1-100, default 50
  olderThanSeconds?: number; // default 120
  dryRun?: boolean;
}
```

**Output Schema:**

```typescript
interface RetryPendingWebhookEventsResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  events: Array<{
    eventId: string;
    outcome: 'processed' | 'skipped' | 'failed';
    status?: string;
    reason?: string;
  }>;
}
```

---

### List User Messages

**Endpoint:** `GET /messages`

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

**Endpoint:** `GET /messages/:message_id/media`

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

**Endpoint:** `GET /messages/:message_id/thumbnail`

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

### Get Notification Preferences

**Endpoint:** `GET /preferences`

**Auth:** Bearer token

**When to use:** Read the authenticated user's notification level.

**Output Schema:**

```typescript
interface PreferencesResult {
  notificationLevel: 'all' | 'important';
}
```

---

### Update Notification Preferences

**Endpoint:** `PUT /preferences`

**Auth:** Bearer token

**When to use:** Change the authenticated user's notification level. Set to `important` to suppress non-important messages.

**Input Schema:**

```typescript
interface UpdatePreferencesInput {
  notificationLevel: 'all' | 'important';
}
```

**Output Schema:**

```typescript
interface PreferencesResult {
  notificationLevel: 'all' | 'important';
}
```

---

## Key Types

```typescript
type MediaType = 'text' | 'image' | 'audio';
type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';
type LinkPreviewStatus = 'pending' | 'completed' | 'failed';
type PhoneVerificationStatus = 'pending' | 'verified' | 'expired' | 'max_attempts';
type NotificationLevel = 'all' | 'important';

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

interface NotificationPreferences {
  notificationLevel: NotificationLevel; // Default: 'all'
}
```

---

## Constraints

**Do NOT:**

- Provide both `buttons` and `ctaUrl` in the same `SendMessageEvent` — they are mutually exclusive
- Expect emoji reactions to trigger `action.approval.reply` — reactions are silently ignored
- Rely on OutboundMessage correlation after 7 days — records expire via Firestore TTL
- Call `POST /connect` without first verifying the phone number via the verification flow
- Assume messages without `important: true` will be delivered — the user may have set their notification level to `important`

**Requires:**

- User must have a verified and connected WhatsApp phone number (`GET /status` returns `connected: true`) before messages can be delivered
- Approval correlationId MUST match `action-{type}-approval-{actionId}` for text-reply correlation to work
- Button titles must be 20 characters or fewer
- Set `important: true` on approval requests and critical notifications to ensure delivery regardless of notification level

---

## Usage Patterns

### Pattern 1: Send Notification

```
1. Publish SendMessageEvent (no buttons, no ctaUrl) to INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC
2. whatsapp-service looks up phone number for userId
3. whatsapp-service checks notification preferences — drops if level=important and important is falsy
4. Message sent via WhatsApp Cloud API
5. No response expected
```

### Pattern 2: Send Deep Link

```
1. Publish SendMessageEvent with ctaUrl to INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC
2. whatsapp-service checks notification preferences (set important: true for actionable links)
3. whatsapp-service sends CTA URL message with clickable button
4. User taps button — link opens in browser
5. No approval event published
```

### Pattern 3: Request Approval

```
1. Publish SendMessageEvent with buttons, important: true, and correlationId: action-{type}-approval-{actionId}
2. whatsapp-service sends interactive message and saves OutboundMessage (wamid, correlationId)
3. User taps button OR replies with text
4. whatsapp-service publishes ApprovalReplyEvent to INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC
   — button tap: fires read receipt + typing indicator first (fire-and-forget)
5. Your service receives event with actionId and optional buttonId
6. Process approval/rejection based on replyText or buttonId
```

### Pattern 4: Access Message Media

```
1. GET /messages — find message with hasMedia: true
2. GET /messages/:id/media — get signed URL (valid 15 min)
3. GET /messages/:id/thumbnail — get thumbnail URL (images only)
4. Use URL before expiry; regenerate if needed
```

### Pattern 5: Phone Verification + Connect

```
1. POST /verify/send — sends 6-digit OTP via WhatsApp
2. POST /verify/confirm — validates code; marks phone verified
3. POST /connect — links verified phone to user account
```

### Pattern 6: Manage Notification Preferences

```
1. GET /preferences — read current notification level
2. PUT /preferences — set to 'all' or 'important'
3. When level is 'important', only SendMessageEvents with important: true are delivered
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

## Pub/Sub Alias Notes

Use the env var contract in service integrations. In the PM2 dev environment, the fallback topic names are emulator aliases: `whatsapp-send-message`, `whatsapp-media-cleanup`, `whatsapp-webhook-process`, `whatsapp-transcription`, `commands-ingest`, and `approval-reply`. Do not assume those aliases are retained GCP/Terraform topic names.

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

**Last updated:** 2026-04-22
