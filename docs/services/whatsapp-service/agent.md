# whatsapp-service - Agent Interface

> Machine-readable interface definition for AI agents interacting with whatsapp-service.

---

## Identity

| Field    | Value                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ |
| **Name** | whatsapp-service                                                                                 |
| **Role** | WhatsApp Integration Service with Approval Workflow and Event-Driven Transcription               |
| **Goal** | Receive WhatsApp messages, enable approval via buttons/replies, send notifications and CTA links |

---

## Capabilities

### Send Message

**Endpoint:** Pub/Sub topic `whatsapp-message-send`

**When to use:** When you need to send a WhatsApp message to a user

**Input Schema:**

```typescript
interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string; // IntexuraOS user ID (phone number looked up internally)
  message: string; // Message text to send
  replyToMessageId?: string; // Optional: WhatsApp message ID to reply to
  buttons?: WhatsAppInteractiveButton[]; // Optional: interactive buttons
  ctaUrl?: { displayText: string; url: string }; // Optional: CTA URL button (mutually exclusive with buttons)
  correlationId: string; // For tracking; use approval format for approvals
  timestamp: string; // ISO 8601
}

interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string; // Format: "intent:actionId"
    title: string; // Max 20 characters (truncated by WhatsApp API)
  };
}
```

**Example (plain text):**

```json
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "Your research is ready: https://...",
  "correlationId": "research-complete-res-456",
  "timestamp": "2026-03-07T10:30:00Z"
}
```

**Example (CTA URL):**

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

### Send Approval Request with Buttons

**Endpoint:** Pub/Sub topic `whatsapp-message-send`

**When to use:** When you need user approval for an action

**Button ID Format:**

```
approve:{actionId}              -- Approve
cancel:{actionId}               -- Cancel/reject
reject:{actionId}               -- Explicitly reject
convert:{actionId}              -- Convert to different type
cancel-task:{taskId}            -- Cancel running task
view-task:{taskId}              -- View task status
proceed-implementation:{taskId} -- Proceed with implementation
```

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

### List User Messages

**Endpoint:** `GET /whatsapp/messages`

**When to use:** When you need to retrieve a user's WhatsApp message history

**Input Schema:**

```typescript
interface ListMessagesParams {
  limit?: number; // Max 100, default 50
  cursor?: string; // Pagination cursor
}
```

**Output Schema:**

```typescript
interface MessagesListResult {
  messages: WhatsAppMessage[];
  fromNumber: string | null; // User's registered phone number
  nextCursor?: string; // For pagination
}
```

### Get Media URL

**Endpoint:** `GET /whatsapp/messages/:messageId/media`

**When to use:** When you need to access the original media file

**Output Schema:**

```typescript
interface SignedUrlResult {
  url: string; // GCS signed URL
  expiresAt: string; // ISO 8601, valid for 15 minutes
}
```

### Get Thumbnail URL

**Endpoint:** `GET /whatsapp/messages/:messageId/thumbnail`

**When to use:** When you need a preview image (256px max edge)

**Output Schema:**

```typescript
interface SignedUrlResult {
  url: string;
  expiresAt: string;
}
```

---

## Types

```typescript
type MediaType = 'text' | 'image' | 'audio';
type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';
type LinkPreviewStatus = 'pending' | 'completed' | 'failed';

interface WhatsAppMessage {
  id: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  text: string;
  timestamp: string;
  receivedAt: string;
  mediaType: MediaType;
  hasMedia: boolean;
  caption?: string;
  transcriptionStatus?: TranscriptionStatus;
  transcription?: string;
  summary?: string; // AI-generated key points from transcription
  linkPreview?: {
    status: LinkPreviewStatus;
    previews?: LinkPreviewData[];
    error?: { code: string; message: string };
  };
  metadata?: {
    senderName?: string;
    phoneNumberId?: string;
  };
}

interface OutboundMessage {
  wamid: string; // WhatsApp message ID
  correlationId: string; // For reply correlation
  userId: string;
  sentAt: string;
  expiresAt: number; // Unix timestamp (7 day TTL)
}

interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string; // Original approval message wamid
  replyText: string; // "yes"/"no"/"convert"/"cancel-task"/"view-task"/"proceed-implementation"
  userId: string;
  timestamp: string;
  actionId?: string; // Extracted from buttonId or correlationId
  buttonId?: string; // Button ID if user tapped a button
  buttonTitle?: string; // Button title if user tapped a button
}

interface AudioStoredEvent {
  type: 'whatsapp.audio.stored';
  userId: string;
  messageId: string;
  mediaId: string;
  gcsPath: string;
  mimeType: string;
  timestamp: string;
}

interface TranscriptionCompletedEvent {
  type: 'srt.transcription.completed';
  userId: string;
  messageId: string;
  jobId: string;
  status: 'completed' | 'failed';
  transcript?: string;
  summary?: string;
  detectedLanguage?: string;
  error?: string;
  timestamp: string;
}
```

---

## Constraints

| Rule                    | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| **Phone Number Mapped** | User must have WhatsApp number registered                         |
| **Media Expiration**    | Signed URLs expire after 15 minutes                               |
| **Ownership**           | Users can only access their own messages                          |
| **Pagination**          | Maximum 100 messages per request                                  |
| **OutboundMessage TTL** | Reply correlation data expires after 7 days                       |
| **Approval Format**     | CorrelationId MUST match `action-{type}-approval-{id}`            |
| **Button Title Limit**  | Button titles truncated to 20 characters                          |
| **Phone Verification**  | Phone must be verified before connecting via `/whatsapp/connect`  |
| **No Emoji Reactions**  | Emoji reactions are ignored; use buttons or text replies (v4.0.0) |
| **CTA vs Buttons**      | `ctaUrl` and `buttons` are mutually exclusive                     |

---

## Usage Patterns

### Pattern 1: Send Notification

```
1. Publish SendMessageEvent to whatsapp-message-send topic
2. WhatsApp-service looks up phone number for userId
3. Message sent via WhatsApp Cloud API
4. No response expected
```

### Pattern 2: Send CTA Link

```
1. Publish SendMessageEvent with ctaUrl to whatsapp-message-send topic
2. WhatsApp-service sends CTA URL message with clickable button
3. User taps button -> link opens in browser
4. No approval event published
```

### Pattern 3: Request Approval with Buttons

```
1. Publish SendMessageEvent with buttons and correlationId: action-{type}-approval-{actionId}
2. WhatsApp-service sends interactive message and saves OutboundMessage
3. User taps button OR replies with text
4. WhatsApp-service publishes ApprovalReplyEvent to action-approval-reply topic
   - On button tap: also fires read receipt + typing indicator (fire-and-forget)
5. Your service receives event with actionId and optional buttonId
6. Process approval/rejection based on replyText or buttonId
```

### Pattern 4: Access Message Media

```
1. GET /whatsapp/messages to list messages
2. Find message with hasMedia: true
3. GET /whatsapp/messages/:id/media for original
4. GET /whatsapp/messages/:id/thumbnail for preview (images only)
5. Use signed URL within 15 minutes
```

---

## Events Consumed

| Event                          | Topic                          | Purpose                            |
| ------------------------------ | ------------------------------ | ---------------------------------- |
| `whatsapp.message.send`        | whatsapp-message-send          | Send outbound WhatsApp message     |
| `srt.transcription.completed`  | srt-transcription-completed    | Receive transcription results      |

## Events Published

| Event                          | Topic                      | Purpose                              |
| ------------------------------ | -------------------------- | ------------------------------------ |
| `action.approval.reply`        | action-approval-reply      | User responded to approval           |
| `command.ingest`               | command-ingest             | Text/voice message for processing    |
| `whatsapp.audio.stored`        | whatsapp-audio-stored      | Audio ready for transcription        |
| `whatsapp.linkpreview.extract` | whatsapp-linkpreview       | URLs found for preview extraction    |
| `whatsapp.media.cleanup`       | whatsapp-media-cleanup     | Media deletion requested             |

---

## Error Handling

| Error Code            | Meaning                                 | Recovery Action                       |
| --------------------- | --------------------------------------- | ------------------------------------- |
| `NOT_FOUND`           | Message not found or not owned by user  | Verify message ID and ownership       |
| `DOWNSTREAM_ERROR`    | Failed to communicate with WhatsApp/GCS | Retry with exponential backoff        |
| `USER_NOT_MAPPED`     | User has no connected WhatsApp number   | Prompt user to connect WhatsApp       |
| `VALIDATION_ERROR`    | Invalid request payload                 | Fix request according to schema       |
| `PRECONDITION_FAILED` | Phone number not verified (v3.0.0)      | Verify phone before connecting        |
| `CONFLICT`            | Phone already verified or mapped        | No action needed                      |
| `RATE_LIMITED`        | Too many verification requests          | Wait for cooldown or rate limit reset |
| `LOCKED`              | Max verification attempts exceeded      | Request a new verification code       |
| `GONE`                | Verification code expired               | Request a new verification code       |

---

## Rate Limits

| Operation      | Limit           | Window   |
| -------------- | --------------- | -------- |
| Send messages  | 1000/day        | 24h      |
| List messages  | 100/minute      | 1 min    |
| Get media URL  | 60/minute       | 1 min    |
| Verify send    | 3/phone/hour    | 1 hour   |
| Verify send    | 60s cooldown    | per req  |
| Verify confirm | 3 attempts/code | per code |

---

## Dependencies

| Service      | Why Needed                  | Failure Behavior          |
| ------------ | --------------------------- | ------------------------- |
| user-service | Validate user ownership     | Reject request            |
| WhatsApp API | Send/receive messages       | Queue for retry           |
| srt-service  | Audio transcription         | Mark transcription failed |
| web-agent    | Link preview extraction     | Mark extraction failed    |
| GCS          | Media storage               | Reject media requests     |

---

## Approval Workflow Integration

### For Actions-Agent

To enable approval via WhatsApp with interactive buttons:

1. **Send approval request with buttons:**

   ```typescript
   publish('whatsapp-message-send', {
     type: 'whatsapp.message.send',
     userId: action.userId,
     message: formatApprovalPrompt(action),
     buttons: [
       { type: 'reply', reply: { id: `approve:${action.id}`, title: 'Approve' } },
       { type: 'reply', reply: { id: `cancel:${action.id}`, title: 'Cancel' } },
     ],
     correlationId: `action-${action.type}-approval-${action.id}`,
     timestamp: new Date().toISOString(),
   });
   ```

2. **Subscribe to action-approval-reply:**

   ```typescript
   subscribe('action-approval-reply', async (event: ApprovalReplyEvent) => {
     if (event.actionId === undefined) return; // Not an approval reply

     // Works for buttons and text replies
     const intent = classifyIntent(event.replyText);
     if (intent === 'approve') {
       await executeAction(event.actionId);
     } else if (intent === 'reject') {
       await cancelAction(event.actionId);
     }
   });
   ```

### Response Type Mapping

| Response Type              | `replyText`              | `buttonId`                    | `actionId`         |
| -------------------------- | ------------------------ | ----------------------------- | ------------------ |
| Button "Approve"           | "yes"                    | `approve:id`                  | from buttonId      |
| Button "Cancel"            | "no"                     | `cancel:id`                   | from buttonId      |
| Button "Reject"            | "no"                     | `reject:id`                   | from buttonId      |
| Button "Proceed"           | "proceed-implementation" | `proceed-implementation:id`   | from buttonId      |
| Text reply                 | raw text                 | undefined                     | from correlationId |
| Emoji reactions            | not supported            | not supported                 | not published      |

---

**Last updated:** 2026-03-07
**Version:** 5.0.0
