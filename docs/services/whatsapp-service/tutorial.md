# WhatsApp Service - Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** GCP project access, WhatsApp Business API setup, IntexuraOS development environment
> **You'll learn:** How to integrate with whatsapp-service for message sending, approval workflows, and reply correlation

---

## What You'll Build

A working integration that:

- Sends WhatsApp messages to users via the internal API
- Tracks outbound messages for reply correlation
- Handles approval responses (text replies and reactions)
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

1. **User Mapping**: Phone numbers are mapped to userId internally
2. **OutboundMessage Tracking**: Sent messages are stored with correlationId for reply correlation
3. **Approval Correlation**: CorrelationId format `action-{type}-approval-{actionId}` enables actionId extraction

---

## Part 2: Send Your First Message (10 minutes)

### Step 2.1: Prepare the Send Event

To send a WhatsApp message, publish a `whatsapp.message.send` event to Pub/Sub.

```typescript
interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string; // IntexuraOS user ID
  message: string; // Message text
  replyToMessageId?: string; // Optional: reply to specific message
  correlationId: string; // For tracking and reply correlation
  timestamp: string; // ISO 8601
}
```

### Step 2.2: Publish to Pub/Sub

```typescript
import { PubSub } from '@google-cloud/pubsub';

const pubsub = new PubSub();
const topic = pubsub.topic(process.env.INTEXURAOS_PUBSUB_WHATSAPP_MESSAGE_SEND!);

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

### What Just Happened?

1. Event published to `whatsapp-message-send` topic
2. WhatsApp-service receives via push subscription
3. Service looks up phone number for userId
4. Message sent via WhatsApp Cloud API
5. OutboundMessage saved with wamid and correlationId

**Checkpoint:** User receives message on WhatsApp within 2-5 seconds.

---

## Part 3: Implement Approval Workflow (10 minutes)

### Step 3.1: Send an Approval Request

For approval messages, use the special correlationId format:

```typescript
const actionId = 'act-xyz-789';
const actionType = 'todo';

const approvalEvent: SendMessageEvent = {
  type: 'whatsapp.message.send',
  userId: 'user-abc-123',
  message: 'Create todo: "Review quarterly report"?\n\nReply YES to approve or NO to reject.',
  correlationId: `action-${actionType}-approval-${actionId}`, // IMPORTANT: This format
  timestamp: new Date().toISOString(),
};

await topic.publishMessage({
  data: Buffer.from(JSON.stringify(approvalEvent)),
  attributes: { correlationId: approvalEvent.correlationId },
});
```

### Step 3.2: Handle Approval Responses

When the user replies or reacts, whatsapp-service publishes an `action.approval.reply` event:

```typescript
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string; // Original approval message wamid
  replyText: string; // "yes", "no", or actual reply text
  userId: string;
  timestamp: string;
  actionId?: string; // Extracted from correlationId!
}
```

### Step 3.3: Subscribe to Approval Replies

```typescript
// In your Pub/Sub handler for action-approval-reply topic
async function handleApprovalReply(event: ApprovalReplyEvent): Promise<void> {
  const { actionId, replyText, userId } = event;

  if (actionId === undefined) {
    // Reply to non-approval message, handle differently
    return;
  }

  // Classify intent from reply text
  const intent = classifyIntent(replyText);

  if (intent === 'approve') {
    await executeAction(actionId);
  } else if (intent === 'reject') {
    await cancelAction(actionId);
  } else {
    // Ambiguous response, maybe ask for clarification
    await requestClarification(userId, actionId);
  }
}

function classifyIntent(text: string): 'approve' | 'reject' | 'ambiguous' {
  const lower = text.toLowerCase().trim();
  if (['yes', 'approve', 'ok', 'sure', 'do it'].includes(lower)) {
    return 'approve';
  }
  if (['no', 'reject', 'cancel', 'nope', 'dont'].includes(lower)) {
    return 'reject';
  }
  return 'ambiguous';
}
```

**Checkpoint:** Full approval flow working - send approval, receive reply, process action.

---

## Part 4: Handle Emoji Reactions (5 minutes)

### Step 4.1: Understand Reaction Mapping

WhatsApp reactions are automatically mapped to intents:

| Emoji | Intent  | Generated replyText |
| ----- | ------- | ------------------- |
| `👍`  | approve | "yes"               |
| `👎`  | reject  | "no"                |

Other emojis are ignored (not published as approval events).

### Step 4.2: No Code Changes Needed!

If you're handling `ApprovalReplyEvent`, reactions work automatically:

```typescript
// Same handler works for both text replies AND reactions
async function handleApprovalReply(event: ApprovalReplyEvent): Promise<void> {
  // event.replyText will be "yes" for 👍 reaction
  // event.replyText will be "no" for 👎 reaction
  // event.actionId is extracted from the correlationId
  // Your existing logic handles both!
}
```

**Checkpoint:** React with 👍 on approval message, action executes automatically.

---

## Part 5: Advanced Scenarios

### Scenario A: Reply Without Known Action

When a user replies to a message that isn't an approval request:

```typescript
// event.actionId will be undefined
if (event.actionId === undefined) {
  // This was a reply to a non-approval message
  // Could be a general question or follow-up
  // Route to general message handling
}
```

### Scenario B: Prevent Duplicate Processing

WhatsApp-service automatically prevents duplicate actions:

1. If reply is to approval message with known actionId:
   - Publishes `action.approval.reply` (with actionId)
   - Does NOT publish `command.ingest`

2. If reply is to non-approval message:
   - Publishes `command.ingest` as normal

No action needed on your side.

### Scenario C: Message Expiration

OutboundMessages expire after 7 days. For long-lived workflows:

```typescript
// Consider storing action state separately
// Don't rely solely on correlationId after 7 days
await actionRepository.save({
  actionId,
  userId,
  status: 'pending_approval',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
});
```

---

## Troubleshooting

| Problem                      | Solution                                                              |
| ---------------------------- | --------------------------------------------------------------------- |
| "Message not delivered"      | Check user has connected WhatsApp number via `/whatsapp/status`       |
| "No approval event received" | Verify correlationId format: `action-{type}-approval-{actionId}`      |
| "actionId is undefined"      | User replied to non-approval message, check correlationId in DB       |
| "Duplicate actions created"  | Ensure not publishing both approval reply AND command.ingest handlers |
| "Reaction not processed"     | Only 👍 and 👎 are supported, other emojis are ignored                |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API details
2. Review the actions-agent integration for complete approval workflows
3. Consider implementing approval timeout handling (no response after X hours)

---

## Quick Reference

### CorrelationId Format for Approvals

```
action-{actionType}-approval-{actionId}
```

Examples:

- `action-todo-approval-act-123`
- `action-bookmark-approval-bk-456`
- `action-research-approval-res-789`

### Event Types

| Event                   | Direction | Purpose                        |
| ----------------------- | --------- | ------------------------------ |
| `whatsapp.message.send` | Outgoing  | Send message to user           |
| `action.approval.reply` | Incoming  | User responded to approval     |
| `command.ingest`        | Incoming  | Regular message for processing |

### Reaction Emoji Reference

```
👍 (U+1F44D) -> approve
👎 (U+1F44E) -> reject
```
