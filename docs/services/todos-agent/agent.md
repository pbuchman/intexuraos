# todos-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with todos-agent.

---

## Identity

| Field | Value |
| ----- | ----- |
| **Name** | todos-agent |
| **Role** | Task Management Service |
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
  updateTodo(id: string, params: {
    title?: string;
    description?: string;
    tags?: string[];
    priority?: TodoPriority;
    dueDate?: string;
  }): Promise<Todo>;

  // Delete todo
  deleteTodo(id: string): Promise<void>;

  // Add item to todo
  addTodoItem(todoId: string, params: {
    title: string;
    priority?: TodoPriority;
    dueDate?: string;
  }): Promise<Todo>;

  // Update item in todo
  updateTodoItem(todoId: string, itemId: string, params: {
    title?: string;
    status?: TodoItemStatus;
    priority?: TodoPriority;
    dueDate?: string;
  }): Promise<Todo>;

  // Delete item from todo
  deleteTodoItem(todoId: string, itemId: string): Promise<Todo>;

  // Reorder items
  reorderTodoItems(todoId: string, params: {
    itemIds: string[];
  }): Promise<Todo>;

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
type TodoStatus =
  | 'draft'
  | 'processing'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

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

| Rule | Description |
| ---- | ----------- |
| **Archive Restriction** | Can only archive completed or cancelled todos |
| **Cancel Restriction** | Cannot cancel already completed todos |
| **Item Completion** | Completing all items auto-completes the todo |
| **Ownership** | Users can only access their own todos |
| **Reorder** | Item IDs must match existing items exactly |

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

### Complete Items Progressively

```typescript
// Mark first item complete
await updateTodoItem(todoId, itemId, { status: 'completed' });

// When all items completed, todo auto-completes
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

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/internal/todos` | Create todo from actions-agent |
| GET | `/internal/todos/:id` | Get todo for internal services |

---

## Status Workflow

```
draft → processing → pending → in_progress → completed → archived
                        ↓                        ↑
                    cancelled ──────────────────→
```

---

**Last updated:** 2026-01-19
