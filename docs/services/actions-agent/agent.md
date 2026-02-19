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
type ActionType =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'linear'
  | 'code';

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
  resource_status?: ResourceStatus;
  resource_error?: string;
  createdAt: string;
  updatedAt: string;
}

type ResourceStatus =
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

// Code action payload
interface CodeActionPayload {
  prompt: string;
  workerType: 'opus' | 'auto' | 'glm';
  linearIssueId?: string;
  linearIssueTitle?: string;
  approvalEventId?: string;
  resource_url?: string;
}

// v2.0.0: Approval intent (v4.0.0: resolved by buttons only, not LLM)
type ApprovalIntent = 'approve' | 'reject' | 'unclear';

// v2.0.0: Approval reply event from whatsapp-service
// v4.0.0: LLM removed; buttonId resolves intent deterministically
interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string;
  replyText: string;
  userId: string;
  timestamp: string;
  actionId?: string; // Optional, extracted from correlationId
  // Button ID formats (v4.0.0):
  //   approve:{actionId}       - approve the action
  //   reject:{actionId}        - reject the action
  //   cancel:{actionId}        - cancel (same as reject)
  //   convert:{actionId}       - reject + convert to Linear issue
  //   cancel-task:{taskId}:{nonce} - cancel running code task
  //   view-task:{taskId}       - view task URL
  buttonId?: string;
  buttonTitle?: string; // User-visible text of the button clicked
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

| Rule                        | Description                                                               |
| --------------------------- | ------------------------------------------------------------------------- |
| **Status Transitions**      | Can only set status to 'processing', 'rejected', or 'archived'            |
| **Type Change Restriction** | Can only change type for 'pending' or 'awaiting_approval' actions         |
| **Batch Limit**             | Maximum 50 action IDs per batch request                                   |
| **Ownership**               | Users can only access their own actions                                   |
| **Supported Types**         | Execute only supports: research, todo, note, link, linear, calendar, code |
| **Terminal States**         | Actions in 'completed' or 'rejected' cannot be modified via approval      |

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
| POST   | `/internal/actions/approval-reply` | Handle WhatsApp button taps (v2.0.0)        |

---

## Event Flow

### Standard Action Flow

```
commands-agent -> action.created -> actions-agent
                                        |
                                action.pending (Pub/Sub)
                                        |
                                Action Handler
                                (sends WhatsApp with [Approve][Reject] buttons)
                                        |
                                action.awaiting_approval
```

### Approval Reply Flow (v4.0.0 — buttons only)

```
User taps WhatsApp button
        |
whatsapp-service -> action.approval.reply (buttonId: "approve:{actionId}")
                                                  |
                                        handleButtonResponse
                                                  |
                                    approve         reject/cancel      convert
                                        |                |                |
                                updateStatusIf    updateStatusIf    updateStatusIf
                                (atomic)           (atomic)          (atomic)
                                        |                |                |
                                Execute action      Done           "Converting..."
```

### Race Condition Prevention (v2.0.0)

```
Two concurrent approval button taps arrive:

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

### Approval Request Message (v4.0.0)

All action handlers send interactive buttons using `buildApprovalButtons()`:

```typescript
// Standard (all types except code)
buttons = buildApprovalButtons({ actionId });
// → [{ id: 'approve:{actionId}', title: 'Approve' }, { id: 'reject:{actionId}', title: 'Reject' }]

// Code actions (with Convert to Issue button)
buttons = buildApprovalButtons({
  actionId,
  extraButtons: [{ type: 'reply', reply: { id: `convert:${actionId}`, title: 'Convert to Issue' } }],
});
```

### Approval Reply Messages

```typescript
// Approval
message: `✅ Approved! Processing your ${action.type}: "${action.title}"`

// Rejection/cancel
message: `🛑 Got it. Cancelled the ${action.type}: "${action.title}"`

// Convert to issue
message: `🔀 Converting ${action.type} to Linear issue: "${action.title}"`

// Text reply (no button) — re-send buttons
message: `Please use the buttons to approve or reject. If buttons expired, here they are again:`
buttons: buildApprovalButtons({ actionId })

// Action not found
message: `This action is no longer available. It may have been deleted or already processed.`
```

---

## Error Handling

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

### Cancel-task Error Codes (v4.0.0 — UPPER_CASE)

| Error Code             | HTTP Status | User Message                                      |
| ---------------------- | ----------- | ------------------------------------------------- |
| `TASK_NOT_FOUND`       | 404         | Task not found.                                   |
| `INVALID_NONCE`        | 400         | Invalid cancel code. May have been used already.  |
| `NONCE_EXPIRED`        | 400         | Cancel link has expired.                          |
| `NOT_OWNER`            | 403         | You are not the owner of this task.               |
| `TASK_NOT_CANCELLABLE` | 400         | Task cannot be cancelled (may have completed).    |

---

**Last updated:** 2026-02-19
