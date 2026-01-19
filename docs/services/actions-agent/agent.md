# actions-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with actions-agent.

---

## Identity

| Field | Value |
| ----- | ----- |
| **Name** | actions-agent |
| **Role** | Central Action Orchestrator |
| **Goal** | Manage action lifecycle, route to specialized agents, coordinate execution |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ActionsAgentTools {
  // List actions with optional status filter
  listActions(params?: {
    status?: ActionStatus | ActionStatus[];
  }): Promise<{ actions: Action[] }>;

  // Update action status or type
  updateAction(actionId: string, params: {
    status?: 'processing' | 'rejected' | 'archived';
    type?: ActionType;
  }): Promise<{ action: Action }>;

  // Delete action
  deleteAction(actionId: string): Promise<void>;

  // Batch fetch multiple actions by IDs (max 50)
  batchGetActions(params: {
    actionIds: string[];
  }): Promise<{ actions: Action[] }>;

  // Execute action synchronously
  executeAction(actionId: string): Promise<{
    actionId: string;
    status: 'completed' | 'failed';
    resourceUrl?: string;
    message?: string;
    errorCode?: string;
    existingBookmarkId?: string;
  }>;

  // Resolve duplicate bookmark conflict
  resolveDuplicateAction(actionId: string, params: {
    action: 'skip' | 'update';
  }): Promise<{
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
  | 'linear';

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
```

---

## Constraints

| Rule | Description |
| ---- | ----------- |
| **Status Transitions** | Can only set status to 'processing', 'rejected', or 'archived' |
| **Type Change Restriction** | Can only change type for 'pending' or 'awaiting_approval' actions |
| **Batch Limit** | Maximum 50 action IDs per batch request |
| **Ownership** | Users can only access their own actions |
| **Supported Types** | Execute only supports: research, todo, note, link, linear, calendar |

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

---

## Internal Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/internal/actions` | Create action from commands-agent |
| GET | `/internal/actions/:id` | Get action for execution agents |
| PATCH | `/internal/actions/:id` | Update action status from execution agents |

---

## Event Flow

```
commands-agent → action.created → actions-agent
                                      ↓
                              action.pending (Pub/Sub)
                                      ↓
                              Specialized Agent
                              (research/todo/etc)
                                      ↓
                              action.completed (Pub/Sub)
```

---

**Last updated:** 2026-01-19
