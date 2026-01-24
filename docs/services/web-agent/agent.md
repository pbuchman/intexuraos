# web-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with web-agent.

---

## Identity

| Field    | Value                                                          |
| --------  | --------------------------------------------------------------  |
| **Name** | web-agent                                                      |
| **Role** | Web Content Extraction Service                                 |
| **Goal** | Extract OpenGraph metadata and generate AI summaries from URLs |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface WebAgentTools {
  // Fetch OpenGraph metadata from URL
  fetchOpenGraph(params: { url: string }): Promise<OpenGraphResult>;

  // Generate AI summary of web content
  summarizeContent(params: { url: string; content?: string }): Promise<SummaryResult>;
}
```

### Types

```typescript
interface OpenGraphResult {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  favicon: string | null;
  fetchedAt: string;
}

interface SummaryResult {
  url: string;
  summary: string;
  model: string;
  tokenUsage: {
    input: number;
    output: number;
  };
  summarizedAt: string;
}
```

---

## Constraints

| Rule               | Description                       |
| ------------------  | ---------------------------------  |
| **Size Limit**     | Maximum 2MB content size          |
| **Timeout**        | 30 second fetch timeout           |
| **Content Types**  | HTML pages only for OG extraction |
| **Google API Key** | Required for AI summarization     |

---

## Usage Patterns

### Fetch OpenGraph Metadata

```typescript
const og = await fetchOpenGraph({
  url: 'https://example.com/article',
});
// og.title, og.description, og.image populated
```

### Generate AI Summary

```typescript
const summary = await summarizeContent({
  url: 'https://example.com/article',
});
// summary.summary contains 2-3 sentence overview
```

---

## Internal Endpoints

| Method | Path                  | Purpose                                       |
| ------  | ---------------------  | ---------------------------------------------  |
| POST   | `/internal/og`        | Fetch OG metadata (called by bookmarks-agent) |
| POST   | `/internal/summarize` | Generate summary (called by bookmarks-agent)  |

---

## Error Handling

| Error Code          | Description                      |
| -------------------  | --------------------------------  |
| `FETCH_FAILED`      | Unable to fetch URL              |
| `CONTENT_TOO_LARGE` | Content exceeds 2MB limit        |
| `TIMEOUT`           | Fetch exceeded 30 seconds        |
| `NOT_HTML`          | URL does not return HTML content |

---

**Last updated:** 2026-01-19
