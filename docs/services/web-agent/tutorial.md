# Web Agent - Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Internal auth token, user with configured LLM API key
> **You'll learn:** How to fetch link previews and generate AI summaries

---

## What You'll Build

A working integration that:

- Fetches OpenGraph metadata for link previews
- Generates AI summaries of web pages in the source language
- Handles errors gracefully including 403 responses

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] Internal auth token (`INTEXURAOS_INTERNAL_AUTH_TOKEN`)
- [ ] A user ID with configured LLM API key (for summarization)

---

## Part 1: Hello World - Link Preview (5 minutes)

Fetch OpenGraph metadata for a single URL.

### Step 1.1: Make Your First Request

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "urls": ["https://www.anthropic.com"]
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "url": "https://www.anthropic.com",
        "status": "success",
        "preview": {
          "url": "https://www.anthropic.com",
          "title": "Anthropic: AI Safety and Research",
          "description": "Anthropic is an AI safety company...",
          "image": "https://www.anthropic.com/images/og-image.jpg",
          "favicon": "https://www.anthropic.com/favicon.ico",
          "siteName": "Anthropic"
        }
      }
    ],
    "metadata": {
      "requestedCount": 1,
      "successCount": 1,
      "failedCount": 0,
      "durationMs": 523
    }
  }
}
```

### What Just Happened?

1. web-agent fetched the URL with browser-like headers
2. Parsed HTML with Cheerio to extract OpenGraph tags
3. Resolved relative image URLs to absolute paths
4. Found favicon from link tags or defaulted to /favicon.ico

**Checkpoint:** You should see title, description, and image fields populated.

---

## Part 2: Batch Link Previews (5 minutes)

Fetch multiple URLs in parallel with mixed success/failure.

### Step 2.1: Send Batch Request

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "urls": [
      "https://www.anthropic.com",
      "https://example.com",
      "https://blocked-site-example.com"
    ],
    "timeoutMs": 10000
  }'
```

**Expected partial success:**

```json
{
  "success": true,
  "data": {
    "results": [
      { "url": "https://www.anthropic.com", "status": "success", "preview": {...} },
      { "url": "https://example.com", "status": "success", "preview": {...} },
      {
        "url": "https://blocked-site-example.com",
        "status": "failed",
        "error": {
          "code": "ACCESS_DENIED",
          "message": "Access denied (HTTP 403): The website blocked the request"
        }
      }
    ],
    "metadata": {
      "requestedCount": 3,
      "successCount": 2,
      "failedCount": 1,
      "durationMs": 2341
    }
  }
}
```

### Step 2.2: Handle Partial Success

```typescript
const response = await fetch('/internal/link-previews', { ... });
const { data } = await response.json();

for (const result of data.results) {
  if (result.status === 'success') {
    console.log(`${result.url}: ${result.preview.title}`);
  } else {
    console.warn(`${result.url}: ${result.error.code} - ${result.error.message}`);
  }
}
```

**Checkpoint:** Notice how 403 responses return `ACCESS_DENIED` specifically.

---

## Part 3: Page Summarization (10 minutes)

Generate an AI summary using the user's configured LLM.

### Step 3.1: Summarize a Web Page

```bash
curl -X POST https://web-agent.intexuraos.com/internal/page-summaries \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "url": "https://www.example-article.com/news",
    "userId": "user-abc-123",
    "maxSentences": 10,
    "maxReadingMinutes": 2
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "result": {
      "url": "https://www.example-article.com/news",
      "status": "success",
      "summary": {
        "url": "https://www.example-article.com/news",
        "summary": "The article discusses recent advances in renewable energy...",
        "wordCount": 150,
        "estimatedReadingMinutes": 1
      }
    },
    "metadata": {
      "durationMs": 3500
    }
  }
}
```

### Step 3.2: Understand the Flow

When you call `/internal/page-summaries`:

1. **PageContentFetcher** crawls the URL via Crawl4AI (headless browser)
2. **userServiceClient** fetches the user's default LLM model and API keys
3. **LlmSummarizer** generates a prompt with language preservation instructions
4. **parseSummaryResponse** validates the output is prose (not JSON)
5. If invalid, **repair prompt** triggers one retry automatically

### Step 3.3: Language Preservation

Summarize a non-English article:

```bash
curl -X POST https://web-agent.intexuraos.com/internal/page-summaries \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "url": "https://www.gazeta.pl/artykul-w-jezyku-polskim",
    "userId": "user-abc-123"
  }'
```

**Expected:** Summary returns in Polish, matching the source language.

**Why this works:** The prompt includes `IMPORTANT: Write the summary in the SAME LANGUAGE as the original content`.

---

## Part 4: Handle Errors (5 minutes)

### Error: No API Key Configured

```json
{
  "result": {
    "url": "https://example.com",
    "status": "failed",
    "error": {
      "code": "API_ERROR",
      "message": "No API key configured for Google. Please add your Google API key in settings."
    }
  }
}
```

**Solution:** User needs to add their LLM API key via user-service settings.

### Error: Invalid URL

```json
{
  "result": {
    "url": "not-a-url",
    "status": "failed",
    "error": {
      "code": "INVALID_URL",
      "message": "Invalid URL format or unsupported protocol"
    }
  }
}
```

**Solution:** Ensure URLs start with `http://` or `https://`.

### Error: Page Crawl Failed

```json
{
  "result": {
    "url": "https://blocked-site.com",
    "status": "failed",
    "error": {
      "code": "FETCH_FAILED",
      "message": "Crawl4AI crawl failed"
    }
  }
}
```

**Solution:** Some sites block crawlers. Try a different URL or check if the site is accessible.

### Error: No Content Extracted

```json
{
  "result": {
    "url": "https://empty-page.com",
    "status": "failed",
    "error": {
      "code": "NO_CONTENT",
      "message": "No content could be extracted from the page"
    }
  }
}
```

**Solution:** Page may be entirely JavaScript-rendered or blocked.

---

## Part 5: Real-World Integration

### bookmarks-agent Integration

```typescript
// bookmarks-agent/src/infra/web/webAgentClient.ts

import type { LinkPreview } from './types.js';

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const response = await fetch(`${process.env.INTEXURAOS_WEB_AGENT_URL}/internal/link-previews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN!,
    },
    body: JSON.stringify({ urls: [url] }),
  });

  const { data } = await response.json();
  const result = data.results[0];

  if (result?.status === 'success') {
    return result.preview;
  }

  return null;
}
```

### research-agent Integration

```typescript
// research-agent/src/infra/web/webAgentClient.ts

export async function summarizePage(
  url: string,
  userId: string
): Promise<{ summary: string; wordCount: number } | null> {
  const response = await fetch(`${process.env.INTEXURAOS_WEB_AGENT_URL}/internal/page-summaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN!,
    },
    body: JSON.stringify({
      url,
      userId,
      maxSentences: 15,
      maxReadingMinutes: 3,
    }),
  });

  const { data } = await response.json();

  if (data.result.status === 'success') {
    return {
      summary: data.result.summary.summary,
      wordCount: data.result.summary.wordCount,
    };
  }

  console.error(`Summary failed: ${data.result.error.code}`);
  return null;
}
```

---

## Troubleshooting

| Problem                     | Symptom                    | Solution                                    |
| --------------------------- | -------------------------- | ------------------------------------------- |
| "401 Unauthorized"          | Missing auth header        | Add `X-Internal-Auth` header                |
| "ACCESS_DENIED"             | 403 from target site       | Site blocks scrapers; try different URL     |
| "No API key configured"     | Missing user LLM key       | User must add API key in settings           |
| "Summary is JSON"           | Repair mechanism kicked in | Normal behavior - should auto-repair        |
| "Summary in wrong language" | Old version                | Update to v2.0.0 with language preservation |
| "Timeout"                   | Slow site or Crawl4AI      | Increase `timeoutMs` parameter              |

---

## Best Practices

1. **Validate URLs client-side** - Check for http/https before calling
2. **Handle partial success** - Check `status` field per result
3. **Log error codes** - Track `ACCESS_DENIED` vs `FETCH_FAILED` separately
4. **Set appropriate timeouts** - 5s for link previews, 60s for summaries
5. **Cache link previews** - Same URL rarely changes; caller should cache
6. **Provide userId** - Required for summarization to get user's LLM keys

---

## Exercises

### Easy

1. Fetch a link preview for a GitHub repository
2. Extract the title and description from the response
3. Handle an invalid URL gracefully

### Medium

1. Fetch 5 URLs in parallel and count success vs failure
2. Summarize an article and display word count and reading time
3. Implement retry with exponential backoff for timeouts

### Hard

1. Build a TypeScript client library with proper types
2. Implement a caching layer for link previews
3. Create a fallback chain: try link preview, if no description, try summary

<details>
<summary>Solutions</summary>

### Exercise 1: GitHub Link Preview

```typescript
const result = await fetch('/internal/link-previews', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Auth': token,
  },
  body: JSON.stringify({
    urls: ['https://github.com/anthropics/anthropic-sdk-typescript'],
  }),
});

const { data } = await result.json();
console.log(data.results[0].preview.title);
// "anthropics/anthropic-sdk-typescript"
```

### Exercise 2: Article Summary

```typescript
const result = await fetch('/internal/page-summaries', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Auth': token,
  },
  body: JSON.stringify({
    url: 'https://blog.anthropic.com/some-article',
    userId: 'user-123',
  }),
});

const { data } = await result.json();
if (data.result.status === 'success') {
  const { summary, wordCount, estimatedReadingMinutes } = data.result.summary;
  console.log(`${wordCount} words (~${estimatedReadingMinutes} min read)`);
  console.log(summary);
}
```

### Exercise 3: Caching Layer

```typescript
const previewCache = new Map<string, { preview: LinkPreview; expires: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getCachedPreview(url: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(url);
  if (cached && cached.expires > Date.now()) {
    return cached.preview;
  }

  const preview = await fetchLinkPreview(url);
  if (preview) {
    previewCache.set(url, { preview, expires: Date.now() + CACHE_TTL_MS });
  }

  return preview;
}
```

</details>
