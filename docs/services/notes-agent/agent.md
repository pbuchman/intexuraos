# notes-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with notes-agent.

---

## Identity

| Field    | Value                                               |
| -------- | --------------------------------------------------- |
| **Name** | notes-agent                                         |
| **Role** | Note-Taking Service                                 |
| **Goal** | Quick note capture with tagging and source tracking |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface NotesAgentTools {
  // List all notes for authenticated user — no filter params supported
  listNotes(): Promise<Note[]>;

  // Create new note
  createNote(params: {
    title: string;
    content: string;
    tags: string[];
    source: string;
    sourceId: string;
  }): Promise<Note>;

  // Get single note by ID
  getNote(id: string): Promise<Note>;

  // Update note — only title, content, tags; status cannot be changed
  updateNote(
    id: string,
    params: {
      title?: string;
      content?: string;
      tags?: string[];
    }
  ): Promise<Note>;

  // Delete note
  deleteNote(id: string): Promise<void>;
}
```

### Types

```typescript
// Only two statuses exist — 'archived' is NOT a valid status
type NoteStatus = 'draft' | 'active';

// API response shape (status field is NOT included in responses)
interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

---

## Constraints

| Rule                 | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| **Ownership**        | Users can only access their own notes                                          |
| **Title Required**   | Title must be non-empty                                                        |
| **Content Required** | Content must be present (can be empty string)                                  |
| **No Status Update** | Status cannot be changed after creation via PATCH                              |
| **No Tag Filtering** | List endpoint returns all user notes; no filter support                        |
| **List Order**       | Notes returned ordered by `updatedAt` descending (most recently updated first) |

---

## Usage Patterns

### Create Note

```typescript
const note = await createNote({
  title: 'Meeting Notes - Product Roadmap',
  content: '## Key Points\n- Q1 focus: performance\n- Q2 focus: new features',
  tags: ['meetings', 'product'],
  source: 'action',
  sourceId: 'act_123',
});
```

### Create Draft Note (via internal endpoint only)

```typescript
// Only available via POST /internal/notes (requires X-Internal-Auth header)
// The public POST /notes endpoint does not accept a status field
const feedback = await createNoteInternal({
  userId: 'user_abc',
  title: 'Draft Idea',
  content: 'Work in progress...',
  tags: [],
  status: 'draft',
  source: 'actions-agent',
  sourceId: 'act_456',
});
// Returns ServiceFeedback: { status: 'completed', message: '...', resourceUrl: '/#/notes/<id>' }
```

### List Notes

```typescript
// Returns all notes for the authenticated user — no filtering available
const notes = await listNotes();
```

---

## Internal Endpoints

| Method | Path              | Purpose                         |
| ------ | ----------------- | ------------------------------- |
| POST   | `/internal/notes` | Create note from other services |

**Internal response format:** `ServiceFeedback` (not a Note object):

```typescript
interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string; // e.g. "/#/notes/<id>" on success
  errorCode?: string; // on failure
}
```

---

**Last updated:** 2026-02-19
