# Bookmarks Agent — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** IntexuraOS dev environment, Auth0 access token, WhatsApp connected
> **You'll learn:** How to create, enrich, filter, and manage bookmarks, and understand the async event pipeline

---

## What You'll Build

A working integration that:

- Creates bookmarks via public and internal APIs
- Observes the async enrichment and summarization pipeline
- Filters and manages bookmarks with tags and archive
- Uses the image proxy to display OG images

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS development environment running (bookmarks-agent on port 8124)
- [ ] Auth0 access token for API requests
- [ ] WhatsApp connected to user account (for receiving summaries)
- [ ] Internal auth token for service-to-service calls

---

## Part 1: Create Your First Bookmark (5 minutes)

### Step 1.1: Create a bookmark via the public API

```bash
curl -X POST http://localhost:8124/bookmarks \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "tags": ["research", "ai"],
    "source": "manual",
    "sourceId": "tutorial-1"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "bookmark_abc123",
    "userId": "user_123",
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
    "sourceId": "tutorial-1",
    "archived": false,
    "createdAt": "2026-02-22T10:00:00Z",
    "updatedAt": "2026-02-22T10:00:00Z"
  }
}
```

### What Just Happened?

The bookmark was created with `ogFetchStatus: pending` and no metadata. The public API does NOT trigger the enrichment pipeline — it only stores the bookmark. Enrichment is triggered only by the internal create endpoint.

---

## Part 2: Create via Internal API with Enrichment (10 minutes)

### Step 2.1: Create a bookmark via the internal API

This is how actions-agent creates bookmarks from WhatsApp links:

```bash
curl -X POST http://localhost:8124/internal/bookmarks \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "url": "https://example.com/interesting-article",
    "source": "whatsapp",
    "sourceId": "wamid.HBgNMTIzNDU2Nzg5MA=="
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "bookmark_def456",
    "url": "/#/bookmarks/bookmark_def456",
    "bookmark": {
      "id": "bookmark_def456",
      "ogFetchStatus": "pending",
      "aiSummary": null
    }
  }
}
```

Note the `url` field is the app deep link, not the bookmarked URL. This endpoint also publishes a `bookmarks.enrich` event.

### Step 2.2: Wait for enrichment

The enrichment pipeline processes asynchronously. Poll for completion (typically 5–10 seconds):

```bash
curl "http://localhost:8124/bookmarks/bookmark_def456" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**After enrichment and summarization:**

```json
{
  "success": true,
  "data": {
    "id": "bookmark_def456",
    "url": "https://example.com/interesting-article",
    "ogPreview": {
      "title": "Interesting Article Title",
      "description": "A fascinating deep dive into...",
      "image": "https://example.com/og-image.jpg",
      "siteName": "Example",
      "type": null,
      "favicon": "https://example.com/favicon.ico"
    },
    "ogFetchedAt": "2026-02-22T10:00:05Z",
    "ogFetchStatus": "processed",
    "aiSummary": "This article explores the impact of...",
    "aiSummarizedAt": "2026-02-22T10:00:08Z"
  }
}
```

### Step 2.3: Check your WhatsApp

After `aiSummarizedAt` is populated, you should receive a WhatsApp message containing:

- Page title (bold)
- AI-generated summary
- Original URL

**Checkpoint:** Your bookmark should have `ogFetchStatus: "processed"` and a non-null `aiSummary`.

---

## Part 3: List and Filter Bookmarks (5 minutes)

### Step 3.1: List all bookmarks

```bash
curl "http://localhost:8124/bookmarks" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3.2: Filter by tags

```bash
curl "http://localhost:8124/bookmarks?tags=research" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3.3: Filter by archived status

```bash
curl "http://localhost:8124/bookmarks?archived=false" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3.4: Find bookmarks pending enrichment

```bash
curl "http://localhost:8124/bookmarks?ogFetchStatus=pending" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Checkpoint:** You should see your bookmarks filtered by each criteria.

---

## Part 4: Update, Archive, and Delete (5 minutes)

### Step 4.1: Update bookmark tags

```bash
curl -X PATCH http://localhost:8124/bookmarks/bookmark_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tags": ["research", "ai", "important"]
  }'
```

### Step 4.2: Archive a bookmark

```bash
curl -X POST http://localhost:8124/bookmarks/bookmark_abc123/archive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 4.3: Unarchive a bookmark

```bash
curl -X POST http://localhost:8124/bookmarks/bookmark_abc123/unarchive \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 4.4: Delete a bookmark

```bash
curl -X DELETE http://localhost:8124/bookmarks/bookmark_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Part 5: Force Refresh Metadata (5 minutes)

If a page has been updated and you want fresh metadata:

```bash
curl -X POST http://localhost:8124/internal/bookmarks/bookmark_def456/force-refresh \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

This bypasses the normal async flow and fetches fresh OG data synchronously, always updating even if the bookmark was already processed.

---

## Part 6: Image Proxy

Access external OG images through the proxy (bypasses CORS, no authentication required):

```bash
curl "http://localhost:8124/images/proxy?url=https%3A%2F%2Fexample.com%2Fog-image.jpg"
```

The proxy:
- Validates the URL is HTTP/HTTPS
- Validates the response is an image content type
- Sets `Cache-Control: public, max-age=86400` (24 hours)
- Has a 10-second timeout

---

## Understanding the Event Flow

```
1. Bookmark Created (Internal API only)
   |-- POST /internal/bookmarks
   |-- Stored with ogFetchStatus: pending
   |-- Published: bookmarks.enrich event

2. Enrichment (Pub/Sub)
   |-- /internal/bookmarks/pubsub/enrich receives event
   |-- Calls web-agent /internal/link-previews
   |-- Updates ogPreview, ogFetchStatus: processed
   |-- Published: bookmarks.summarize event

3. Summarization (Pub/Sub)
   |-- /internal/bookmarks/pubsub/summarize receives event
   |-- Calls web-agent /internal/page-summaries
   |-- Success:
   |   |-- Updates aiSummary, aiSummarizedAt
   |   |-- Published: whatsapp.message.send event
   |-- Transient error (429, timeout, network):
   |   |-- Returns HTTP 503 -> Pub/Sub retries with exponential backoff
   |-- Permanent error (NO_CONTENT, 400):
       |-- Returns HTTP 200 (graceful degradation, no retry)

4. WhatsApp Delivery
   |-- whatsapp-service SendMessageWorker receives event
   |-- Looks up phone number from userId
   |-- Sends summary message to user
```

---

## Troubleshooting

| Issue                      | Symptom                     | Solution                                           |
| -------------------------- | --------------------------- | -------------------------------------------------- |
| Auth failed                | 401 Unauthorized            | Check token validity                               |
| Bookmark not found         | 404 error                   | Verify bookmark ID and user ownership              |
| Invalid URL                | 400 error                   | Ensure URL is valid HTTP/HTTPS format              |
| Duplicate bookmark         | 409 Conflict                | URL already exists for user                        |
| Metadata fetch failed      | `ogFetchStatus: failed`     | Site may block scraping; try force-refresh         |
| No WhatsApp notification   | Summary saved, no message   | Check WhatsApp connection in user-service          |
| Enrichment never completes | `ogFetchStatus: pending`    | Check Pub/Sub subscription health                  |
| Summary retrying           | 503 from summarize endpoint | Transient error (rate limit/timeout); auto-retries |
| Summary silently skipped   | No aiSummary, no error      | Permanent error (NO_CONTENT); graceful degradation |
| Image proxy timeout        | 504 Gateway Timeout         | External image server too slow (>10s)              |
| Image proxy rejected       | 400 NOT_AN_IMAGE            | Proxied URL does not return image content type     |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API and Pub/Sub details
2. Review [Technical Debt](technical-debt.md) for known limitations and future plans
3. See how bookmarks-agent integrates with the [overall architecture](../overview.md)

---

## Exercises

Test your understanding:

1. **Easy:** Create a bookmark with custom tags and verify they appear in the list filter
2. **Medium:** Create a bookmark via the internal API, then poll until the AI summary is populated
3. **Hard:** Trigger the enrichment pipeline manually by posting a `bookmarks.enrich` Pub/Sub message to the `/internal/bookmarks/pubsub/enrich` endpoint

<details>
<summary>Solutions</summary>

### Exercise 1: Custom Tags

```bash
curl -X POST http://localhost:8124/bookmarks \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/tagged", "tags": ["exercise", "test"], "source": "manual", "sourceId": "ex-1"}'

curl "http://localhost:8124/bookmarks?tags=exercise" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Exercise 2: Poll for AI Summary

```bash
# Create via internal API
RESPONSE=$(curl -s -X POST http://localhost:8124/internal/bookmarks \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123", "url": "https://example.com/poll-test", "source": "manual", "sourceId": "ex-2"}')

BOOKMARK_ID=$(echo $RESPONSE | jq -r '.data.id')

# Poll until aiSummary is not null
while true; do
  SUMMARY=$(curl -s "http://localhost:8124/bookmarks/$BOOKMARK_ID" \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | jq -r '.data.aiSummary')
  if [ "$SUMMARY" != "null" ]; then
    echo "Summary: $SUMMARY"
    break
  fi
  echo "Waiting for summary..."
  sleep 2
done
```

### Exercise 3: Manual Pub/Sub Trigger

```bash
# Base64 encode the event payload
EVENT='{"type":"bookmarks.enrich","bookmarkId":"YOUR_BOOKMARK_ID","userId":"user_123","url":"https://example.com/manual"}'
ENCODED=$(echo -n "$EVENT" | base64)

curl -X POST http://localhost:8124/internal/bookmarks/pubsub/enrich \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"data\":\"$ENCODED\",\"messageId\":\"manual-1\"},\"subscription\":\"test\"}"
```

</details>
