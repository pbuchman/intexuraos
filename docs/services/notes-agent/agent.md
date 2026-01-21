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
  // List notes with filters
  listNotes(params?: { status?: NoteStatus; tags?: string[] }): Promise<Note[]>;

  // Create new note
  createNote(params: {
    title: string;
    content: string;
    tags?: string[];
    source: string;
    sourceId: string;
  }): Promise<Note>;

  // Get single note
  getNote(id: string): Promise<Note>;

  // Update note
  updateNote(
    id: string,
    params: {
      title?: string;
      content?: string;
      tags?: string[];
      status?: NoteStatus;
    }
  ): Promise<Note>;

  // Delete note
  deleteNote(id: string): Promise<void>;
}
```

### Types

```typescript
type NoteStatus = 'draft' | 'active' | 'archived';

interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  status: NoteStatus;
  source: string;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule                 | Description                           |
| -------------------- | ------------------------------------- |
| **Ownership**        | Users can only access their own notes |
| **Title Required**   | Title must be non-empty               |
| **Content Required** | Content must be non-empty             |

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

### Archive Note

```typescript
await updateNote(noteId, { status: 'archived' });
```

### Filter by Tags

```typescript
const meetingNotes = await listNotes({
  tags: ['meetings'],
  status: 'active',
});
```

---

## Internal Endpoints

| Method | Path                  | Purpose                        |
| ------ | --------------------- | ------------------------------ |
| POST   | `/internal/notes`     | Create note from actions-agent |
| GET    | `/internal/notes/:id` | Get note for internal services |

---

**Last updated:** 2026-01-19
