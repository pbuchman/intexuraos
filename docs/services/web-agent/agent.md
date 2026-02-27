# web-agent -- Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute | Value                                                             |
| --------- | ----------------------------------------------------------------- |
| Name      | web-agent                                                         |
| Role      | Web Content Extraction and Summarization Service                  |
| Goal      | Extract OpenGraph metadata and generate prose summaries from URLs |
| Port      | 8127 (local/dev), 8080 (production)                               |
| Version   | 3.1.0                                                             |

## Capabilities

### Fetch Link Previews

**Endpoint:** `POST /internal/link-previews`

**When to use:** Enriching bookmarks, displaying URL cards, showing metadata before clicking

**Input Schema:**

```typescript
interface FetchLinkPreviewsBody {
  urls: string[]; // 1-10 HTTP/HTTPS URLs
  timeoutMs?: number; // 1000-30000 (default: 5000)
}
```

**Output Schema:**

```typescript
interface FetchLinkPreviewsResponse {
  results: Array<{
    url: string;
    status: 'success' | 'failed';
    preview?: {
      url: string;
      title?: string;
      description?: string;
      image?: string;
      favicon?: string;
      siteName?: string;
    };
    error?: {
      code: 'FETCH_FAILED' | 'TIMEOUT' | 'TOO_LARGE' | 'INVALID_URL' | 'ACCESS_DENIED';
      message: string;
    };
  }>;
  metadata: {
    requestedCount: number;
    successCount: number;
    failedCount: number;
    durationMs: number;
  };
}
```

**Example:**

```json
// Request
{
  "urls": ["https://github.com/anthropics/anthropic-sdk-typescript"]
}

// Response
{
  "results": [{
    "url": "https://github.com/anthropics/anthropic-sdk-typescript",
    "status": "success",
    "preview": {
      "url": "https://github.com/anthropics/anthropic-sdk-typescript",
      "title": "anthropics/anthropic-sdk-typescript",
      "description": "Access to Anthropic's safety-first language model APIs",
      "image": "https://opengraph.githubassets.com/...",
      "favicon": "https://github.githubassets.com/favicons/favicon.svg",
      "siteName": "GitHub"
    }
  }],
  "metadata": {
    "requestedCount": 1,
    "successCount": 1,
    "failedCount": 0,
    "durationMs": 523
  }
}
```

### Summarize Page

**Endpoint:** `POST /internal/page-summaries`

**When to use:** Generating article summaries, research citations, content previews

**Input Schema:**

```typescript
interface SummarizePageBody {
  url: string; // HTTP/HTTPS URL to summarize
  userId: string; // User ID for LLM key lookup
  maxSentences?: number; // 1-50 (default: 20)
  maxReadingMinutes?: number; // 1-10 (default: 3)
}
```

**Output Schema:**

```typescript
interface SummarizePageResponse {
  result: {
    url: string;
    status: 'success' | 'failed';
    summary?: {
      url: string;
      summary: string; // Prose text in source language, focused on page content
      wordCount: number;
      estimatedReadingMinutes: number;
    };
    error?: {
      code:
        | 'FETCH_FAILED'
        | 'TIMEOUT'
        | 'INVALID_URL'
        | 'NO_CONTENT'
        | 'API_ERROR'
        | 'RATE_LIMITED';
      message: string;
    };
  };
  metadata: {
    durationMs: number;
  };
}
```

**Example:**

```json
// Request
{
  "url": "https://blog.anthropic.com/article",
  "userId": "user-abc-123",
  "maxSentences": 10
}

// Response
{
  "result": {
    "url": "https://blog.anthropic.com/article",
    "status": "success",
    "summary": {
      "url": "https://blog.anthropic.com/article",
      "summary": "The article discusses recent advances in AI safety research...",
      "wordCount": 150,
      "estimatedReadingMinutes": 1
    }
  },
  "metadata": {
    "durationMs": 3500
  }
}
```

## Constraints

**Do NOT:**

- Batch more than 10 URLs in link preview requests
- Expect summaries to work on paywalled/login-protected content
- Assume all sites will return metadata (some block scrapers)

**Requires:**

- `X-Internal-Auth` header with valid internal token
- HTTP/HTTPS URLs only (no ftp://, file://, etc.)
- For summaries: `userId` is required; LLM resolution: user's own key, then platform Gemini 2.5 Flash, then platform ZAI

**Note on `API_ERROR` for summaries:** This error only surfaces if the user has no API key AND neither `INTEXURAOS_GEMINI_APP_API_KEY` nor `INTEXURAOS_ZAI_APP_API_KEY` are configured on the platform.

## Usage Patterns

### Pattern 1: Bookmark Enrichment

```
1. User saves URL via bookmarks-agent
2. Call POST /internal/link-previews with single URL
3. If success, store preview metadata with bookmark
4. If ACCESS_DENIED or FETCH_FAILED, store URL without preview
```

### Pattern 2: Research Summary

```
1. User provides article URL to research-agent
2. Call POST /internal/page-summaries with url and userId
3. If success, include summary in research response
4. Summary will be in source language (Polish stays Polish)
5. API_ERROR only if platform fallback keys are also unset
```

### Pattern 3: Batch Link Preview

```
1. Collect up to 10 URLs from message or content
2. Call POST /internal/link-previews with all URLs
3. Process results individually (partial success expected)
4. Use metadata.successCount to track success rate
```

## Error Handling

| Error Code    | Meaning                     | Recovery Action                             |
| ------------- | --------------------------- | ------------------------------------------- |
| INVALID_URL   | Not HTTP/HTTPS or malformed | Validate URL format                         |
| ACCESS_DENIED | Site returned 403           | Accept no preview available                 |
| FETCH_FAILED  | Network or HTTP error       | Retry with backoff                          |
| TIMEOUT       | Request exceeded time limit | Retry or increase timeout                   |
| TOO_LARGE     | Response over 2MB           | Cannot process large pages                  |
| NO_CONTENT    | No text extracted from page | Page may be JS-only or empty                |
| API_ERROR     | LLM or user-service error   | Check platform fallback keys are configured |
| RATE_LIMITED  | Crawl4AI returned HTTP 429  | Wait and retry with backoff                 |

## Rate Limits

| Endpoint                   | Limit             | Window |
| -------------------------- | ----------------- | ------ |
| `/internal/link-previews`  | No built-in limit | Caller |
| `/internal/page-summaries` | No built-in limit | Caller |

**Note:** web-agent has no built-in rate limiting. Callers should implement throttling.

## Dependencies

| Service              | Why Needed                            | Failure Behavior    |
| -------------------- | ------------------------------------- | ------------------- |
| user-service         | Get user's LLM client (with fallback) | Return API_ERROR    |
| app-settings-service | LLM pricing context at startup        | Service fails start |
| Crawl4AI             | Fetch page content                    | Return FETCH_FAILED |
| User's LLM           | Generate summary (primary)            | Fall back to Gemini |
| Platform Gemini      | Summary fallback (no user key)        | Fall back to ZAI    |
| Platform ZAI         | Summary secondary fallback            | Return API_ERROR    |

---

**Last updated:** 2026-02-22
