# whatsapp-service - Agent Interface

> Machine-readable interface definition for AI agents interacting with whatsapp-service.

---

## Identity

| Field    | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| **Name** | whatsapp-service                                                                     |
| **Role** | WhatsApp Integration Service with Approval Workflow Support                          |
| **Goal** | Receive WhatsApp messages, enable approval via replies/reactions, send notifications |

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
  correlationId: string; // For tracking; use approval format for approvals
  timestamp: string; // ISO 8601
}
```

**Example:**

```json
// Publish to whatsapp-message-send topic
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "Your research is ready: https://...",
  "correlationId": "research-complete-res-456",
  "timestamp": "2026-01-24T10:30:00Z"
}
```

### Send Approval Request

**Endpoint:** Pub/Sub topic `whatsapp-message-send`

**When to use:** When you need user approval for an action

**Input Schema:**

```typescript
interface ApprovalMessageEvent {
  type: 'whatsapp.message.send';
  userId: string;
  message: string; // Should include approval prompt
  correlationId: string; // MUST be: action-{type}-approval-{actionId}
  timestamp: string;
}
```

**Correlation ID Format:**

```
action-{actionType}-approval-{actionId}
```

**Example:**

```json
{
  "type": "whatsapp.message.send",
  "userId": "user-abc-123",
  "message": "Create todo: 'Review quarterly report'?\n\nReply YES to approve or NO to reject.",
  "correlationId": "action-todo-approval-act-xyz-789",
  "timestamp": "2026-01-24T10:30:00Z"
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
    replyToWamid?: string; // If this is a reply
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
  replyText: string; // User's reply text
  userId: string;
  timestamp: string;
  actionId?: string; // Extracted from correlationId
}
```

---

## Constraints

| Rule                    | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| **Phone Number Mapped** | User must have WhatsApp number registered              |
| **Media Expiration**    | Signed URLs expire after 15 minutes                    |
| **Ownership**           | Users can only access their own messages               |
| **Pagination**          | Maximum 100 messages per request                       |
| **OutboundMessage TTL** | Reply correlation data expires after 7 days            |
| **Approval Format**     | CorrelationId MUST match `action-{type}-approval-{id}` |

---

## Usage Patterns

### Pattern 1: Send Notification

```
1. Publish SendMessageEvent to whatsapp-message-send topic
2. WhatsApp-service looks up phone number for userId
3. Message sent via WhatsApp Cloud API
4. No response expected
```

### Pattern 2: Request Approval

```
1. Publish SendMessageEvent with correlationId: action-{type}-approval-{actionId}
2. WhatsApp-service sends message and saves OutboundMessage
3. User replies with text OR reacts with 👍/👎
4. WhatsApp-service publishes ApprovalReplyEvent to action-approval-reply topic
5. Your service receives event with actionId extracted
6. Process approval/rejection
```

### Pattern 3: Access Message Media

```
1. GET /whatsapp/messages to list messages
2. Find message with hasMedia: true
3. GET /whatsapp/messages/:id/media for original
4. GET /whatsapp/messages/:id/thumbnail for preview (images only)
5. Use signed URL within 15 minutes
```

---

## Events Consumed

| Event                   | Topic                 | Purpose                        |
| ----------------------- | --------------------- | ------------------------------ |
| `whatsapp.message.send` | whatsapp-message-send | Send outbound WhatsApp message |

## Events Published

| Event                          | Topic                     | Purpose                           |
| ------------------------------ | ------------------------- | --------------------------------- |
| `action.approval.reply`        | action-approval-reply     | User responded to approval        |
| `command.ingest`               | command-ingest            | Text/voice message for processing |
| `whatsapp.audio.transcribe`    | whatsapp-audio-transcribe | Audio ready for transcription     |
| `whatsapp.linkpreview.extract` | whatsapp-linkpreview      | URLs found for preview extraction |
| `whatsapp.media.cleanup`       | whatsapp-media-cleanup    | Media deletion requested          |

---

## Error Handling

| Error Code         | Meaning                                 | Recovery Action                 |
| ------------------ | --------------------------------------- | ------------------------------- |
| `NOT_FOUND`        | Message not found or not owned by user  | Verify message ID and ownership |
| `DOWNSTREAM_ERROR` | Failed to communicate with WhatsApp/GCS | Retry with exponential backoff  |
| `USER_NOT_MAPPED`  | User has no connected WhatsApp number   | Prompt user to connect WhatsApp |
| `VALIDATION_ERROR` | Invalid request payload                 | Fix request according to schema |

---

## Rate Limits

| Operation     | Limit      | Window |
| ------------- | ---------- | ------ |
| Send messages | 1000/day   | 24h    |
| List messages | 100/minute | 1 min  |
| Get media URL | 60/minute  | 1 min  |

---

## Dependencies

| Service      | Why Needed              | Failure Behavior          |
| ------------ | ----------------------- | ------------------------- |
| user-service | Validate user ownership | Reject request            |
| WhatsApp API | Send/receive messages   | Queue for retry           |
| Speechmatics | Audio transcription     | Mark transcription failed |
| GCS          | Media storage           | Reject media requests     |

---

## Approval Workflow Integration

### For Actions-Agent

To enable approval via WhatsApp:

1. **Send approval request:**

   ```typescript
   publish('whatsapp-message-send', {
     type: 'whatsapp.message.send',
     userId: action.userId,
     message: formatApprovalPrompt(action),
     correlationId: `action-${action.type}-approval-${action.id}`,
     timestamp: new Date().toISOString(),
   });
   ```

2. **Subscribe to action-approval-reply:**

   ```typescript
   subscribe('action-approval-reply', async (event: ApprovalReplyEvent) => {
     if (event.actionId === undefined) return; // Not an approval reply

     const intent = classifyIntent(event.replyText);
     if (intent === 'approve') {
       await executeAction(event.actionId);
     } else if (intent === 'reject') {
       await cancelAction(event.actionId);
     }
   });
   ```

### Reaction Mapping

| Emoji | Generated replyText | Intent  |
| ----- | ------------------- | ------- |
| `👍`  | "yes"               | approve |
| `👎`  | "no"                | reject  |

Other emojis are ignored (not published as events).

---

**Last updated:** 2026-01-24
**Version:** 2.0.0
