# Todos Agent — Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 20+, GCP project access, valid Auth0 token
> **You'll learn:** How to create and manage todos, add items, use AI extraction, and handle common errors

---

## What You'll Build

A working integration that:

- Creates todos via the public API and via the internal (agent-to-agent) endpoint
- Manages items within a todo (add, update, reorder, delete)
- Filters and retrieves todo lists by status, priority, and tags
- Handles lifecycle transitions (archive, cancel) correctly

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] A valid Auth0 Bearer token (for public endpoints)
- [ ] The internal auth token (for internal endpoints)
- [ ] Basic understanding of TypeScript/Node.js

---

## Part 1: Your First Todo (5 minutes)

Start with the simplest interaction: create a todo and read it back.

### Step 1.1: Create a Todo

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prepare weekly review",
    "tags": ["work"],
    "source": "manual",
    "sourceId": "tutorial-001"
  }'
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "id": "abc123",
    "userId": "user-xyz",
    "title": "Prepare weekly review",
    "description": null,
    "tags": ["work"],
    "priority": "medium",
    "status": "pending",
    "archived": false,
    "items": [],
    "dueDate": null,
    "completedAt": null,
    "createdAt": "2026-03-15T10:00:00.000Z",
    "updatedAt": "2026-03-15T10:00:00.000Z"
  }
}
```

### What Just Happened?

The service created a todo owned by your user account. Because this came via the public endpoint with no description, the todo starts as `pending` immediately — no AI extraction step. The `source` and `sourceId` fields track where this todo originated.

### Step 1.2: Retrieve It

```bash
curl https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** You should see the same todo with all fields populated.

---

## Part 2: Working with Items (10 minutes)

Now add structure to a todo using items.

### Step 2.1: Create a Todo with Initial Items

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Launch prep",
    "tags": ["launch", "work"],
    "priority": "high",
    "source": "manual",
    "sourceId": "tutorial-002",
    "items": [
      { "title": "Finalize pricing page copy", "dueDate": "2026-03-20T17:00:00.000Z" },
      { "title": "Send beta invites to waitlist" },
      { "title": "Order branded swag", "priority": "low" }
    ]
  }'
```

Items are assigned `position` values starting from 0. The todo starts as `pending` because items were provided at creation.

### Step 2.2: Add an Item Later

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/$TODO_ID/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Schedule demo walkthrough",
    "priority": "high",
    "dueDate": "2026-03-17T09:00:00.000Z"
  }'
```

The response is the full updated todo including all items.

### Step 2.3: Complete an Item

```bash
curl -X PATCH https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/$TODO_ID/items/$ITEM_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "completed" }'
```

**Checkpoint:** Watch the todo's `status` field change automatically. Complete one of four items and the todo transitions to `in_progress`. Complete all four and it transitions to `completed`.

### Step 2.4: Reorder Items

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/$TODO_ID/items/reorder \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": ["item-id-3", "item-id-1", "item-id-2", "item-id-4"]
  }'
```

**Important:** `itemIds` must contain every item ID exactly once. Partial lists are rejected with `400 INVALID_REQUEST`.

---

## Part 3: AI-Powered Extraction (10 minutes)

The real power of todos-agent is creating todos from natural language via the internal endpoint — this is how other agents in the platform call it.

### Step 3.1: Create a Todo with a Description (Internal Endpoint)

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/internal/todos \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-xyz",
    "title": "Board deck preparation",
    "description": "Pull Q3 revenue numbers from the dashboard, draft the narrative section covering growth trends, get design to polish the slides by Friday, and schedule a dry run with the team for next Wednesday.",
    "tags": ["work", "presentation"],
    "source": "actions-agent",
    "sourceId": "action-789"
  }'
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Todo \"Board deck preparation\" created successfully",
    "resourceUrl": "/#/todos/def456"
  }
}
```

### What Just Happened?

The todo was created with `status: processing` and a Pub/Sub event was fired. Behind the scenes, the Pub/Sub handler picks up the event, calls the user's LLM (Gemini 2.5 Flash) via user-service, and extracts structured items from the description. The todo transitions to `pending` with the extracted items once processing completes.

### Step 3.2: Poll for the Processed Result

```bash
curl https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/def456 \
  -H "Authorization: Bearer $TOKEN"
```

Wait a few seconds and retry until `status` changes from `processing` to `pending`. The `items` array will contain the LLM-extracted items — each with a title, and a due date where one was implied.

**Checkpoint:** You should see four items extracted from the description, with "Polish slides" having a Friday due date.

---

## Part 4: Filtering and Lifecycle (5 minutes)

### Step 4.1: Filter Your Todo List

```bash
# Active high-priority work todos
curl "https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos?status=in_progress&priority=high&tags=work" \
  -H "Authorization: Bearer $TOKEN"

# All archived todos
curl "https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos?archived=true" \
  -H "Authorization: Bearer $TOKEN"
```

Tag filtering uses OR logic — passing `tags=work` returns todos tagged with "work".

### Step 4.2: Archive a Completed Todo

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/$TODO_ID/archive \
  -H "Authorization: Bearer $TOKEN"
```

Only `completed` or `cancelled` todos can be archived. Attempting to archive a `pending` todo returns `400 INVALID_REQUEST`.

### Step 4.3: Cancel a Todo

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos/$TODO_ID/cancel \
  -H "Authorization: Bearer $TOKEN"
```

Cancelling a `completed` todo returns `400 INVALID_REQUEST`. Already-cancelled todos return success.

---

## Troubleshooting

| Problem                    | Solution                                                              |
| -------------------------- | --------------------------------------------------------------------- |
| `401 Unauthorized`         | Check your Bearer token is valid and not expired                      |
| `403 Forbidden`            | You are trying to access a todo owned by a different user             |
| `404 Not Found`            | Verify the todo ID exists and belongs to your account                 |
| `400 INVALID_REQUEST`      | Check status restrictions (archive/cancel rules) or reorder item IDs  |
| Todo stuck in `processing` | LLM extraction may have failed; check for a warning item in the todo  |
| Items not extracted        | User account may have no LLM API key configured in user-service       |

---

## Next Steps

Now that you understand the basics:

1. Explore `PATCH /todos/:id` to update title, description, tags, priority, or due date
2. Read the [Technical Reference](technical.md) for the full domain model and AI extraction details
3. Check out [actions-agent](../actions-agent/features.md) to see how voice commands create todos automatically

---

## Exercises

Test your understanding:

1. **Easy:** Create a todo with all optional fields — description, tags, priority, dueDate, and initial items
2. **Medium:** Create a todo via the internal endpoint with a description, poll until processing completes, then complete all items and verify the status becomes `completed`
3. **Hard:** Write a TypeScript function that creates a todo via the internal endpoint, polls `GET /todos/:id` until status is no longer `processing`, and returns the final list of extracted item titles

<details>
<summary>Solutions</summary>

### Exercise 1: All Optional Fields

```bash
curl -X POST https://intexuraos-todos-agent-cj44trunra-lm.a.run.app/todos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Full example todo",
    "description": "A todo with everything set",
    "tags": ["example", "tutorial"],
    "priority": "urgent",
    "dueDate": "2026-04-01T09:00:00.000Z",
    "source": "manual",
    "sourceId": "exercise-1",
    "items": [
      { "title": "First item", "priority": "high" },
      { "title": "Second item", "dueDate": "2026-03-25T17:00:00.000Z" }
    ]
  }'
```

### Exercise 2: Create, Wait, Complete

```bash
# 1. Create via internal endpoint — capture todo ID from resourceUrl
RESOURCE_URL=$(curl -s -X POST .../internal/todos \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-xyz","title":"Test","description":"Write unit tests and review the PR","tags":[],"source":"manual","sourceId":"ex2"}' \
  | jq -r '.data.resourceUrl')
TODO_ID="${RESOURCE_URL##*/}"

# 2. Poll until status is no longer processing
STATUS="processing"
while [ "$STATUS" = "processing" ]; do
  sleep 2
  STATUS=$(curl -s .../todos/$TODO_ID -H "Authorization: Bearer $TOKEN" | jq -r '.data.status')
done

# 3. Complete all items
curl -s .../todos/$TODO_ID -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.items[].id' \
  | while read ITEM_ID; do
      curl -s -X PATCH .../todos/$TODO_ID/items/$ITEM_ID \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"status":"completed"}'
    done
```

### Exercise 3: TypeScript Polling Function

```typescript
async function createAndWaitForExtraction(
  description: string,
  userId: string,
  bearerToken: string,
  internalAuthToken: string
): Promise<string[]> {
  const baseUrl = 'https://intexuraos-todos-agent-cj44trunra-lm.a.run.app';

  // Create via internal endpoint
  const createRes = await fetch(`${baseUrl}/internal/todos`, {
    method: 'POST',
    headers: {
      'X-Internal-Auth': internalAuthToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      title: 'Extracted todo',
      description,
      tags: [],
      source: 'tutorial',
      sourceId: `ex3-${String(Date.now())}`,
    }),
  });

  const created = (await createRes.json()) as { data: { resourceUrl: string } };
  const todoId = created.data.resourceUrl.split('/').pop() ?? '';

  // Poll until no longer processing
  let todo: { status: string; items: Array<{ title: string }> };
  do {
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    const getRes = await fetch(`${baseUrl}/todos/${todoId}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const body = (await getRes.json()) as { data: typeof todo };
    todo = body.data;
  } while (todo.status === 'processing');

  return todo.items.map((item) => item.title);
}
```

</details>
