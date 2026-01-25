# actions-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with actions-agent.

---

## Identity

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| **Name** | actions-agent                                                              |
| **Role** | Central Action Orchestrator                                                |
| **Goal** | Manage action lifecycle, route to specialized agents, coordinate execution |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ActionsAgentTools {
  // List actions with optional status filter
  listActions(params?: { status?: ActionStatus | ActionStatus[] }): Promise<{ actions: Action[] }>;

  // Update action status or type
  updateAction(
    actionId: string,
    params: {
      status?: 'processing' | 'rejected' | 'archived';
      type?: ActionType;
    }
  ): Promise<{ action: Action }>;

  // Delete action
  deleteAction(actionId: string): Promise<void>;

  // Batch fetch multiple actions by IDs (max 50)
  batchGetActions(params: { actionIds: string[] }): Promise<{ actions: Action[] }>;

  // Execute action synchronously
  executeAction(actionId: string): Promise<{
    actionId: string;
    status: 'completed' | 'failed';
    resourceUrl?: string;
    message?: string;
    errorCode?: string;
    existingBookmarkId?: string;
  }>;

  // Get calendar action preview
  getActionPreview(actionId: string): Promise<{
    preview: CalendarPreview | null;
  }>;

  // Resolve duplicate bookmark conflict
  resolveDuplicateAction(
    actionId: string,
    params: {
      action: 'skip' | 'update';
    }
  ): Promise<{
    actionId: string;
    status: 'rejected' | 'completed';
    resourceUrl?: string;
  }>;
}
```

### Types

```typescript
type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear';

type ActionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'archived';

interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// v2.0.0: Approval intent classification
type ApprovalIntent = 'approve' | 'reject' | 'unclear';

interface ApprovalIntentResult {
  intent: ApprovalIntent;
  confidence: number;
  reasoning: string;
}

// v2.0.0: Approval reply event from whatsapp-service
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string;
  replyText: string;
  userId: string;
  timestamp: string;
  actionId?: string; // Optional, extracted from correlationId
}

// v2.0.0: Atomic status update result
type UpdateStatusIfResult =
  | { outcome: 'updated' }
  | { outcome: 'status_mismatch'; currentStatus: string }
  | { outcome: 'not_found' }
  | { outcome: 'error'; error: Error };

interface CalendarPreview {
  actionId: string;
  userId: string;
  status: 'pending' | 'ready' | 'failed';
  summary?: string;
  start?: string;
  end?: string;
  location?: string;
  description?: string;
  duration?: string;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
  generatedAt: string;
}
```

---

## Constraints

| Rule                        | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| **Status Transitions**      | Can only set status to 'processing', 'rejected', or 'archived'             |
| **Type Change Restriction** | Can only change type for 'pending' or 'awaiting_approval' actions          |
| **Batch Limit**             | Maximum 50 action IDs per batch request                                    |
| **Ownership**               | Users can only access their own actions                                    |
| **Supported Types**         | Execute only supports: research, todo, note, link, linear, calendar        |
| **Terminal States**         | Actions in 'completed' or 'rejected' cannot be modified via approval reply |

---

## Usage Patterns

### List Pending Actions

```typescript
const { actions } = await listActions({
  status: 'pending,awaiting_approval',
});
```

### Execute Action

```typescript
const result = await executeAction(actionId);
if (result.status === 'completed') {
  // Navigate to result.resourceUrl
}
```

### Handle Duplicate Bookmark

```typescript
const result = await executeAction(actionId);
if (result.errorCode === 'DUPLICATE_URL') {
  // Ask user: skip or update existing?
  await resolveDuplicateAction(actionId, { action: 'update' });
}
```

### Change Action Type

```typescript
// User corrects AI classification
await updateAction(actionId, { type: 'todo' });
await updateAction(actionId, { status: 'processing' });
```

### Get Calendar Preview

```typescript
const { preview } = await getActionPreview(actionId);
if (preview?.status === 'ready') {
  // Show preview to user before approval
  console.log(`Event: ${preview.summary} at ${preview.start}`);
}
```

---

## Internal Endpoints

| Method | Path                               | Purpose                                     |
| ------ | ---------------------------------- | ------------------------------------------- |
| POST   | `/internal/actions`                | Create action from commands-agent           |
| POST   | `/internal/actions/process`        | Process action from Pub/Sub (unified)       |
| POST   | `/internal/actions/:actionType`    | Process action from Pub/Sub (type-specific) |
| POST   | `/internal/actions/retry-pending`  | Retry stuck actions (Cloud Scheduler)       |
| POST   | `/internal/actions/approval-reply` | Handle WhatsApp approval replies (v2.0.0)   |

---

## Event Flow

### Standard Action Flow

```
commands-agent -> action.created -> actions-agent
                                        |
                                action.pending (Pub/Sub)
                                        |
                                Action Handler
                                (sends WhatsApp approval request)
                                        |
                                action.awaiting_approval
```

### Approval Reply Flow (v2.0.0)

```
User replies to WhatsApp message
        |
whatsapp-service -> action.approval.reply -> actions-agent
                                                  |
                                        Classify intent (LLM)
|  |  |
|  |
|  |  |  |
    approve          reject           unclear         error
        |                |                |               |
updateStatusIf    updateStatusIf    Send clarification  Send error
(atomic)           (atomic)           request            message
        |                |
Publish action.created   Done
        |
Target Service executes
```

### Race Condition Prevention (v2.0.0)

```
Two concurrent approval replies arrive:

Thread 1: updateStatusIf('pending', 'awaiting_approval')
          -> Transaction: read status='awaiting_approval', matches, update to 'pending'
          -> Returns { outcome: 'updated' }
          -> Proceeds to execute action

Thread 2: updateStatusIf('pending', 'awaiting_approval')
          -> Transaction: read status='pending', does NOT match
          -> Returns { outcome: 'status_mismatch', currentStatus: 'pending' }
          -> Returns early, no duplicate processing
```

---

## Pub/Sub Events

### Published

| Event Type       | Topic         | When                              |
| ---------------- | ------------- | --------------------------------- |
| `action.created` | actions-queue | After action creation or approval |

### Subscribed

| Event Type              | Endpoint                           | Source               |
| ----------------------- | ---------------------------------- | -------------------- |
| `action.created`        | `/internal/actions/process`        | commands-agent, self |
| `action.approval.reply` | `/internal/actions/approval-reply` | whatsapp-service     |

---

## Integration with whatsapp-service

### Approval Request Message

When an action handler sends an approval request:

```typescript
await whatsappPublisher.publishSendMessage({
  userId: event.userId,
  message: `New research ready for approval: "${event.title}". Review here: ${actionLink} or reply to approve/reject.`,
  correlationId: `action-research-approval-${event.actionId}`,
});
```

The `correlationId` contains the action ID, which whatsapp-service extracts and includes in the approval reply event.

### Approval Reply Message

After processing an approval reply:

```typescript
// Approval
await whatsappPublisher.publishSendMessage({
  userId,
  message: `Approved! Processing your ${action.type}: "${action.title}"`,
  correlationId: `approval-approved-${action.id}`,
});

// Rejection
await whatsappPublisher.publishSendMessage({
  userId,
  message: `Got it. Rejected the ${action.type}: "${action.title}"`,
  correlationId: `approval-rejected-${action.id}`,
});

// Unclear
await whatsappPublisher.publishSendMessage({
  userId,
  message: `I didn't understand your reply. Please reply with "yes" to approve or "no" to cancel the ${action.type}: "${action.title}"`,
  correlationId: `approval-unclear-${action.id}`,
});
```

---

## Error Handling

### LLM Classifier Errors (v2.0.0)

| Error Code      | User Message                                                                    |
| --------------- | ------------------------------------------------------------------------------- |
| `NO_API_KEY`    | "I couldn't process your reply because your LLM API key is not configured..."   |
| `INVALID_MODEL` | "I couldn't process your reply because your LLM model preference is invalid..." |
| Other           | "I couldn't process your reply due to a temporary issue. Please reply with..."  |

### Status Mismatch (v2.0.0)

When `updateStatusIf` returns `status_mismatch`, the handler returns success without processing:

```typescript
if (updateResult.outcome === 'status_mismatch') {
  logger.info(
    { actionId: action.id, currentStatus: updateResult.currentStatus },
    'Action already processed by another approval reply (race condition prevented)'
  );
  return ok({
    matched: true,
    actionId: action.id,
  });
}
```

---

**Last updated:** 2026-01-24
