# notes-agent — Agent Interface

> Machine-readable specification for AI agent integration

---

## Identity

| Attribute | Value                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| Name      | notes-agent                                                                      |
| Role      | User-scoped note storage with tagging and source tracking                        |
| Goal      | Capture and organize text notes from any IntexuraOS service or direct user input |

---

## Capabilities

### List Notes

**Endpoint:** `GET /notes`

**When to use:** Retrieve all notes for the authenticated user. Returns notes ordered by `updatedAt` descending (most recent first). No server-side filtering available.

**Input Schema:**

```typescript
// No request body. Auth via Bearer JWT.
// userId extracted from JWT `sub` claim.
```

**Output Schema:**

```typescript
interface ListNotesResponse {
  success: true;
  data: Note[];
}
```

**Example:**

```json
// Request
// GET /notes
// Authorization: Bearer <jwt>

// Response (200)
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "userId": "auth0|user_xyz",
      "title": "Meeting Notes",
      "content": "Discussed roadmap",
      "tags": ["work"],
      "source": "manual",
      "sourceId": "m-1",
      "createdAt": "2026-03-15T10:00:00.000Z",
      "updatedAt": "2026-03-15T10:05:00.000Z"
    }
  ]
}
```

### Create Note

**Endpoint:** `POST /notes`

**When to use:** Create a new note for the authenticated user. All notes start with `active` status (status field not accepted on this endpoint).

**Input Schema:**

```typescript
interface CreateNoteInput {
  title: string;    // Required, min length 1
  content: string;  // Required, can be empty string
  tags: string[];   // Required, can be empty array
  source: string;   // Required, min length 1 (e.g. "manual", "web")
  sourceId: string; // Required, min length 1 (ID in the source system)
}
```

**Output Schema:**

```typescript
interface CreateNoteResponse {
  success: true;
  data: Note;
}
// HTTP 201
```

**Example:**

```json
// Request
// POST /notes
{
  "title": "Research Findings",
  "content": "Key insights from Q4 analysis",
  "tags": ["research", "q4"],
  "source": "web",
  "sourceId": "web-session-123"
}

// Response (201)
{
  "success": true,
  "data": {
    "id": "def456",
    "userId": "auth0|user_xyz",
    "title": "Research Findings",
    "content": "Key insights from Q4 analysis",
    "tags": ["research", "q4"],
    "source": "web",
    "sourceId": "web-session-123",
    "createdAt": "2026-03-15T11:00:00.000Z",
    "updatedAt": "2026-03-15T11:00:00.000Z"
  }
}
```

### Get Note

**Endpoint:** `GET /notes/:id`

**When to use:** Retrieve a specific note by ID. Returns 403 if the note belongs to a different user.

**Input Schema:**

```typescript
// Path parameter: id (string)
// Auth via Bearer JWT.
```

**Output Schema:**

```typescript
interface GetNoteResponse {
  success: true;
  data: Note;
}
```

### Update Note

**Endpoint:** `PATCH /notes/:id`

**When to use:** Partially update a note's title, content, or tags. Only include fields you want to change. Returns 403 if not the owner. Status, source, sourceId, and userId cannot be changed.

**Input Schema:**

```typescript
interface UpdateNoteInput {
  title?: string;    // Min length 1 if provided
  content?: string;
  tags?: string[];
}
```

**Output Schema:**

```typescript
interface UpdateNoteResponse {
  success: true;
  data: Note; // Full note with updated fields and new updatedAt
}
```

### Delete Note

**Endpoint:** `DELETE /notes/:id`

**When to use:** Permanently delete a note. Returns 403 if not the owner, 404 if not found.

**Output Schema:**

```typescript
interface DeleteNoteResponse {
  success: true;
  data: {};
}
```

### Create Note (Internal)

**Endpoint:** `POST /internal/notes`

**When to use:** Create a note on behalf of a user from another IntexuraOS service. Supports optional `status` field for draft notes. Requires `X-Internal-Auth` header instead of JWT.

**Input Schema:**

```typescript
interface InternalCreateNoteInput {
  userId: string;              // Required, min length 1
  title: string;               // Required, min length 1
  content: string;             // Required
  tags: string[];              // Required
  status?: 'draft' | 'active'; // Optional, defaults to 'active'
  source: string;              // Required, min length 1
  sourceId: string;            // Required, min length 1
}
```

**Output Schema:**

```typescript
interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string; // e.g. "/#/notes/<id>" on success
  errorCode?: string;   // on failure
}

// Wrapped in: { success: true, data: ServiceFeedback }
// HTTP 201 on success, 500 on failure
```

**Example:**

```json
// Request
// POST /internal/notes
// X-Internal-Auth: <token>
{
  "userId": "auth0|user_xyz",
  "title": "Action Output",
  "content": "Results from research query",
  "tags": ["research"],
  "status": "draft",
  "source": "actions-agent",
  "sourceId": "act_123"
}

// Response (201)
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Note \"Action Output\" created successfully",
    "resourceUrl": "/#/notes/ghi789"
  }
}
```

---

## Types

```typescript
// NoteStatus — only two values exist
type NoteStatus = 'draft' | 'active';

// API response shape (status field is NOT included in public responses)
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
| **Ownership**        | Users can only access their own notes (enforced at use case layer)             |
| **Title Required**   | Title must be non-empty string (min length 1)                                  |
| **Content Required** | Content must be present (can be empty string)                                  |
| **Source Required**  | Source and sourceId must be non-empty strings                                  |
| **No Status Update** | Status cannot be changed after creation via any endpoint                       |
| **No Tag Filtering** | List endpoint returns all user notes; no server-side filter support            |
| **No Pagination**    | List endpoint returns all notes in a single response                           |
| **List Order**       | Notes returned ordered by `updatedAt` descending (most recently updated first) |
| **Status Hidden**    | Public API responses do not include the `status` field                         |

**Do NOT:**

- Assume the list endpoint supports filtering — it returns all notes
- Send `status` to the public `POST /notes` endpoint — it is ignored
- Expect a Note object from `/internal/notes` — it returns ServiceFeedback
- Try to update `source`, `sourceId`, `status`, or `userId` via PATCH

**Requires:**

- Valid Bearer JWT token for public endpoints
- Valid `X-Internal-Auth` header for internal endpoint
- `source` and `sourceId` on every note creation (provenance tracking)

---

## Error Handling

| Error Code      | HTTP | Meaning                               | Recovery Action                     |
| --------------- | ---- | ------------------------------------- | ----------------------------------- |
| UNAUTHORIZED    | 401  | Missing or invalid auth token         | Refresh JWT or check internal token |
| FORBIDDEN       | 403  | Note belongs to a different user      | Verify you own the note             |
| NOT_FOUND       | 404  | Note does not exist                   | Verify the note ID                  |
| INVALID_REQUEST | 400  | Missing required fields or validation | Check request body against schema   |
| INTERNAL_ERROR  | 500  | Firestore or server failure           | Retry with backoff                  |

---

## Usage Patterns

### Pattern 1: Service Creates Note for User

```
1. Service receives action completion
2. Call POST /internal/notes with userId, content, source, sourceId
3. Parse resourceUrl from ServiceFeedback response
4. Log or forward the resourceUrl to the user
```

### Pattern 2: User CRUD via Dashboard

```
1. GET /notes to list all notes
2. POST /notes to create a new note
3. PATCH /notes/:id to update content or tags
4. DELETE /notes/:id to remove a note
```

### Pattern 3: Client-Side Tag Filtering

```
1. GET /notes to retrieve all notes
2. Filter locally: notes.filter(n => n.tags.includes('work'))
3. Display filtered results
```

---

## Dependencies

| Service      | Why Needed           | Failure Behavior  |
| ------------ | -------------------- | ----------------- |
| Firestore    | Note persistence     | 500 STORAGE_ERROR |
| Auth0 (JWKS) | JWT token validation | 401 UNAUTHORIZED  |

---

**Last updated:** 2026-03-15
