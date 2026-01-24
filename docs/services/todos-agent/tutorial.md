# Todos Agent - Tutorial

Getting started with the todos-agent service.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests

## Part 1: Create Your First Todo

### Step 1: Create a todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Complete project documentation",
    "description": "Write technical docs for all services",
    "tags": ["work", "documentation"],
    "priority": "high",
    "source": "manual",
    "sourceId": "local-1"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "todo_abc123",
    "userId": "user_123",
    "title": "Complete project documentation",
    "description": "Write technical docs for all services",
    "tags": ["work", "documentation"],
    "priority": "high",
    "status": "pending",
    "archived": false,
    "items": [],
    "source": "manual",
    "sourceId": "local-1",
    "createdAt": "2026-01-13T10:00:00Z",
    "updatedAt": "2026-01-13T10:00:00Z"
  }
}
```

### Step 2: List your todos

```bash
curl "https://todos-agent.intexuraos.com/todos" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3: Update a todo

```bash
curl -X PATCH https://todos-agent.intexuraos.com/todos/todo_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "urgent"
  }'
```

## Part 2: Todo with Items

Create a todo with sub-items:

```bash
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q4 Planning",
    "description": "Prepare for Q4",
    "tags": ["planning"],
    "priority": "high",
    "source": "manual",
    "sourceId": "q4-plan",
    "items": [
      { "title": "Review Q3 results", "priority": "high" },
      { "title": "Set Q4 objectives", "priority": "medium" },
      { "title": "Schedule team meetings", "priority": "low" }
    ]
  }'
```

## Part 3: Todo Lifecycle

### Archive a completed todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/archive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Cancel a todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/cancel \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Unarchive a todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/unarchive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 4: Managing Todo Items

### Add an item to a todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/items \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New subtask",
    "priority": "medium"
  }'
```

### Update a todo item

```bash
curl -X PATCH https://todos-agent.intexuraos.com/todos/todo_abc123/items/item_456 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed"
  }'
```

### Reorder todo items

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/items/reorder \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": ["item_456", "item_789", "item_123"]
  }'
```

## Part 5: Filter Todos

```bash
# Filter by status
curl "https://todos-agent.intexuraos.com/todos?status=pending" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Filter by priority
curl "https://todos-agent.intexuraos.com/todos?priority=high" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Filter by tags
curl "https://todos-agent.intexuraos.com/todos?tags=work,urgent" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Filter archived
curl "https://todos-agent.intexuraos.com/todos?archived=false" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

| Issue             | Symptom          | Solution                         |
| ----------------- | ---------------- | -------------------------------- |
| Auth failed       | 401 Unauthorized | Check token validity             |
| Todo not found    | 404 error        | Verify todo ID                   |
| Invalid request   | 400 error        | Check required fields            |
| Invalid operation | 422 error        | Todo already completed/cancelled |
