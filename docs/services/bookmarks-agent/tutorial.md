# Bookmarks Agent - Tutorial

Getting started with the bookmarks-agent service.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests

## Part 1: Create Your First Bookmark

### Step 1: Create a bookmark

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/bookmarks \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "tags": ["research", "ai"],
    "source": "manual",
    "sourceId": "local-1"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "bookmark_abc123",
    "userId": "user_123",
    "status": "active",
    "url": "https://example.com/article",
    "title": "Example Article",
    "description": "An interesting article about...",
    "tags": ["research", "ai"],
    "ogPreview": {
      "title": "Example Article",
      "description": "An interesting article...",
      "image": "https://example.com/og-image.jpg",
      "siteName": "Example",
      "type": "article",
      "favicon": "https://example.com/favicon.ico"
    },
    "ogFetchedAt": "2026-01-13T10:00:00Z",
    "ogFetchStatus": "processed",
    "aiSummary": "This article discusses...",
    "aiSummarizedAt": "2026-01-13T10:01:00Z",
    "source": "manual",
    "sourceId": "local-1",
    "archived": false,
    "createdAt": "2026-01-13T10:00:00Z",
    "updatedAt": "2026-01-13T10:01:00Z"
  }
}
```

### Step 2: List your bookmarks

```bash
curl "https://bookmarks-agent.intexuraos.com/bookmarks" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3: Get a specific bookmark

```bash
curl "https://bookmarks-agent.intexuraos.com/bookmarks/bookmark_abc123" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 2: Update and Archive

### Update a bookmark

```bash
curl -X PATCH https://bookmarks-agent.intexuraos.com/bookmarks/bookmark_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tags": ["research", "ai", "important"]
  }'
```

### Archive a bookmark

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/bookmarks/bookmark_abc123/archive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Unarchive a bookmark

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/bookmarks/bookmark_abc123/unarchive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 3: Filtering Bookmarks

```bash
# Filter by tags
curl "https://bookmarks-agent.intexuraos.com/bookmarks?tags=research" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Filter by status
curl "https://bookmarks-agent.intexuraos.com/bookmarks?status=active" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Filter by archived status
curl "https://bookmarks-agent.intexuraos.com/bookmarks?archived=false" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 4: Force Refresh Metadata

Trigger a fresh OpenGraph metadata fetch:

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/internal/bookmarks/bookmark_abc123/force-refresh \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

## Part 5: Image Proxy

Access external images through the proxy (no authentication):

```bash
curl "https://bookmarks-agent.intexuraos.com/images/proxy?url=https://example.com/image.jpg"
```

## Troubleshooting

| Issue                 | Symptom                 | Solution                    |
| ---------------------  | -----------------------  | ---------------------------  |
| Auth failed           | 401 Unauthorized        | Check token validity        |
| Bookmark not found    | 404 error               | Verify bookmark ID          |
| Invalid URL           | 400 error               | Ensure URL is valid         |
| Duplicate bookmark    | 409 Conflict            | URL already exists for user |
| Metadata fetch failed | `ogFetchStatus: failed` | Site may block scraping     |
