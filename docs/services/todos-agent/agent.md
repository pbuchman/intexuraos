# todos-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with todos-agent.

---

## Identity

| Field    | Value                                                         |
| -------- | ------------------------------------------------------------- |
| **Name** | todos-agent                                                   |
| **Role** | Task Management Service                                       |
| **Goal** | Manage todos with sub-items, priorities, and status workflows |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface TodosAgentTools {
  // List todos with filters
  listTodos(params?: {
    status?: TodoStatus;
    archived?: boolean;
    priority?: TodoPriority;
    tags?: string[];
  }): Promise<Todo[]>;

  // Create new todo
  createTodo(params: {
    title: string;
    description?: string;
    tags: string[];
    priority?: TodoPriority;
    dueDate?: string;
    source: string;
    sourceId: string;
    items?: { title: string; priority?: TodoPriority; dueDate?: string }[];
  }): Promise<Todo>;

  // Get single todo
  getTodo(id: string): Promise<Todo>;

  // Update todo
  updateTodo(
    id: string,
    params: {
      title?: string;
      description?: string;
      tags?: string[];
      priority?: TodoPriority;
      dueDate?: string;
    }
  ): Promise<Todo>;

  // Delete todo
  deleteTodo(id: string): Promise<void>;

  // Add item to todo
  addTodoItem(
    todoId: string,
    params: {
      title: string;
      priority?: TodoPriority;
      dueDate?: string;
    }
  ): Promise<Todo>;

  // Update item in todo
  updateTodoItem(
    todoId: string,
    itemId: string,
    params: {
      title?: string;
      status?: TodoItemStatus;
      priority?: TodoPriority;
      dueDate?: string;
    }
  ): Promise<Todo>;

  // Delete item from todo
  deleteTodoItem(todoId: string, itemId: string): Promise<Todo>;

  // Reorder items (must include ALL item IDs)
  reorderTodoItems(
    todoId: string,
    params: {
      itemIds: string[];
    }
  ): Promise<Todo>;

  // Archive completed/cancelled todo
  archiveTodo(id: string): Promise<Todo>;

  // Unarchive todo
  unarchiveTodo(id: string): Promise<Todo>;

  // Cancel todo (not completed ones)
  cancelTodo(id: string): Promise<Todo>;
}
```

### Types

```typescript
type TodoStatus = 'draft' | 'processing' | 'pending' | 'in_progress' | 'completed' | 'cancelled';

type TodoItemStatus = 'pending' | 'completed';

type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

interface TodoItem {
  id: string;
  title: string;
  status: TodoItemStatus;
  priority: TodoPriority | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  priority: TodoPriority;
  dueDate: string | null;
  source: string;
  sourceId: string;
  status: TodoStatus;
  archived: boolean;
  items: TodoItem[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule                    | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| **Archive Restriction** | Can only archive completed or cancelled todos                         |
| **Cancel Restriction**  | Cannot cancel already completed todos                                 |
| **Auto Status**         | Completing all items auto-completes the todo                          |
| **Reopening**           | Adding an item to a completed todo reverts status to `in_progress`    |
| **Ownership**           | Users can only access their own todos                                 |
| **Reorder**             | Item IDs must match existing items exactly (no partial reorders)      |
| **Description Limit**   | Descriptions over 10,000 chars truncated for AI extraction            |
| **Max Items**           | AI extraction capped at 50 items per todo                             |
| **Default Priority**    | New todos default to `medium` priority if not specified               |
| **Tag Filtering**       | Tag filter uses OR logic — matches todos containing ANY provided tag  |

---

## Usage Patterns

### Create Todo with Items

```typescript
const todo = await createTodo({
  title: 'Prepare presentation',
  tags: ['work', 'urgent'],
  priority: 'high',
  dueDate: '2026-01-25T17:00:00Z',
  source: 'action',
  sourceId: 'act_123',
  items: [
    { title: 'Create slides', priority: 'high' },
    { title: 'Rehearse', priority: 'medium' },
    { title: 'Send to team', priority: 'low' },
  ],
});
```

### Filter Todos

```typescript
// High priority work items
const urgentTodos = await listTodos({
  status: 'pending',
  priority: 'high',
  tags: ['work'],
});

// Archived items
const archived = await listTodos({ archived: true });
```

### Complete Items Progressively

```typescript
// Mark first item complete — todo auto-transitions to in_progress
await updateTodoItem(todoId, item1Id, { status: 'completed' });

// Mark remaining items complete — todo auto-transitions to completed
await updateTodoItem(todoId, item2Id, { status: 'completed' });
await updateTodoItem(todoId, item3Id, { status: 'completed' });
// todo.status is now 'completed', todo.completedAt is set
```

### Archive Completed Todos

```typescript
const todos = await listTodos({ status: 'completed', archived: false });
for (const todo of todos) {
  await archiveTodo(todo.id);
}
```

### Create via Internal API (Other Services)

```typescript
// POST /internal/todos with X-Internal-Auth header
// Status set to 'processing', triggers AI extraction via Pub/Sub
const feedback = await createTodoInternal({
  userId: 'user_123',
  title: 'Weekly Planning',
  description: 'Plan my week: finish presentation, call dentist, review updates',
  tags: ['planning'],
  source: 'commands-agent',
  sourceId: 'cmd_456',
});
// feedback.status = 'completed'
// feedback.resourceUrl = '/#/todos/<todoId>'
```

---

## Internal Endpoints

| Method | Path                                      | Purpose                                |
| ------ | ----------------------------------------- | -------------------------------------- |
| POST   | `/internal/todos`                         | Create todo from other services        |
| POST   | `/internal/todos/pubsub/todos-processing` | Pub/Sub push handler for AI extraction |

---

## Status Workflow

```
draft -> processing -> pending -> in_progress -> completed -> archived
                         |                         ^
                     cancelled ____________________/
```

**Notes:**

- `draft`: Initial state, not yet visible in lists
- `processing`: AI extraction in progress (async via Pub/Sub)
- `pending`: Ready to work on
- `in_progress`: At least one item completed
- `completed`: All items completed (auto-computed or manual)
- `cancelled`: Cancelled before completion (can be archived)
- `archived`: Soft delete, not in default lists

---

## Error Handling

| Error Code | Meaning            | Recovery Action                             |
| ---------- | ------------------ | ------------------------------------------- |
| 400        | Invalid input      | Fix request payload (check required fields) |
| 401        | Unauthorized       | Refresh access token                        |
| 403        | Forbidden          | Verify todo ownership (user ID match)       |
| 404        | Resource not found | Verify todo/item ID exists                  |
| 500        | Server error       | Retry with backoff                          |

---

## AI Item Extraction

Todos created via `/internal/todos` with a `description` trigger automatic AI extraction:

1. Create todo with description -> status = `processing`
2. Pub/Sub event fires -> handler calls LLM via user-service
3. LLM extracts items (Zod-validated via `TodoExtractionResponseSchema`)
4. Items added to todo -> status = `pending`

**Model chain:** Gemini 2.5 Flash (primary), GLM-4.7 (fallback), GLM-4.7-Flash (fallback)

**Fallback behaviors:**

- No API key: Adds warning item with `NO_API_KEY` error
- No items found: Adds "No actionable items found in todo description"
- Extraction fails: Adds "Item extraction failed ({code})" with `high` priority
- No description: Skips extraction, transitions directly to `pending`

---

**Last updated:** 2026-03-07
