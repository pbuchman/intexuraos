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
    "title": "Meeting Notes",
    "content": "Discussed Q4 roadmap and deliverables.",
    "tags": ["work", "planning"],
    "status": "active",
    "source": "manual",
    "sourceId": "local-1",
    "createdAt": "2026-01-13T10:00:00Z",
    "updatedAt": "2026-01-13T10:00:00Z"
  }
}
```

### Step 2: List your notes

```bash
curl https://notes-agent.intexuraos.com/notes \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3: Update a note

```bash
curl -X PATCH https://notes-agent.intexuraos.com/notes/note_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Discussed Q4 roadmap, deliverables, and timeline adjustments."
  }'
```

## Part 2: Draft vs Active Status

Notes can be in `draft` or `active` status:

```bash
# Create a draft note
curl -X POST https://notes-agent.intexuraos.com/notes \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Draft Idea",
    "content": "Work in progress...",
    "tags": [],
    "source": "manual",
    "sourceId": "local-2",
    "status": "draft"
  }'
```

## Part 3: Filter by Tags

```bash
# Coming soon: Tag filtering is planned but not yet implemented
```

## Troubleshooting

| Issue           | Symptom              | Solution           |
| ---------------  | -------------------- | ------------------  |
| Auth failed      | 401 Unauthorized     | Check token validity |
| Note not found   | 404 error             | Verify note ID       |
| Invalid request  | 400 error             | Check required fields |
