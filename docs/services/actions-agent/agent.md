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

### List Actions

**Endpoint:** `GET /actions`

**When to use:** Retrieve all actions for the current user, optionally filtered by status.

**Input Schema:**

```typescript
interface ListActionsParams {
  status?: string; // Comma-separated: "pending,awaiting_approval"
}
```

**Output Schema:**

```typescript
interface ListActionsResponse {
  actions: Action[];
}
```

**Example:**

```json
// Request
// GET /actions?status=pending,awaiting_approval

// Response
{
  "success": true,
  "data": {
    "actions": [
      {
        "id": "abc-123",
        "userId": "user_1",
        "commandId": "cmd_1",
        "type": "research",
        "confidence": 0.92,
        "title": "Research quantum computing",
        "status": "awaiting_approval",
        "payload": {},
        "createdAt": "2026-03-07T10:00:00Z",
        "updatedAt": "2026-03-07T10:05:00Z"
      }
    ]
  }
}
```

### Update Action

**Endpoint:** `PATCH /actions/:actionId`

**When to use:** Change action status (approve, reject, archive) or correct misclassified action type.

**Input Schema:**

```typescript
interface UpdateActionParams {
  status?: 'processing' | 'rejected' | 'archived';
  type?: ActionType; // Only for pending/awaiting_approval/failed actions
}
```

**Output Schema:**

```typescript
interface UpdateActionResponse {
  action: Action;
}
```

**Example:**

```json
// Request
// PATCH /actions/abc-123
{ "type": "todo" }

// Response
{
  "success": true,
  "data": {
    "action": {
      "id": "abc-123",
      "type": "todo",
      "status": "awaiting_approval"
    }
  }
}
```

### Execute Action

**Endpoint:** `POST /actions/:actionId/execute`

**When to use:** Synchronously execute an action and wait for completion.

**Input Schema:**

```typescript
// No body required
interface ExecuteActionParams {
  actionId: string; // URL parameter
}
```

**Output Schema:**

```typescript
interface ExecuteActionResponse {
  actionId: string;
  status: 'completed' | 'failed';
  resourceUrl?: string;
  message?: string;
  errorCode?: string;
  existingBookmarkId?: string;
}
```

**Example:**

```json
// Request
// POST /actions/abc-123/execute

// Response
{
  "success": true,
  "data": {
    "actionId": "abc-123",
    "status": "completed",
    "resourceUrl": "/#/research/def-456",
    "message": "Research created successfully"
  }
}
```

### Batch Get Actions

**Endpoint:** `POST /actions/batch`

**When to use:** Fetch multiple actions by ID in a single request (max 50).

**Input Schema:**

```typescript
interface BatchGetActionsParams {
  actionIds: string[]; // 1-50 IDs
}
```

**Output Schema:**

```typescript
interface BatchGetActionsResponse {
  actions: Action[];
}
```

### Get Calendar Preview

**Endpoint:** `GET /actions/:actionId/preview`

**When to use:** Retrieve a generated preview for a calendar action before approving it. Previews are generated synchronously when the approval message is sent, so this endpoint is primarily for UI display.

**Input Schema:**

```typescript
interface GetPreviewParams {
  actionId: string; // URL parameter, must be a calendar action
}
```

**Output Schema:**

```typescript
interface GetPreviewResponse {
  preview: CalendarPreview | null;
}
```

### Resolve Duplicate Bookmark

**Endpoint:** `POST /actions/:actionId/resolve-duplicate`

**When to use:** When a link action fails with `DUPLICATE_URL` error code, choose to skip or update.

**Input Schema:**

```typescript
interface ResolveDuplicateParams {
  action: 'skip' | 'update';
}
```

**Output Schema:**

```typescript
interface ResolveDuplicateResponse {
  actionId: string;
  status: 'rejected' | 'completed';
  resourceUrl?: string;
}
```

### Delete Action

**Endpoint:** `DELETE /actions/:actionId`

**When to use:** Permanently remove an action.

---

## Types

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

interface CodeActionPayload {
  prompt: string;
  workerType: 'auto' | 'opus' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';
  linearIssueId?: string;
  linearIssueTitle?: string;
  approvalEventId?: string;
  resource_url?: string;
}

type ApprovalIntent = 'approve' | 'reject' | 'unclear';

interface ApprovalReplyEvent {
  type: 'action.approval.reply';
  replyToWamid: string;
  replyText: string;
  userId: string;
  timestamp: string;
  actionId?: string;
  // Button ID formats:
  //   approve:{actionId}                    - approve the action
  //   reject:{actionId}                     - reject the action
  //   cancel:{actionId}                     - cancel (same as reject)
  //   convert:{actionId}                    - reject + convert to Linear issue
  //   cancel-task:{taskId}:{nonce}          - cancel running code task
  //   view-task:{taskId}                    - view task URL
  //   proceed-implementation:{taskId}       - proceed to phase 2 (INT-628)
  buttonId?: string;
  buttonTitle?: string;
}

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

| Rule                        | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| **Status Transitions**      | Can only set status to 'processing', 'rejected', or 'archived'                         |
| **Type Change Restriction** | Can only change type for 'pending', 'awaiting_approval', or 'failed' actions           |
| **Batch Limit**             | Maximum 50 action IDs per batch request                                                |
| **Ownership**               | Users can only access their own actions                                                |
| **Supported Execute Types** | Execute supports: research, todo, note, link, calendar, linear (not code or reminder)  |
| **Terminal States**         | Actions in 'completed' or 'rejected' cannot be modified via approval                   |
| **Auto-Execution**          | Actions with >= 90% confidence auto-execute (except linear and reminder)               |

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

| Method | Path                                 | Purpose                                     |
| ------ | ------------------------------------ | ------------------------------------------- |
| POST   | `/internal/actions`                  | Create action from commands-agent           |
| POST   | `/internal/actions/process`          | Process action from Pub/Sub (unified)       |
| POST   | `/internal/actions/:actionType`      | Process action from Pub/Sub (type-specific) |
| POST   | `/internal/actions/retry-pending`    | Retry stuck actions (Cloud Scheduler)       |
| POST   | `/internal/actions/approval-reply`   | Handle WhatsApp button taps                 |
| PATCH  | `/internal/actions/:actionId/status` | Update resource status from code-agent      |

---

## Event Flow

### Standard Action Flow

```
commands-agent -> action.created -> actions-agent
                                        |
                                action.pending (Pub/Sub)
                                        |
                                Action Handler
                        (>= 90% confidence: auto-execute)
                        (< 90% confidence: WhatsApp buttons)
                                        |
                        auto-execute OR action.awaiting_approval
```

### Approval Reply Flow

```
User taps WhatsApp button
        |
whatsapp-service -> action.approval.reply (buttonId: "approve:{actionId}")
                                                  |
                                        handleButtonResponse
                                                  |
                    approve     reject/cancel    convert    proceed-implementation
                        |            |              |               |
                  updateStatusIf  updateStatusIf  updateStatusIf  submitToPhase2
                  (atomic)        (atomic)        (atomic)        (code-agent)
                        |            |              |               |
                  Execute action   Done         "Converting..."  "Starting impl..."
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

## Error Handling

| Error Code         | HTTP | Meaning                    | Recovery Action               |
| ------------------ | ---- | -------------------------- | ----------------------------- |
| `INVALID_REQUEST`  | 400  | Invalid input or state     | Fix request payload           |
| `UNAUTHORIZED`     | 401  | Invalid or missing auth    | Refresh token or check header |
| `FORBIDDEN`        | 403  | User not owner             | Verify user ID matches        |
| `NOT_FOUND`        | 404  | Action does not exist      | Verify action ID              |
| `INTERNAL_ERROR`   | 500  | Processing failure         | Retry with backoff            |
| `DOWNSTREAM_ERROR` | 502  | Calendar/other service err | Wait and retry                |

### Cancel-task Error Codes

| Error Code             | HTTP | User Message                                     |
| ---------------------- | ---- | ------------------------------------------------ |
| `TASK_NOT_FOUND`       | 404  | Task not found.                                  |
| `INVALID_NONCE`        | 400  | Invalid cancel code. May have been used already. |
| `NONCE_EXPIRED`        | 400  | Cancel link has expired.                         |
| `NOT_OWNER`            | 403  | You are not the owner of this task.              |
| `TASK_NOT_CANCELLABLE` | 400  | Task cannot be cancelled (may have completed).   |

### Proceed-implementation Error Codes (INT-628)

| Error Code              | User Message                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `TASK_NOT_FOUND`        | Task not found.                                                |
| `INVALID_STATUS`        | Task is not in designed status.                                |
| `NO_LINEAR_ISSUE`       | Cannot proceed: no Linear issue attached.                      |
| `LABEL_NOT_READY`       | Task is not ready for implementation.                          |
| `ALREADY_IMPLEMENTED`   | Implementation has already started.                            |
| `ACTIVE_TASK_EXISTS`    | An active task already exists for this request.                |
| `WORKER_NOT_CONFIGURED` | Unable to start implementation: no workers available.          |
| `NETWORK_ERROR`         | Unable to start implementation: network error. Please retry.   |

---

## Dependencies

| Service              | Why Needed                            | Failure Behavior             |
| -------------------- | ------------------------------------- | ---------------------------- |
| commands-agent       | Fetch command text for type changes   | Type change fails            |
| research-agent       | Execute research actions              | Action marked as failed      |
| todos-agent          | Execute todo actions                  | Action marked as failed      |
| notes-agent          | Execute note actions                  | Action marked as failed      |
| bookmarks-agent      | Execute link actions                  | Action marked as failed      |
| calendar-agent       | Execute calendar actions, previews    | Action marked as failed      |
| linear-agent         | Execute linear issue creation         | Action marked as failed      |
| code-agent           | Execute code tasks, cancel, phase 2   | Action marked as failed      |
| user-service         | User API keys for LLM pricing         | Startup fails                |
| app-settings-service | LLM pricing configuration             | Startup fails                |
| Firestore            | Action persistence                    | All operations fail          |
| Pub/Sub              | Event distribution, notifications     | Best-effort (non-fatal)      |

---

**Last updated:** 2026-03-22
