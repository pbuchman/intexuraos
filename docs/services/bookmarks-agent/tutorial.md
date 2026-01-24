# Bookmarks Agent - Tutorial

Getting started with the bookmarks-agent service, including the new WhatsApp delivery feature.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- WhatsApp connected to user account (for receiving summaries)

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
    "title": null,
    "description": null,
    "tags": ["research", "ai"],
    "ogPreview": null,
    "ogFetchedAt": null,
    "ogFetchStatus": "pending",
    "aiSummary": null,
    "aiSummarizedAt": null,
    "source": "manual",
    "sourceId": "local-1",
    "archived": false,
    "createdAt": "2026-01-24T10:00:00Z",
    "updatedAt": "2026-01-24T10:00:00Z"
  }
}
```

Notice that `ogFetchStatus` is `pending` and `ogPreview` is `null`. The enrichment happens asynchronously.

### Step 2: Wait for enrichment

Enrichment happens via Pub/Sub and typically completes within 5-10 seconds:

```bash
# Poll for completion
curl "https://bookmarks-agent.intexuraos.com/bookmarks/bookmark_abc123" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**After enrichment:**

```json
{
  "success": true,
  "data": {
    "id": "bookmark_abc123",
    "url": "https://example.com/article",
    "ogPreview": {
      "title": "Example Article",
      "description": "An interesting article...",
      "image": "https://example.com/og-image.jpg",
      "siteName": "Example",
      "type": "article",
      "favicon": "https://example.com/favicon.ico"
    },
    "ogFetchedAt": "2026-01-24T10:00:05Z",
    "ogFetchStatus": "processed",
    "aiSummary": "This article discusses...",
    "aiSummarizedAt": "2026-01-24T10:00:08Z"
  }
}
```

### Step 3: Check your WhatsApp

After `aiSummarizedAt` is populated, you should receive a WhatsApp message with the summary (INT-210 feature). The message will contain:

- Page title
- AI-generated summary
- Original URL

## Part 2: List and Filter Bookmarks

### List all bookmarks

```bash
curl "https://bookmarks-agent.intexuraos.com/bookmarks" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Filter by tags

```bash
curl "https://bookmarks-agent.intexuraos.com/bookmarks?tags=research" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Filter by archived status

```bash
curl "https://bookmarks-agent.intexuraos.com/bookmarks?archived=false" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Filter by OG fetch status

```bash
# Find bookmarks still pending enrichment
curl "https://bookmarks-agent.intexuraos.com/bookmarks?ogFetchStatus=pending" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 3: Update and Archive

### Update bookmark tags

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

## Part 4: Force Refresh Metadata

If a page has been updated and you want fresh metadata:

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/internal/bookmarks/bookmark_abc123/force-refresh \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

This bypasses the normal async flow and fetches fresh OG data synchronously.

## Part 5: Internal API (Service-to-Service)

### Create bookmark from another service

Used by actions-agent when processing link actions from WhatsApp:

```bash
curl -X POST https://bookmarks-agent.intexuraos.com/internal/bookmarks \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "url": "https://example.com/article",
    "source": "whatsapp",
    "sourceId": "wamid.HBgNMTIzNDU2Nzg5MA=="
  }'
```

### Get bookmark for internal services

```bash
curl "https://bookmarks-agent.intexuraos.com/internal/bookmarks/bookmark_abc123?userId=user_123" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

## Part 6: Image Proxy

Access external images through the proxy (bypasses CORS, no authentication):

```bash
curl "https://bookmarks-agent.intexuraos.com/images/proxy?url=https://example.com/og-image.jpg"
```

## Understanding the Event Flow

```
1. Bookmark Created
   └── POST /internal/bookmarks or POST /bookmarks
       └── Stored with ogFetchStatus: pending
       └── Published: bookmarks.enrich event

2. Enrichment (Pub/Sub)
   └── /internal/bookmarks/pubsub/enrich receives event
       └── Calls web-agent /internal/link-previews
       └── Updates ogPreview, ogFetchStatus: processed
       └── Published: bookmarks.summarize event

3. Summarization (Pub/Sub)
   └── /internal/bookmarks/pubsub/summarize receives event
       └── Calls web-agent /internal/page-summaries
       └── Updates aiSummary, aiSummarizedAt
       └── Published: whatsapp.message.send event (INT-210)

4. WhatsApp Delivery
   └── whatsapp-service SendMessageWorker receives event
       └── Looks up phone number from userId
       └── Sends summary message to user
```

## Troubleshooting

| Issue                      | Symptom                   | Solution                                  |
| -------------------------- | ------------------------- | ----------------------------------------- |
| Auth failed                | 401 Unauthorized          | Check token validity                      |
| Bookmark not found         | 404 error                 | Verify bookmark ID                        |
| Invalid URL                | 400 error                 | Ensure URL is valid HTTP/HTTPS            |
| Duplicate bookmark         | 409 Conflict              | URL already exists for user               |
| Metadata fetch failed      | `ogFetchStatus: failed`   | Site may block scraping                   |
| No WhatsApp notification   | Summary saved, no message | Check WhatsApp connection in user-service |
| Enrichment never completes | `ogFetchStatus: pending`  | Check Pub/Sub subscription health         |

## Rate Limits

- Public endpoints: 100 requests/minute per user
- Internal endpoints: No rate limit (service-to-service)
- Image proxy: 1000 requests/minute (global)

## Next Steps

- Explore the [technical reference](technical.md) for API details
- Learn about [known limitations](technical-debt.md)
- See how bookmarks-agent integrates with the [overall architecture](../overview.md)
