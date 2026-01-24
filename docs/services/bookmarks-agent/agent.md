# bookmarks-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with bookmarks-agent.

---

## Identity

| Field    | Value                                                                         |
| --------  | -----------------------------------------------------------------------------  |
| **Name** | bookmarks-agent                                                               |
| **Role** | Link Intelligence Service                                                     |
| **Goal** | Save, enrich, and organize bookmarks with OpenGraph metadata and AI summaries |

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

  // Create new bookmark
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

  // Proxy external image (bypasses CORS)
  proxyImage(params: { url: string }): Promise<Buffer>;
}
```

### Types

```typescript
type OgFetchStatus = 'pending' | 'processed' | 'failed';

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

| Rule                    | Description                                    |
| -----------------------  | ----------------------------------------------  |
| **Duplicate Detection** | Returns 409 CONFLICT if URL already bookmarked |
| **URL Format**          | Must be valid HTTP/HTTPS URL                   |
| **Ownership**           | Users can only access their own bookmarks      |
| **Image Proxy**         | Only HTTP/HTTPS images allowed, 10s timeout    |

---

## Usage Patterns

### Create Bookmark

```typescript
try {
  const bookmark = await createBookmark({
    url: 'https://example.com/article',
    tags: ['tech', 'reading'],
    source: 'action',
    sourceId: 'act_123',
  });
  // OG data will be fetched asynchronously
} catch (error) {
  if (error.code === 'CONFLICT') {
    // Bookmark already exists
    const existingId = error.details.existingBookmarkId;
  }
}
```

### Wait for OG Enrichment

```typescript
let bookmark = await getBookmark(id);
while (bookmark.ogFetchStatus === 'pending') {
  await sleep(2000);
  bookmark = await getBookmark(id);
}
// bookmark.ogPreview and bookmark.aiSummary now populated
```

### Filter by Tag

```typescript
const techBookmarks = await listBookmarks({
  tags: ['tech'],
  archived: false,
});
```

---

## Internal Endpoints

| Method | Path                              | Purpose                            |
| ------  | ---------------------------------  | ----------------------------------  |
| POST   | `/internal/bookmarks`             | Create bookmark from actions-agent |
| POST   | `/internal/bookmarks/:id/refresh` | Force refresh OG data              |
| GET    | `/internal/bookmarks/:id`         | Get bookmark for internal services |

---

## Enrichment Flow

```
createBookmark → ogFetchStatus: 'pending'
      ↓
web-agent (OG fetch + AI summary)
      ↓
ogFetchStatus: 'processed', aiSummary populated
```

---

**Last updated:** 2026-01-19
