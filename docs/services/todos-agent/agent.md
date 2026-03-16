# Todos Agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| Name      | todos-agent                                                                       |
| Role      | Create and manage user-scoped todos with AI-powered item extraction               |
| Goal      | Convert natural language task descriptions into structured, actionable todo lists |

## Capabilities

### Create Todo (Internal — with AI Extraction)

**Endpoint:** `POST /internal/todos`

**When to use:** When another agent needs to create a todo on behalf of a user, especially when a natural language description is available for AI extraction. This is the primary integration point for all agent-to-agent todo creation.

**Auth:** `X-Internal-Auth: <token>` header

**Input Schema:**

```typescript
interface CreateTodoInternalInput {
  userId: string;
  title: string;
  description?: string | null;  // Triggers AI item extraction when provided
  tags: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string | null;      // ISO 8601 datetime
  source: string;               // Caller identifier (e.g. "actions-agent")
  sourceId: string;             // Unique ID in calling system
  items?: Array<{
    title: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
    dueDate?: string | null;
  }>;
}
```

**Output Schema:**

```typescript
interface CreateTodoInternalOutput {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;  // "/#/todos/<id>" on success
  errorCode?: string;    // On failure
}
```

**Example:**

```json
// Request
{
  "userId": "user-abc-123",
  "title": "Board deck preparation",
  "description": "Pull Q3 revenue numbers, draft narrative section, get design to polish slides by Friday, schedule dry run with team.",
  "tags": ["work", "presentation"],
  "source": "actions-agent",
  "sourceId": "action-789"
}

// Response (201)
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Todo \"Board deck preparation\" created successfully",
    "resourceUrl": "/#/todos/def456"
  }
}
```

### Create Todo (Public — direct)

**Endpoint:** `POST /todos`

**When to use:** When the authenticated user is creating a todo directly without AI extraction (no async processing step). Status starts as `pending` immediately.

**Auth:** Bearer token

**Input Schema:**

```typescript
interface CreateTodoPublicInput {
  title: string;
  description?: string | null;
  tags: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string | null;
  source: string;
  sourceId: string;
  items?: Array<{
    title: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
    dueDate?: string | null;
  }>;
}
```

### List Todos

**Endpoint:** `GET /todos`

**When to use:** Retrieve the authenticated user's todos, optionally filtered.

**Auth:** Bearer token

**Query Parameters:**

```typescript
interface ListTodosQuery {
  status?: 'draft' | 'processing' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  archived?: 'true' | 'false';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  tags?: string;  // Comma-separated; OR logic — any matching tag included
}
```

### Get Todo

**Endpoint:** `GET /todos/:id`

**When to use:** Retrieve a specific todo and its items by ID. Poll this endpoint to check AI extraction status after creating via `/internal/todos`.

**Auth:** Bearer token

**Output Schema:**

```typescript
interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  source: string;
  sourceId: string;
  status: 'draft' | 'processing' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
  archived: boolean;
  items: TodoItem[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Update Todo Item

**Endpoint:** `PATCH /todos/:id/items/:itemId`

**When to use:** Mark an item as completed, update its title, priority, or due date. Completing all items automatically sets the todo status to `completed`.

**Auth:** Bearer token

**Input Schema:**

```typescript
interface UpdateTodoItemInput {
  title?: string;
  status?: 'pending' | 'completed';
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  dueDate?: string | null;
}
```

### Lifecycle Actions

| Action    | Endpoint                    | Restriction                            |
| --------- | --------------------------- | -------------------------------------- |
| Archive   | `POST /todos/:id/archive`   | Only `completed` or `cancelled` todos  |
| Unarchive | `POST /todos/:id/unarchive` | No restriction                         |
| Cancel    | `POST /todos/:id/cancel`    | Cannot cancel `completed` todos        |
| Delete    | `DELETE /todos/:id`         | Permanently deletes todo and all items |

## Constraints

**Do NOT:**

- Call `/internal/todos` without a valid `userId` — the todo will be unowned
- Fabricate `sourceId` values — use a stable, unique identifier from the caller's system
- Assume AI extraction is complete immediately — poll `GET /todos/:id` until `status !== 'processing'`
- Send reorder requests with a partial item list — all item IDs must be present or the request fails
- Attempt to cancel a `completed` todo — returns `INVALID_OPERATION`

**Requires:**

- `X-Internal-Auth` header for all `/internal/*` endpoints
- Bearer token for all public `/todos` endpoints
- User must have an LLM API key configured in user-service for AI extraction to produce items

## Usage Patterns

### Pattern 1: Agent Creates Todo with AI Extraction

```
1. Call POST /internal/todos with description field populated
2. Record the todoId from resourceUrl in response ("/#/todos/<id>")
3. Optionally: poll GET /todos/<id> until status !== 'processing'
4. If polling: check items[] array for extracted results
```

### Pattern 2: Check and Complete Todo Items

```
1. Call GET /todos to list todos for a user (filter by status=pending or in_progress)
2. For each todo, inspect items[] for pending items
3. When work is done, call PATCH /todos/:id/items/:itemId with status: "completed"
4. When all items completed, todo auto-transitions to "completed"
5. Call POST /todos/:id/archive to clean up completed todos
```

### Pattern 3: Extraction Failure Handling

```
1. After POST /internal/todos, poll GET /todos/:id
2. If status === 'pending' but items contain title starting with "Item extraction failed":
   - User has no LLM API key, or Gemini was unreachable
   - Treat todo as needing manual item entry
3. If items contain "No actionable items found in todo description":
   - Description had no extractable action items
   - Add items manually via POST /todos/:id/items
```

## Error Handling

| Error Code | Meaning                         | Recovery Action                            |
| ---------- | ------------------------------- | ------------------------------------------ |
| 400        | Validation failed or invalid op | Check request body / lifecycle restriction |
| 401        | Missing or invalid auth         | Check Bearer token or internal auth key    |
| 403        | Todo belongs to different user  | Verify userId matches authenticated user   |
| 404        | Todo or item not found          | Verify IDs exist                           |
| 500        | Server error                    | Retry with exponential backoff             |

## Events Published

| Event                      | When                                      | Payload                     |
| -------------------------- | ----------------------------------------- | --------------------------- |
| `todos.processing.created` | After `POST /internal/todos` creates todo | `{ todoId, userId, title }` |

## Dependencies

| Service              | Why Needed                               | Failure Behavior                               |
| -------------------- | ---------------------------------------- | ---------------------------------------------- |
| user-service         | Get user's LLM client for extraction     | Warning item added to todo; todo still created |
| app-settings-service | Fetch LLM pricing at startup             | Service fails to start                         |
| Firestore            | Persist todos                            | All endpoints return 500                       |
| Pub/Sub              | Trigger async AI extraction              | Todo created but extraction skipped            |
