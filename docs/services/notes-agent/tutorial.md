# Notes Agent - Tutorial

Getting started with the notes-agent service.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests

## Part 1: Create Your First Note

### Step 1: Create a note

```bash
curl -X POST https://notes-agent.intexuraos.com/notes \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "source": "manual",
    "sourceId": "local-1"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "note_abc123",
    "userId": "user_xyz",
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "source": "manual",
    "sourceId": "local-1",
    "createdAt": "2026-01-13T10:00:00.000Z",
    "updatedAt": "2026-01-13T10:00:00.000Z"
  }
}
```

> **Note:** The `status` field is stored internally but is **not** returned in API responses.

### Step 2: List your notes

```bash
curl https://notes-agent.intexuraos.com/notes \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "note_abc123",
      "title": "Meeting Notes",
      "content": "Discussed Q4 roadmap and deliverables.",
      "tags": ["work", "planning"],
      ...
    }
  ]
}
```

### Step 3: Get a specific note

```bash
curl https://notes-agent.intexuraos.com/notes/note_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 4: Update a note

```bash
curl -X PATCH https://notes-agent.intexuraos.com/notes/note_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Discussed Q4 roadmap, deliverables, and timeline adjustments."
  }'
```

You can update `title`, `content`, and `tags`. Other fields cannot be changed via PATCH.

### Step 5: Delete a note

```bash
curl -X DELETE https://notes-agent.intexuraos.com/notes/note_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected response:**

```json
{ "success": true, "data": {} }
```

## Part 2: Creating Notes via Internal Endpoint

Other services create notes programmatically using the internal endpoint, which supports the optional `status` field:

```bash
curl -X POST https://notes-agent.intexuraos.com/internal/notes \
  -H "X-Internal-Auth: YOUR_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_xyz",
    "title": "Draft Idea",
    "content": "Work in progress...",
    "tags": [],
    "source": "actions-agent",
    "sourceId": "act_456",
    "status": "draft"
  }'
```

**Expected response** (ServiceFeedback format, not a Note object):

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Note \"Draft Idea\" created successfully",
    "resourceUrl": "/#/notes/note_abc123"
  }
}
```

## Part 3: Tag-Based Organization

Tags are stored and returned with each note. While tag-based filtering in the list endpoint is not yet available, you can use tags to organize notes and filter client-side:

```bash
# Get all notes and filter by tag client-side
curl https://notes-agent.intexuraos.com/notes \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  | jq '.data[] | select(.tags[] | contains("work"))'
```

> **Roadmap:** Server-side tag filtering is planned for a future release.

## Troubleshooting

| Issue           | Symptom          | Solution                                                       |
| --------------- | ---------------- | -------------------------------------------------------------- |
| Auth failed     | 401 Unauthorized | Check token validity                                           |
| Note not found  | 404 error        | Verify note ID belongs to your account                         |
| Invalid request | 400 error        | Check required fields (title, content, tags, source, sourceId) |
| Access denied   | 403 error        | Note belongs to a different user                               |
