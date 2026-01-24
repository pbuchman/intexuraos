# bookmarks-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with bookmarks-agent.

---

## Identity

| Field    | Value                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- |
| **Name** | bookmarks-agent                                                                                   |
| **Role** | Link Intelligence Service                                                                         |
| **Goal** | Save, enrich, and organize bookmarks with OpenGraph metadata, AI summaries, and WhatsApp delivery |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface BookmarksAgentTools {
  // List bookmarks with filters
  listBookmarks(params?: {
    archived?: boolean;
    tags?: string[];
    ogFetchStatus?: OgFetchStatus;
  }): Promise<Bookmark[]>;

  // Create new bookmark (triggers async enrichment + WhatsApp notification)
  createBookmark(params: {
    url: string;
    title?: string;
    description?: string;
    tags?: string[];
    source: string;
    sourceId: string;
  }): Promise<Bookmark>;

  // Get single bookmark
  getBookmark(id: string): Promise<Bookmark>;

  // Update bookmark
  updateBookmark(
    id: string,
    params: {
      title?: string;
      description?: string;
      tags?: string[];
      archived?: boolean;
    }
  ): Promise<Bookmark>;

  // Delete bookmark
  deleteBookmark(id: string): Promise<void>;

  // Archive bookmark
  archiveBookmark(id: string): Promise<Bookmark>;

  // Unarchive bookmark
  unarchiveBookmark(id: string): Promise<Bookmark>;

  // Force refresh OG metadata (internal only)
  forceRefreshBookmark(id: string): Promise<Bookmark>;

  // Proxy external image (bypasses CORS)
  proxyImage(params: { url: string }): Promise<Buffer>;
}
```

### Types

```typescript
type OgFetchStatus = 'pending' | 'processed' | 'failed';
type BookmarkStatus = 'draft' | 'active';

interface OgPreview {
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
  ogPreview: OgPreview | null;
  ogFetchedAt: string | null;
  ogFetchStatus: OgFetchStatus;
  aiSummary: string | null;
  aiSummarizedAt: string | null;
  source: string;
  sourceId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| **Duplicate Detection**   | Returns 409 CONFLICT if URL already bookmarked by user |
| **URL Format**            | Must be valid HTTP/HTTPS URL                           |
| **Ownership**             | Users can only access their own bookmarks              |
| **Image Proxy**           | Only HTTP/HTTPS images allowed, 10s timeout            |
| **Async Enrichment**      | OG data and AI summary populate after creation         |
| **WhatsApp Notification** | Summary sent to user's WhatsApp after AI processing    |

---

## Usage Patterns

### Create Bookmark with WhatsApp Notification

```typescript
// Creation returns immediately with pending status
const bookmark = await createBookmark({
  url: 'https://example.com/article',
  tags: ['tech', 'reading'],
  source: 'action',
  sourceId: 'act_123',
});

// bookmark.ogFetchStatus === 'pending'
// bookmark.aiSummary === null

// After async processing (5-10 seconds):
// 1. ogPreview populated
// 2. aiSummary populated
// 3. WhatsApp message sent to user with summary
```

### Wait for Enrichment

```typescript
let bookmark = await getBookmark(id);
while (bookmark.ogFetchStatus === 'pending') {
  await sleep(2000);
  bookmark = await getBookmark(id);
}
// bookmark.ogPreview and bookmark.aiSummary now populated
```

### Handle Duplicate

```typescript
try {
  const bookmark = await createBookmark({
    url: 'https://example.com/article',
    source: 'whatsapp',
    sourceId: 'wamid.123',
  });
} catch (error) {
  if (error.code === 'CONFLICT') {
    // Bookmark already exists
    const existingId = error.details.existingBookmarkId;
    const existing = await getBookmark(existingId);
    // Use existing bookmark instead
  }
}
```

### Filter by Tag

```typescript
const techBookmarks = await listBookmarks({
  tags: ['tech'],
  archived: false,
});
```

### Find Failed Enrichments

```typescript
const failedBookmarks = await listBookmarks({
  ogFetchStatus: 'failed',
});
// Consider force-refreshing these or alerting user
```

---

## Internal Endpoints

| Method | Path                                    | Purpose                              |
| ------ | --------------------------------------- | ------------------------------------ |
| POST   | `/internal/bookmarks`                   | Create bookmark from actions-agent   |
| GET    | `/internal/bookmarks/:id`               | Get bookmark for internal services   |
| PATCH  | `/internal/bookmarks/:id`               | Update bookmark with OG/AI data      |
| POST   | `/internal/bookmarks/:id/force-refresh` | Force refresh OG data                |
| POST   | `/internal/bookmarks/pubsub/enrich`     | Pub/Sub handler for OG enrichment    |
| POST   | `/internal/bookmarks/pubsub/summarize`  | Pub/Sub handler for AI summarization |

---

## Event Flow (INT-210)

```
createBookmark
      ↓
ogFetchStatus: 'pending'
      ↓
Pub/Sub: bookmarks.enrich
      ↓
web-agent fetches OG data
      ↓
ogFetchStatus: 'processed', ogPreview populated
      ↓
Pub/Sub: bookmarks.summarize
      ↓
web-agent generates AI summary
      ↓
aiSummary populated
      ↓
Pub/Sub: whatsapp.message.send
      ↓
WhatsApp message delivered to user
```

---

## Error Codes

| Code              | HTTP | Meaning                             |
| ----------------- | ---- | ----------------------------------- |
| `INVALID_REQUEST` | 400  | Malformed request body or URL       |
| `UNAUTHORIZED`    | 401  | Missing or invalid auth token       |
| `FORBIDDEN`       | 403  | User cannot access this bookmark    |
| `NOT_FOUND`       | 404  | Bookmark ID does not exist          |
| `CONFLICT`        | 409  | URL already bookmarked by this user |
| `INTERNAL_ERROR`  | 500  | Unexpected server error             |

---

## Integration Notes

### From actions-agent

When processing a `link` action:

```typescript
// actions-agent calls internal endpoint
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

### WhatsApp Delivery

The service publishes to `whatsapp.message.send` topic after AI summarization. The message format:

```
[Page Title]

[AI Summary]

[Original URL]
```

whatsapp-service's SendMessageWorker handles delivery using the userId to look up the phone number.

---

**Last updated:** 2026-01-24
