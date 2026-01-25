# Todos Agent — Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 22+, GCP project access, Auth0 access token
> **You'll learn:** How to create todos, manage items, and integrate with the AI item extraction feature

---

## What You'll Build

A working integration that:

- Creates todos with sub-items
- Filters and searches todos
- Manages todo lifecycle (archive, cancel)
- Updates and reorders todo items

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] Auth0 device code flow for access token
- [ ] Basic understanding of TypeScript/Node.js
- [ ] todos-agent service running locally or deployed

---

## Part 1: Create Your First Todo (5 minutes)

Let's start with the simplest possible interaction.

### Step 1.1: Make Your First Request

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
    "createdAt": "2026-01-25T10:00:00Z",
    "updatedAt": "2026-01-25T10:00:00Z"
  }
}
```

### What Just Happened?

You created a todo. The service assigned a unique ID, set the status to `pending`, and initialized an empty items array. The `source` and `sourceId` fields track where the todo originated.

---

## Part 2: List and Filter Todos (5 minutes)

### Step 2.1: List All Your Todos

```bash
curl "https://todos-agent.intexuraos.com/todos" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 2.2: Filter by Status

```bash
curl "https://todos-agent.intexuraos.com/todos?status=pending" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 2.3: Filter by Priority

```bash
curl "https://todos-agent.intexuraos.com/todos?priority=high" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 2.4: Filter by Tags

```bash
curl "https://todos-agent.intexuraos.com/todos?tags=work,urgent" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Checkpoint:** You should see only todos matching your filters. Tags use OR logic (todos matching ANY tag).

---

## Part 3: Create Todo with Items (10 minutes)

Now let's create a todo with sub-items.

### Step 3.1: Create with Pre-defined Items

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

**Expected response:** The todo includes an `items` array with three items, each with a position (0, 1, 2).

### Step 3.2: Add an Item to Existing Todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/items \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New subtask",
    "priority": "medium"
  }'
```

**Checkpoint:** The new item appears at the end of the items list with the next position number.

---

## Part 4: Manage Todo Items (5 minutes)

### Step 4.1: Update an Item's Status

```bash
curl -X PATCH https://todos-agent.intexuraos.com/todos/todo_abc123/items/item_456 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed"
  }'
```

### Step 4.2: Reorder Items

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/items/reorder \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": ["item_456", "item_789", "item_123"]
  }'
```

**Note:** Reordering requires ALL item IDs. Provide them in the new order you want.

### Step 4.3: Delete an Item

```bash
curl -X DELETE https://todos-agent.intexuraos.com/todos/todo_abc123/items/item_456 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Checkpoint:** The item is removed and remaining items keep their positions.

---

## Part 5: Todo Lifecycle (5 minutes)

### Step 5.1: Update a Todo

```bash
curl -X PATCH https://todos-agent.intexuraos.com/todos/todo_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "urgent"
  }'
```

### Step 5.2: Archive a Completed Todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/archive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Note:** Only completed or cancelled todos can be archived. You'll get a 422 error if you try to archive a pending todo.

### Step 5.3: Cancel a Todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/cancel \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Note:** Cannot cancel already completed todos.

### Step 5.4: Unarchive a Todo

```bash
curl -X POST https://todos-agent.intexuraos.com/todos/todo_abc123/unarchive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Checkpoint:** The todo returns to your active list with its previous status.

---

## Part 6: AI Item Extraction (Real-World Scenario)

### Scenario: Natural Language to Structured Items

When you create a todo with a detailed description, the AI extracts actionable items automatically.

```bash
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Weekly Planning",
    "description": "Plan my week: finish sales presentation by Wednesday, call dentist on Tuesday afternoon, review team updates on Friday morning",
    "tags": ["planning"],
    "priority": "medium",
    "source": "manual",
    "sourceId": "week-plan"
  }'
```

**What happens:**

1. Todo created with `status: processing`
2. Pub/Sub event triggers the AI extraction
3. Your LLM (Gemini or GLM) parses the description
4. Items added: "Finish sales presentation", "Call dentist", "Review team updates"
5. Due dates and priorities inferred from context
6. Status changes to `pending`

**Result:** Poll the todo after a few seconds to see the extracted items.

```bash
# Wait 2-3 seconds, then:
curl "https://todos-agent.intexuraos.com/todos/todo_abc123" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Troubleshooting

| Issue             | Symptom          | Solution                               |
| ----------------- | ---------------- | -------------------------------------- |
| Auth failed       | 401 Unauthorized | Check your access token is valid       |
| Todo not found    | 404 error        | Verify the todo ID                     |
| Invalid request   | 400 error        | Check required fields (title, tags)    |
| Invalid operation | 422 error        | Todo already completed / wrong status  |
| Archive failed    | 422 error        | Only completed/cancelled todos archive |
| Cancel failed     | 422 error        | Cannot cancel already completed todos  |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API details
2. Learn about the [AI item extraction](technical.md#ai-item-extraction) feature
3. Check out [commands-agent](../commands-agent/features.md) for creating todos from natural language

---

## Exercises

Test your understanding:

1. **Easy:** Create a todo with 3 items and mark one as completed
2. **Medium:** Create a todo, filter it by tag, update its priority, then archive it
3. **Hard:** Create a todo with a complex description, wait for AI extraction, verify items

<details>
<summary>Solutions</summary>

### Exercise 1: Create with Items and Complete

```bash
# Create todo with items
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Shopping",
    "tags": ["personal"],
    "priority": "medium",
    "source": "manual",
    "sourceId": "shop-1",
    "items": [
      {"title": "Buy groceries"},
      {"title": "Pick up dry cleaning"},
      {"title": "Return library books"}
    ]
  }'

# Mark first item completed (use returned todo and item IDs)
curl -X PATCH https://todos-agent.intexuraos.com/todos/TODO_ID/items/ITEM_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

### Exercise 2: Filter, Update, Archive

```bash
# Create with specific tag
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Team meeting prep",
    "tags": ["work"],
    "priority": "high",
    "source": "manual",
    "sourceId": "meeting-1"
  }'

# Filter by tag
curl "https://todos-agent.intexuraos.com/todos?tags=work" \
  -H "Authorization: Bearer $TOKEN"

# Update priority
curl -X PATCH https://todos-agent.intexuraos.com/todos/TODO_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"priority": "urgent"}'

# Mark completed (required before archive)
# Note: There's no direct "complete" endpoint, so update status
curl -X PATCH https://todos-agent.intexuraos.com/todos/TODO_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'

# Archive
curl -X POST https://todos-agent.intexuraos.com/todos/TODO_ID/archive \
  -H "Authorization: Bearer $TOKEN"
```

### Exercise 3: AI Extraction

```bash
# Create with complex description
curl -X POST https://todos-agent.intexuraos.com/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Project Launch",
    "description": "Prepare for product launch next month: finalize marketing copy by end of week, schedule press release for Monday, coordinate with sales team on pricing, prepare demo video for launch day",
    "tags": ["work", "launch"],
    "priority": "high",
    "source": "manual",
    "sourceId": "launch-1"
  }'

# Wait 3-5 seconds, then retrieve to see extracted items
sleep 5
curl "https://todos-agent.intexuraos.com/todos/TODO_ID" \
  -H "Authorization: Bearer $TOKEN"
```

</details>
