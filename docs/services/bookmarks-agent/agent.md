# bookmarks-agent — Agent Interface

> Machine-readable specification for AI agent integration

---

## Identity

| Attribute | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Name      | bookmarks-agent                                                                                   |
| Version   | 3.3.0                                                                                             |
| Port      | 8124                                                                                              |
| Role      | Link Intelligence Service                                                                         |
| Goal      | Save, enrich, and organize bookmarks with OpenGraph metadata, AI summaries, and WhatsApp delivery |

---

## Capabilities

### Create Bookmark (Public)

**Endpoint:** `POST /bookmarks`
**Auth:** Bearer token

**When to use:** When creating a bookmark directly from the web dashboard. Does NOT trigger enrichment pipeline.

**Input Schema:**

```typescript
interface CreateBookmarkInput {
  url: string;         // Valid HTTP/HTTPS URL
  title?: string;
  description?: string;
  tags?: string[];
  source: string;      // e.g., 'manual', 'whatsapp'
  sourceId: string;    // ID in source system
}
```

**Output Schema:**

```typescript
interface CreateBookmarkOutput {
  success: true;
  data: Bookmark;
}
```

### Create Bookmark (Internal)

**Endpoint:** `POST /internal/bookmarks`
**Auth:** `X-Internal-Auth` header

**When to use:** When creating a bookmark from another service (e.g., actions-agent). Triggers async enrichment pipeline (OG fetch → AI summary → WhatsApp notification).

**Input Schema:**

```typescript
interface CreateBookmarkInternalInput {
  userId: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: 'draft' | 'active';
  source: string;
  sourceId: string;
}
```

**Output Schema:**

```typescript
interface CreateBookmarkInternalOutput {
  success: true;
  data: {
    id: string;        // Bookmark ID
    url: string;       // App deep link: "/#/bookmarks/{id}"
    bookmark: Bookmark;
  };
}
```

**Example:**

```json
// Request
{
  "userId": "user-abc-123",
  "url": "https://example.com/article",
  "source": "whatsapp",
  "sourceId": "wamid.123"
}

// Response (201)
{
  "success": true,
  "data": {
    "id": "bk_xyz789",
    "url": "/#/bookmarks/bk_xyz789",
    "bookmark": {
      "id": "bk_xyz789",
      "ogFetchStatus": "pending",
      "aiSummary": null
    }
  }
}
```

### List Bookmarks

**Endpoint:** `GET /bookmarks`
**Auth:** Bearer token

**When to use:** To retrieve all bookmarks for the authenticated user, optionally filtered.

**Query Parameters:**

```typescript
interface ListBookmarksQuery {
  archived?: 'true' | 'false';
  tags?: string;              // Comma-separated tag names
  ogFetchStatus?: 'pending' | 'processed' | 'failed';
}
```

### Get Bookmark

**Endpoint:** `GET /bookmarks/:id`
**Auth:** Bearer token

**When to use:** To retrieve a single bookmark by ID. Returns 403 if the bookmark belongs to a different user.

### Get Bookmark (Internal)

**Endpoint:** `GET /internal/bookmarks/:id?userId={userId}`
**Auth:** `X-Internal-Auth` header

**When to use:** To retrieve a bookmark from another service. Requires `userId` query parameter.

### Update Bookmark

**Endpoint:** `PATCH /bookmarks/:id`
**Auth:** Bearer token

**When to use:** To update user-editable fields (title, description, tags, archived).

**Input Schema:**

```typescript
interface UpdateBookmarkInput {
  title?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
}
```

### Update Bookmark (Internal)

**Endpoint:** `PATCH /internal/bookmarks/:id`
**Auth:** `X-Internal-Auth` header

**When to use:** To update bookmark with enrichment data (OG preview, AI summary). Used by the enrichment pipeline.

**Input Schema:**

```typescript
interface UpdateBookmarkInternalInput {
  title?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
  aiSummary?: string;
  ogPreview?: OpenGraphPreview;
  ogFetchStatus?: 'pending' | 'processed' | 'failed';
}
```

### Delete Bookmark

**Endpoint:** `DELETE /bookmarks/:id`
**Auth:** Bearer token

**When to use:** To permanently delete a bookmark. This is a hard delete.

### Archive / Unarchive

**Endpoint:** `POST /bookmarks/:id/archive` | `POST /bookmarks/:id/unarchive`
**Auth:** Bearer token

**When to use:** To soft-delete (archive) or restore (unarchive) a bookmark. Idempotent — archiving an already-archived bookmark returns success.

### Force Refresh

**Endpoint:** `POST /internal/bookmarks/:id/force-refresh`
**Auth:** `X-Internal-Auth` header

**When to use:** To re-fetch OG metadata for a bookmark. Always fetches fresh data regardless of current `ogFetchStatus`. Synchronous operation (does not use Pub/Sub).

### Image Proxy

**Endpoint:** `GET /images/proxy?url={encodedUrl}`
**Auth:** None

**When to use:** To display external OG images in the web dashboard, bypassing CORS. Returns the raw image bytes with appropriate content type. 10-second timeout. Validates URL is HTTP/HTTPS and response is `image/*`.

---

## Types

```typescript
type OgFetchStatus = 'pending' | 'processed' | 'failed';
type BookmarkStatus = 'draft' | 'active';

interface OpenGraphPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  favicon: string | null;
}

interface Bookmark {
  id: string;
  userId: string;
  status: BookmarkStatus;
  url: string;
  title: string | null;
  description: string | null;
  tags: string[];
  ogPreview: OpenGraphPreview | null;
  ogFetchedAt: string | null;       // ISO 8601
  ogFetchStatus: OgFetchStatus;
  aiSummary: string | null;
  aiSummarizedAt: string | null;    // ISO 8601
  source: string;
  sourceId: string;
  archived: boolean;
  createdAt: string;                // ISO 8601
  updatedAt: string;                // ISO 8601
}
```

---

## Constraints

**Do NOT:**

- Create bookmarks without a valid HTTP/HTTPS URL
- Access bookmarks owned by other users (returns 403)
- Expect OG data or AI summary immediately after creation (async pipeline)
- Send more than one bookmark creation for the same userId+url pair (returns 409 CONFLICT)

**Requires:**

- Bearer token (Auth0 JWT) for public endpoints
- `X-Internal-Auth` header for internal endpoints
- web-agent must be running for enrichment and summarization
- Pub/Sub topics must be configured for async pipeline

---

## Usage Patterns

### Pattern 1: Create and Wait for Enrichment

```
1. POST /internal/bookmarks -> get bookmark ID
2. Poll GET /bookmarks/:id until ogFetchStatus !== 'pending'
3. Bookmark now has ogPreview and aiSummary populated
4. User receives WhatsApp notification automatically
```

### Pattern 2: Handle Duplicate URL

```
1. POST /internal/bookmarks or POST /bookmarks
2. If 409 CONFLICT response:
   a. Extract existingBookmarkId from error.details
   b. GET /bookmarks/:existingBookmarkId to retrieve existing bookmark
```

### Pattern 3: Find Failed Enrichments and Retry

```
1. GET /bookmarks?ogFetchStatus=failed
2. For each failed bookmark:
   POST /internal/bookmarks/:id/force-refresh
```

---

## Event Flow

```
createBookmark (internal)
      |
ogFetchStatus: 'pending'
      |
Pub/Sub: bookmarks.enrich
      |
web-agent fetches OG data
      |
ogFetchStatus: 'processed', ogPreview populated
      |
Pub/Sub: bookmarks.summarize
      |
web-agent generates AI summary
      |                          | (transient error: 429, timeout)
aiSummary populated              HTTP 503 -> Pub/Sub retries with backoff
      |
Pub/Sub: whatsapp.message.send
      |
WhatsApp message delivered to user
```

---

## Error Codes

| Code              | HTTP | Meaning                                             |
| ----------------- | ---- | --------------------------------------------------- |
| `INVALID_REQUEST` | 400  | Malformed request body or URL                       |
| `UNAUTHORIZED`    | 401  | Missing or invalid auth token                       |
| `FORBIDDEN`       | 403  | User cannot access this bookmark                    |
| `NOT_FOUND`       | 404  | Bookmark ID does not exist                          |
| `CONFLICT`        | 409  | URL already bookmarked by this user                 |
| `INTERNAL_ERROR`  | 500  | Unexpected server error                             |
| `TRANSIENT_ERROR` | 503  | Temporary failure (rate limit, timeout) — retryable |

---

## Dependencies

| Service          | Why Needed                 | Failure Behavior                           |
| ---------------- | -------------------------- | ------------------------------------------ |
| web-agent        | OG metadata + AI summaries | Enrichment fails; bookmark remains pending |
| Firestore        | Bookmark persistence       | All operations fail                        |
| Pub/Sub          | Async enrichment pipeline  | Enrichment delayed; retried automatically  |
| whatsapp-service | Summary delivery           | Fire-and-forget; summary still saved       |

---

## Integration Notes

### From actions-agent

When processing a `link` action from WhatsApp:

```typescript
const response = await fetch(`${BOOKMARKS_AGENT_URL}/internal/bookmarks`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
  },
  body: JSON.stringify({
    userId: action.userId,
    url: extractedUrl,
    source: 'whatsapp',
    sourceId: action.sourceId,
  }),
});
```

### WhatsApp Delivery Message Format

After AI summarization, the service publishes a WhatsApp message:

```
📑 *Bookmark Summary*

*[Page Title]*

[AI Summary]

🔗 [Original URL]
```

The title line is omitted if no title is available. `correlationId` is `bookmark-{bookmarkId}`.

---

**Last updated:** 2026-03-15 (v3.3.0 documentation refresh)
