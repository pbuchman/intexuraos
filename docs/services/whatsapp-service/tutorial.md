# WhatsApp Service — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** GCP project access, WhatsApp Business API setup, IntexuraOS development environment
> **You'll learn:** How to integrate with whatsapp-service for message sending, approval workflows, and reply correlation

---

## What You'll Build

A working integration that:

- Sends WhatsApp messages to users via the internal Pub/Sub API
- Sends interactive approval messages with buttons
- Sends CTA URL messages with clickable deep links
- Tracks outbound messages for reply correlation
- Handles approval responses (buttons and text replies)
- Processes the approval workflow end-to-end

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project and whatsapp-service running
- [ ] A test user with a connected WhatsApp phone number
- [ ] Understanding of Pub/Sub event publishing
- [ ] Familiarity with the actions-agent approval flow

---

## Part 1: Understanding the Message Flow (5 minutes)

### How Messages Flow Through the System

```
Incoming: WhatsApp -> Webhook -> whatsapp-service -> Pub/Sub -> Your Service
Outgoing: Your Service -> Pub/Sub -> whatsapp-service -> WhatsApp
```

### Key Concepts

1. **User Mapping**: Phone numbers are mapped to userId internally — you only need a userId to send a message
2. **OutboundMessage Tracking**: Sent messages are stored with correlationId for reply correlation
3. **Approval Correlation**: CorrelationId format `action-{type}-approval-{actionId}` enables actionId extraction from text replies
4. **Event-Driven Transcription**: Audio files are stored in GCS, then srt-service transcribes asynchronously

---

## Part 2: Send Your First Message (10 minutes)

### Step 2.1: Prepare the Send Event

To send a WhatsApp message, publish a `whatsapp.message.send` event to Pub/Sub.

```typescript
interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string;                                    // IntexuraOS user ID
  message: string;                                   // Message text
  replyToMessageId?: string;                         // Optional: reply to specific message
  buttons?: WhatsAppInteractiveButton[];             // Optional: interactive buttons
  ctaUrl?: { displayText: string; url: string };     // Optional: CTA URL button
  correlationId: string;                             // For tracking and reply correlation
  timestamp: string;                                 // ISO 8601
}

interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;     // Format: "intent:actionId"
    title: string;  // Max 20 characters
  };
}
```

**Important:** `buttons` and `ctaUrl` are mutually exclusive (WhatsApp API constraint).

### Step 2.2: Publish a Plain Text Message

```typescript
import { PubSub } from '@google-cloud/pubsub';

const pubsub = new PubSub();
const topic = pubsub.topic(process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC']!);

const event: SendMessageEvent = {
  type: 'whatsapp.message.send',
  userId: 'user-abc-123',
  message: 'Hello from IntexuraOS!',
  correlationId: 'notification-welcome-user-abc-123',
  timestamp: new Date().toISOString(),
};

await topic.publishMessage({
  data: Buffer.from(JSON.stringify(event)),
  attributes: { correlationId: event.correlationId },
});
```

### Step 2.3: Send a CTA URL Message

CTA URL messages include a clickable button that opens a link in the user's browser:

```typescript
const ctaEvent: SendMessageEvent = {
  type: 'whatsapp.message.send',
  userId: 'user-abc-123',
  message: 'Your PR is ready for review!',
  ctaUrl: {
    displayText: 'View PR',
    url: 'https://github.com/org/repo/pull/42',
  },
  correlationId: 'pr-ready-pr-42',
  timestamp: new Date().toISOString(),
};

await topic.publishMessage({
  data: Buffer.from(JSON.stringify(ctaEvent)),
});
```

### What Just Happened?

1. Event published to the `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` topic
2. WhatsApp-service receives via push subscription at `/internal/whatsapp/pubsub/send-message`
3. Service looks up phone number for userId from `whatsapp_user_mappings`
4. Message sent via WhatsApp Cloud API (text, interactive, or CTA based on payload shape)
5. OutboundMessage saved to `whatsapp_outbound_messages` with wamid and correlationId

**Checkpoint:** User receives message on WhatsApp within a few seconds.

---

## Part 3: Implement Approval Workflow (10 minutes)

### Step 3.1: Send an Approval Request with Buttons

For approval messages, include interactive buttons. The button ID encodes the intent and action ID:

```typescript
const actionId = 'act-xyz-789';
const actionType = 'todo';

const approvalEvent: SendMessageEvent = {
  type: 'whatsapp.message.send',
  userId: 'user-abc-123',
  message: 'Create todo: "Review quarterly report"?',
  buttons: [
    { type: 'reply', reply: { id: `approve:${actionId}`, title: 'Approve' } },
    { type: 'reply', reply: { id: `cancel:${actionId}`, title: 'Cancel' } },
  ],
  correlationId: `action-${actionType}-approval-${actionId}`,
  timestamp: new Date().toISOString(),
};

await topic.publishMessage({
  data: Buffer.from(JSON.stringify(approvalEvent)),
  attributes: { correlationId: approvalEvent.correlationId },
});
```

When buttons are provided, the message is sent as a WhatsApp interactive message. Users can tap buttons directly instead of typing replies. Text replies still work as a fallback.

### Step 3.2: Handle Approval Responses

When the user taps a button or replies, whatsapp-service publishes an `action.approval.reply` event:

```typescript
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string;   // Original approval message wamid
  replyText: string;      // "yes", "no", "convert", "cancel-task", "view-task", "proceed-implementation"
  userId: string;
  timestamp: string;
  actionId?: string;      // Extracted from buttonId or correlationId
  buttonId?: string;      // Button ID if user tapped a button
  buttonTitle?: string;   // Button title if user tapped a button
}
```

### Step 3.3: Subscribe to Approval Replies

```typescript
// In your Pub/Sub handler for INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC
async function handleApprovalReply(event: ApprovalReplyEvent): Promise<void> {
  const { actionId, replyText, userId } = event;

  if (actionId === undefined) {
    // Reply to non-approval message — handle differently
    return;
  }

  const intent = classifyIntent(replyText);

  if (intent === 'approve') {
    await executeAction(actionId);
  } else if (intent === 'reject') {
    await cancelAction(actionId);
  } else {
    await requestClarification(userId, actionId);
  }
}

function classifyIntent(text: string): 'approve' | 'reject' | 'ambiguous' {
  const lower = text.toLowerCase().trim();
  if (['yes', 'approve', 'ok', 'sure', 'do it'].includes(lower)) {
    return 'approve';
  }
  if (['no', 'reject', 'cancel', 'nope'].includes(lower)) {
    return 'reject';
  }
  return 'ambiguous';
}
```

**Checkpoint:** Full approval flow working — send approval, receive reply, process action.

---

## Part 4: Handle Buttons and Text Replies (5 minutes)

### Step 4.1: Understand Response Types

Buttons and text replies both produce the same `ApprovalReplyEvent`:

| Response Type              | `replyText`              | `buttonId`                  | `actionId`         |
| -------------------------- | ------------------------ | --------------------------- | ------------------ |
| Button "Approve"           | "yes"                    | `approve:act-123`           | `act-123`          |
| Button "Cancel"            | "no"                     | `cancel:act-123`            | `act-123`          |
| Button "Reject"            | "no"                     | `reject:act-123`            | `act-123`          |
| Button "Proceed"           | "proceed-implementation" | `proceed-implementation:id` | from buttonId      |
| Text reply "yes"           | "yes"                    | undefined                   | from correlationId |
| Text reply "no"            | "no"                     | undefined                   | from correlationId |

**Note:** Emoji reactions are not supported. They are ignored with status `REACTION_NOT_SUPPORTED`.

### Step 4.2: One Handler for Both

The same handler works for button taps and text replies:

```typescript
async function handleApprovalReply(event: ApprovalReplyEvent): Promise<void> {
  // event.replyText is always set
  // event.actionId is extracted from buttonId or correlationId
  // event.buttonId is set only for button taps
  // Your existing intent classification handles both!
}
```

**Checkpoint:** Send approval with buttons, tap Approve, action executes automatically.

---

## Part 5: Advanced Scenarios

### Scenario A: Reply Without Known Action

When a user replies to a message that is not an approval request:

```typescript
// event.actionId will be undefined
if (event.actionId === undefined) {
  // This was a reply to a non-approval message
  // Route to general message handling or ignore
}
```

### Scenario B: Prevent Duplicate Processing

WhatsApp-service automatically prevents duplicate actions:

1. If reply is to an approval message with a known actionId:
   - Publishes `action.approval.reply` (with actionId)
   - Does NOT publish `command.ingest`
2. If reply is to a non-approval message:
   - Publishes `command.ingest` as normal

No action needed on your side.

### Scenario C: Message Expiration

OutboundMessages expire after 7 days. For long-lived workflows, store action state independently:

```typescript
await actionRepository.save({
  actionId,
  userId,
  status: 'pending_approval',
  createdAt: new Date().toISOString(),
});
// Do not rely solely on OutboundMessage correlation after 7 days
```

### Scenario D: Audio Message Processing

Audio messages follow an event-driven flow:

1. User sends voice note via WhatsApp
2. whatsapp-service downloads audio and stores it in GCS
3. `whatsapp.audio.stored` event is published to srt-service
4. srt-service transcribes the audio asynchronously
5. `srt.transcription.completed` event is received
6. whatsapp-service updates message, sends transcript to user, and publishes `command.ingest`

Subscribe to `command.ingest` events with `sourceType: 'whatsapp_voice'` to receive the final text. No other integration needed.

---

## Troubleshooting

| Problem                       | Solution                                                              |
| ----------------------------- | --------------------------------------------------------------------- |
| "Message not delivered"       | Check user has connected WhatsApp number via `GET /whatsapp/status`   |
| "Phone not verified"          | Run `/whatsapp/verify/send` then `/whatsapp/verify/confirm` first     |
| "No approval event received"  | Verify buttonId format or correlationId matches expected pattern      |
| "actionId is undefined"       | User replied to non-approval message; check correlationId pattern     |
| "Duplicate actions created"   | Ensure approval and command handlers do not both run for same reply   |
| "Reaction not processed"      | Emoji reactions are ignored; use buttons or text replies only         |
| "Button title truncated"      | WhatsApp limits button titles to 20 characters                        |
| "CTA button not showing"      | Ensure `buttons` and `ctaUrl` are not both provided in the same event |
| "401 on internal endpoint"    | Use `X-Internal-Auth` header or ensure OIDC push subscription config  |
| "Rate limited on verify"      | Wait for 60s cooldown or 1-hour window to reset                       |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API details
2. Review the actions-agent integration for complete approval workflows
3. Consider implementing approval timeout handling (no response after N hours)

---

## Quick Reference

### Button ID Format for Approvals

```
approve:{actionId}               Approve
cancel:{actionId}                Cancel/reject
reject:{actionId}                Explicitly reject
convert:{actionId}               Convert to different type
cancel-task:{taskId}             Cancel running task
view-task:{taskId}               View task status
proceed-implementation:{taskId}  Proceed with implementation
```

### CorrelationId Format for Text Reply Correlation

```
action-{actionType}-approval-{actionId}
```

Examples:

- `action-todo-approval-act-123`
- `action-bookmark-approval-bk-456`
- `action-research-approval-res-789`

### Event Types Reference

| Event                          | Direction | Purpose                               |
| ------------------------------ | --------- | ------------------------------------- |
| `whatsapp.message.send`        | Consume   | Send message to user                  |
| `action.approval.reply`        | Published | User responded to approval            |
| `command.ingest`               | Published | Regular message for processing        |
| `whatsapp.audio.stored`        | Published | Audio ready for transcription         |
| `srt.transcription.completed`  | Consume   | Transcription result from srt-service |

### Response Types Reference

```
Button tap    replyText from intent, buttonId present
Text reply    raw replyText, no buttonId
Emoji react   NOT supported
CTA URL       One-way notification, no response expected
```
