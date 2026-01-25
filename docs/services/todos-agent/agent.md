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

  // Reorder items
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

  // Cancel todo
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

| Rule                    | Description                                   |
| ----------------------- | --------------------------------------------- |
| **Archive Restriction** | Can only archive completed or cancelled todos |
| **Cancel Restriction**  | Cannot cancel already completed todos         |
| **Item Completion**     | Items are independent - no auto-complete      |
| **Ownership**           | Users can only access their own todos         |
| **Reorder**             | Item IDs must match existing items exactly    |
| **Description Limit**   | Descriptions over 10,000 chars are truncated  |

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
// Mark first item complete
await updateTodoItem(todoId, itemId, { status: 'completed' });

// Items are independent - todo does NOT auto-complete
// To complete todo, use updateTodo with status: 'completed'
await updateTodo(todoId, { status: 'completed' });
```

### Archive Completed Todos

```typescript
const todos = await listTodos({ status: 'completed', archived: false });
for (const todo of todos) {
  await archiveTodo(todo.id);
}
```

---

## Internal Endpoints

| Method | Path                                      | Purpose                        |
| ------ | ----------------------------------------- | ------------------------------ |
| POST   | `/internal/todos`                         | Create todo from actions-agent |
| POST   | `/internal/todos/pubsub/todos-processing` | Pub/Sub push handler           |

---

## Status Workflow

```
draft → processing → pending → in_progress → completed → archived
                        ↓                        ↑
                    cancelled ──────────────────→
```

**Notes:**

- `draft`: Initial state, not visible in lists
- `processing`: AI extraction in progress (async via Pub/Sub)
- `pending`: Ready to work on
- `in_progress`: Currently being worked on
- `completed`: Done (can be archived)
- `cancelled`: Cancelled before completion (can be archived)
- `archived`: Soft delete, not in default lists

---

## Error Handling

| Error Code | Meaning            | Recovery Action           |
| ---------- | ------------------ | ------------------------- |
| 400        | Invalid input      | Fix request payload       |
| 401        | Unauthorized       | Refresh token             |
| 403        | Forbidden          | Verify todo ownership     |
| 404        | Resource not found | Verify todo ID exists     |
| 422        | Invalid operation  | Check status restrictions |
| 500        | Server error       | Retry with backoff        |

---

## AI Item Extraction

Todos with a `description` trigger automatic AI item extraction:

1. Create todo with description → status = `processing`
2. Pub/Sub event fires → handler calls LLM
3. LLM extracts items (Zod-validated)
4. Items added to todo → status = `pending`

**Fallback behaviors:**

- No API key: Adds warning item "No API key configured"
- No items found: Adds "No actionable items found"
- Extraction fails: Adds "Item extraction failed (code)"

---

**Last updated:** 2026-01-25
