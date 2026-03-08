# Notes Agent -- Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** IntexuraOS development environment, Auth0 access token
> **You will learn:** How to create, read, update, and delete notes via the REST API, and how internal services create notes programmatically

---

## What You Will Build

A working integration that:

- Creates notes with tags and source tracking
- Lists and retrieves notes for an authenticated user
- Updates note content using partial PATCH requests
- Deletes notes with ownership verification
- Creates notes via the internal service endpoint

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS development environment running (`pnpm dev` or PM2)
- [ ] Valid Auth0 access token (`$TOKEN`)
- [ ] Internal auth token (`$INTERNAL_TOKEN`) for Part 5
- [ ] `curl` and `jq` installed

**Base URL:** `http://localhost:8121` (local) or `https://intexuraos-notes-agent-cj44trunra-lm.a.run.app` (Cloud Run)

---

## Part 1: Create Your First Note (3 minutes)

### Step 1.1: Create a Note

```bash
curl -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "source": "manual",
    "sourceId": "local-1"
  }'
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "id": "abc123def456",
    "userId": "auth0|user_xyz",
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "source": "manual",
    "sourceId": "local-1",
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:00:00.000Z"
  }
}
```

### What Just Happened?

The notes-agent authenticated your JWT, extracted your `userId` from the `sub` claim, created a Firestore document in the `notes` collection, and returned the full note with auto-generated ID and timestamps. The `status` field defaults to `'active'` but is intentionally omitted from the API response.

**Save the note ID for the next steps:**

```bash
NOTE_ID=$(curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "source": "manual",
    "sourceId": "local-1"
  }' | jq -r '.data.id')
echo "Created note: $NOTE_ID"
```

---

## Part 2: List and Retrieve Notes (3 minutes)

### Step 2.1: List All Your Notes

```bash
curl -s http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "abc123def456",
      "userId": "auth0|user_xyz",
      "title": "Meeting Notes",
      "content": "Discussed Q4 roadmap and deliverables.",
      "tags": ["work", "planning"],
      "source": "manual",
      "sourceId": "local-1",
      "createdAt": "2026-02-22T10:00:00.000Z",
      "updatedAt": "2026-02-22T10:00:00.000Z"
    }
  ]
}
```

Notes are returned ordered by `updatedAt` descending -- most recently updated first. Only notes belonging to your `userId` are returned.

### Step 2.2: Get a Specific Note

```bash
curl -s http://localhost:8121/notes/$NOTE_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Checkpoint:** You should see the exact note you created, with all fields populated.

---

## Part 3: Update a Note (3 minutes)

### Step 3.1: Update the Content

PATCH requests allow partial updates. You can update `title`, `content`, and `tags` independently.

```bash
curl -s -X PATCH http://localhost:8121/notes/$NOTE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Discussed Q4 roadmap, deliverables, and timeline adjustments.",
    "tags": ["work", "planning", "q4"]
  }' | jq
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "abc123def456",
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap, deliverables, and timeline adjustments.",
    "tags": ["work", "planning", "q4"],
    "updatedAt": "2026-02-22T10:05:00.000Z"
  }
}
```

Notice that `updatedAt` changed but `createdAt` remains the same. Fields you did not include in the PATCH body (`title`) remain unchanged.

### What You Cannot Update

The following fields are immutable after creation: `status`, `source`, `sourceId`, `userId`. Attempting to include them in a PATCH body has no effect (they are not in the `UpdateNoteInput` schema).

---

## Part 4: Delete a Note (2 minutes)

### Step 4.1: Delete the Note

```bash
curl -s -X DELETE http://localhost:8121/notes/$NOTE_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected response:**

```json
{
  "success": true,
  "data": {}
}
```

### Step 4.2: Verify Deletion

```bash
curl -s http://localhost:8121/notes/$NOTE_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected response (404):**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Note not found"
  }
}
```

---

## Part 5: Internal Note Creation (5 minutes)

Other IntexuraOS services create notes programmatically using the internal endpoint. This bypasses JWT auth and uses the `X-Internal-Auth` header instead.

### Step 5.1: Create a Note via Internal Endpoint

```bash
curl -s -X POST http://localhost:8121/internal/notes \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "auth0|user_xyz",
    "title": "Research Results: AI Trends 2026",
    "content": "Key findings from multi-model research query...",
    "tags": ["research", "ai"],
    "source": "actions-agent",
    "sourceId": "act_789",
    "status": "draft"
  }' | jq
```

**Expected response (201, ServiceFeedback format):**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Note \"Research Results: AI Trends 2026\" created successfully",
    "resourceUrl": "/#/notes/xyz789abc"
  }
}
```

### Key Differences from Public Endpoint

| Aspect        | Public (`POST /notes`)                | Internal (`POST /internal/notes`)        |
| ------------- | ------------------------------------- | ---------------------------------------- |
| Auth          | Bearer JWT (userId from `sub` claim)  | `X-Internal-Auth` header                 |
| userId        | Extracted from JWT automatically      | Provided in request body                 |
| status field  | Not accepted (always `active`)        | Optional (`draft` or `active`)           |
| Response body | Full Note object                      | ServiceFeedback with `resourceUrl`       |

---

## Part 6: Tag-Based Organization (3 minutes)

Tags are stored and returned with each note. While server-side tag filtering is not yet available, you can filter client-side.

### Step 6.1: Create Notes with Different Tags

```bash
# Work note
curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Sprint Review","content":"Demo went well","tags":["work","sprint"],"source":"manual","sourceId":"m-1"}'

# Personal note
curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Grocery List","content":"Milk, eggs, bread","tags":["personal","shopping"],"source":"manual","sourceId":"m-2"}'
```

### Step 6.2: Filter by Tag (Client-Side)

```bash
curl -s http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data[] | select(.tags | index("work"))'
```

> **Roadmap:** Server-side tag filtering via query parameters is planned for a future release.

---

## Troubleshooting

| Problem         | Symptom                  | Solution                                                             |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| Auth failed     | 401 Unauthorized         | Check JWT token validity and ensure correct audience/issuer          |
| Note not found  | 404 NOT_FOUND            | Verify note ID exists and belongs to your account                    |
| Access denied   | 403 FORBIDDEN            | Note belongs to a different user                                     |
| Invalid request | 400 Bad Request          | Check required fields: title, content, tags, source, sourceId        |
| Server error    | 500 INTERNAL_ERROR       | Check Firestore connectivity; review service logs                    |
| Internal auth   | 401 on /internal/notes   | Verify X-Internal-Auth header matches INTEXURAOS_INTERNAL_AUTH_TOKEN |

---

## Next Steps

Now that you understand the basics:

1. Read the [Technical Reference](technical.md) for full API details and domain model documentation
2. Explore the [Agent Interface](agent.md) for programmatic integration patterns
3. Check [Technical Debt](technical-debt.md) for planned features like tag filtering

---

## Exercises

Test your understanding:

1. **Easy:** Create a note with three tags and verify they are returned in the list response
2. **Medium:** Create two notes, update one, then list notes and confirm the updated note appears first (ordered by `updatedAt`)
3. **Hard:** Write a script that creates a note via the internal endpoint, then retrieves it via the public endpoint using the ID from the `resourceUrl` field

<details>
<summary>Solutions</summary>

### Exercise 1: Three Tags

```bash
curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Tagged Note","content":"Testing tags","tags":["alpha","beta","gamma"],"source":"manual","sourceId":"ex-1"}' \
  | jq '.data.tags'
# Expected: ["alpha", "beta", "gamma"]
```

### Exercise 2: Update Ordering

```bash
# Create two notes
ID1=$(curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First Note","content":"Created first","tags":[],"source":"manual","sourceId":"ex-2a"}' \
  | jq -r '.data.id')

sleep 1

ID2=$(curl -s -X POST http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Second Note","content":"Created second","tags":[],"source":"manual","sourceId":"ex-2b"}' \
  | jq -r '.data.id')

# Update the first note
curl -s -X PATCH http://localhost:8121/notes/$ID1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First Note (Updated)"}' > /dev/null

# List and check order -- first note should now be at index 0
curl -s http://localhost:8121/notes \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data[0].title'
# Expected: "First Note (Updated)"
```

### Exercise 3: Internal Create then Public Retrieve

```bash
# Create via internal endpoint
RESOURCE_URL=$(curl -s -X POST http://localhost:8121/internal/notes \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"auth0|user_xyz","title":"From Internal","content":"Created internally","tags":["internal"],"source":"test","sourceId":"ex-3"}' \
  | jq -r '.data.resourceUrl')

# Extract note ID from resourceUrl (format: /#/notes/<id>)
INTERNAL_NOTE_ID=$(echo $RESOURCE_URL | sed 's|/#/notes/||')

# Retrieve via public endpoint
curl -s http://localhost:8121/notes/$INTERNAL_NOTE_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.data.title'
# Expected: "From Internal"
```

</details>
