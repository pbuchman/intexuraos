# @intexuraos/infra-notion

Notion API wrapper providing client creation, error mapping, token validation, and page retrieval utilities.

## What It Wraps

- **External API:** Notion API via `@notionhq/client` (v2.2+)
- **Pattern:** Factory function with logging fetch wrapper

## API Reference

### `createNotionClient(token: string, logger: NotionLogger): Client`

Creates a Notion SDK `Client` instance with a logging fetch wrapper that records all HTTP requests and responses.

```ts
import { createNotionClient } from '@intexuraos/infra-notion';

const notion = createNotionClient(notionToken, logger);
const page = await notion.pages.retrieve({ page_id: 'abc-123' });
```

The logging wrapper:

- Redacts the `Authorization` header to the first 20 characters
- Logs request method, URL, headers, and body length
- Logs response status, duration, and truncated body preview (500 chars max)
- Logs network errors with duration

### `validateNotionToken(token: string, logger: NotionLogger): Promise<Result<boolean, NotionError>>`

Validates a Notion integration token by calling the `users.me` endpoint.

```ts
const result = await validateNotionToken(token, logger);
if (result.ok && result.data === true) {
  // Token is valid
} else if (result.ok && result.data === false) {
  // Token is invalid (unauthorized)
}
```

### `getPageWithPreview(token: string, pageId: string, logger: NotionLogger): Promise<Result<NotionPagePreview, NotionError>>`

Retrieves a Notion page with the first 10 blocks as a preview. Extracts the page title from common property names (`title`, `Title`, `Name`, `name`). Non-`rich_text` block types (images, embeds, code, callouts) yield empty `content` in the preview.

```ts
const result = await getPageWithPreview(token, pageId, logger);
if (result.ok) {
  console.log(result.data.title);
  console.log(result.data.blocks); // First 10 blocks with type and content
}
```

### `extractPageTitle(properties: Record<string, unknown>): string`

Extracts the title from a Notion page's properties object. Checks `title`, `Title`, `Name`, and `name` properties. Returns `'Untitled'` if no title property is found.

### `mapNotionError(error: unknown): NotionError`

Maps Notion SDK errors to domain error objects.

## Exported Types

| Type                  | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `NotionClient`        | Re-export of `Client` from `@notionhq/client`                                            |
| `NotionLogger`        | Logger interface with `info`, `warn`, `error`, `debug`                                   |
| `NotionError`         | Domain error with `code` and `message`                                                   |
| `NotionErrorCode`     | Union: `NOT_FOUND`, `UNAUTHORIZED`, `RATE_LIMITED`, `VALIDATION_ERROR`, `INTERNAL_ERROR` |
| `NotionPagePreview`   | Page preview with `id`, `title`, `url`, `blocks`                                         |
| `BlockObjectResponse` | Re-export from Notion SDK                                                                |

### NotionLogger

```ts
interface NotionLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
}
```

### NotionPagePreview

```ts
interface NotionPagePreview {
  id: string;
  title: string;
  url: string;
  blocks: { type: string; content: string }[];
}
```

## Configuration

### Environment Variables

| Variable                  | Description              | Required |
| ------------------------- | ------------------------ | -------- |
| `INTEXURAOS_NOTION_TOKEN` | Notion integration token | Yes      |

## Error Handling

All functions return `Result<T, NotionError>`. Error mapping:

| Notion SDK Error Code | Domain Error Code  | Description              |
| --------------------- | ------------------ | ------------------------ |
| `Unauthorized`        | `UNAUTHORIZED`     | Invalid or expired token |
| `ObjectNotFound`      | `NOT_FOUND`        | Page or block not found  |
| `RateLimited`         | `RATE_LIMITED`     | API rate limit exceeded  |
| `ValidationError`     | `VALIDATION_ERROR` | Invalid request data     |
| `InvalidJSON`         | `VALIDATION_ERROR` | Malformed JSON request   |
| Other/unknown         | `INTERNAL_ERROR`   | Unexpected error         |

## Used By

| App / Package    | Purpose                        |
| ---------------- | ------------------------------ |
| `notion-service` | Notion page sync and retrieval |
| `research-agent` | Research export to Notion      |

## Recent Changes

| Commit     | Description                                         | When        |
| ---------- | --------------------------------------------------- | ----------- |
| `c4e3a13c` | Release v3.3.0                                      | 2 hours ago |
| `1f06a8c0` | Add manual Notion export trigger for research       | 3 weeks ago |
| `13d66654` | Add linear-agent integration tests for 95% coverage | 5 weeks ago |
| `1dc6097d` | Make logger mandatory in infra-notion package       | 5 weeks ago |
| `d70e2581` | Improve infra-notion coverage to 100%               | 5 weeks ago |
