# Web Agent - Tutorial

Web-agent is an internal service for fetching OpenGraph metadata. This tutorial shows how to integrate with it.

## Prerequisites

- Internal auth token for service-to-service calls
- Valid HTTP/HTTPS URLs to fetch
- Familiarity with Promise.all for parallel requests

## Part 1: Hello World - Single URL

Fetch a preview for a single URL:

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -d '{
    "urls": ["https://www.anthropic.com"]
  }'
```

**Response:**

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
          "description": "Anthropic is an AI safety company working to build reliable, interpretable, and steerable AI systems.",
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

**Checkpoint:** You should receive a successful preview with title, description, and image.

## Part 2: Batch Fetch Multiple URLs

Fetch previews for multiple URLs in parallel:

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -d '{
    "urls": [
      "https://www.anthropic.com",
      "https://example.com",
      "https://invalid-url-that-does-not-exist.com"
    ]
  }'
```

**Partial success response:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "url": "https://www.anthropic.com",
        "status": "success",
        "preview": { "title": "...", "description": "..." }
      },
      {
        "url": "https://example.com",
        "status": "success",
        "preview": { "title": "Example Domain", "description": undefined }
      },
      {
        "url": "https://invalid-url-that-does-not-exist.com",
        "status": "failed",
        "error": {
          "code": "FETCH_FAILED",
          "message": "HTTP 404: Not Found"
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

**What happened:**

- All 3 URLs fetched in parallel
- 2 succeeded, 1 failed
- Failed URL has error code instead of preview

## Part 3: Handle Errors

### Error: Invalid URL

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -d '{
    "urls": ["not-a-url", "ftp://unsupported.com"]
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "url": "not-a-url",
        "status": "failed",
        "error": {
          "code": "INVALID_URL",
          "message": "Invalid URL format or unsupported protocol"
        }
      },
      {
        "url": "ftp://unsupported.com",
        "status": "failed",
        "error": {
          "code": "INVALID_URL",
          "message": "Invalid URL format or unsupported protocol"
        }
      }
    ],
    "metadata": {
      "requestedCount": 2,
      "successCount": 0,
      "failedCount": 2,
      "durationMs": 5
    }
  }
}
```

**Note:** Invalid URLs are detected synchronously before fetching.

### Error: Timeout

```bash
curl -X POST https://web-agent.intexuraos.com/internal/link-previews \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -d '{
    "urls": ["https://slow-site.com"],
    "timeoutMs": 1000
  }'
```

If the site takes >1 second, response includes:

```json
{
  "status": "failed",
  "error": {
    "code": "TIMEOUT",
    "message": "Request timed out after 1000ms"
  }
}
```

### Error: Response Too Large

If Content-Length exceeds 2MB:

```json
{
  "status": "failed",
  "error": {
    "code": "TOO_LARGE",
    "message": "Response too large: 5242880 bytes"
  }
}
```

## Part 4: Real-World Integration

Integrate web-agent into bookmarks-agent:

```typescript
// bookmarks-agent/src/infra/web/webAgentClient.ts

import type { LinkPreview } from '@intexuraos/web-agent';

export async function fetchLinkPreviews(urls: string[]): Promise<Map<string, LinkPreview>> {
  const response = await fetch('https://web-agent.intexuraos.com/internal/link-previews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN!,
    },
    body: JSON.stringify({ urls }),
  });

  const { data } = await response.json();
  const previews = new Map<string, LinkPreview>();

  for (const result of data.results) {
    if (result.status === 'success') {
      previews.set(result.url, result.preview);
    }
  }

  return previews;
}
```

**Usage:**

```typescript
const previews = await fetchLinkPreviews([
  'https://blog.example.com/article',
  'https://github.com/user/repo',
]);

for (const [url, preview] of previews) {
  console.log(`${url}: ${preview.title}`);
}
```

## Troubleshooting

| Issue            | Symptom             | Solution                     |
| ----------------  | -------------------  | ----------------------------  |
| Unauthorized     | 401 response        | Check X-Internal-Auth header |
| Missing metadata | Empty preview       | Site lacks OpenGraph tags    |
| Partial success  | Mixed results       | Check error.code per result  |
| Timeout          | All results timeout | Increase timeoutMs parameter |

## Best Practices

1. **Batch requests** - Fetch multiple URLs in one call for efficiency
2. **Handle partial success** - Check `status` field per result
3. **Set reasonable timeouts** - Default 5s works for most sites
4. **Log errors** - Track error codes for monitoring
5. **Implement rate limiting** - Don't overwhelm the service

## Exercises

### Easy

1. Fetch preview for a single URL
2. Parse the response and extract title
3. Handle INVALID_URL error

### Medium

1. Fetch 10 URLs in parallel
2. Count success vs failed results
3. Implement retry for TIMEOUT errors

### Hard

1. Build a client library with TypeScript types
2. Implement exponential backoff for retries
3. Add caching layer for frequently requested URLs
