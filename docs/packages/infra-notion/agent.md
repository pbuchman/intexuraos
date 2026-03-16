# Agent Reference: @intexuraos/infra-notion

## Identity

| Attribute | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Package   | `@intexuraos/infra-notion`                                         |
| Version   | 3.3.0                                                              |
| Purpose   | Notion API wrapper with logging, error mapping, and page utilities |
| SDK       | `@notionhq/client` ^2.2.15                                         |

## Exports

```ts
// Client factory
export function createNotionClient(token: string, logger: NotionLogger): Client;

// Utilities
export function validateNotionToken(
  token: string,
  logger: NotionLogger
): Promise<Result<boolean, NotionError>>;
export function getPageWithPreview(
  token: string,
  pageId: string,
  logger: NotionLogger
): Promise<Result<NotionPagePreview, NotionError>>;
export function extractPageTitle(properties: Record<string, unknown>): string;
export function mapNotionError(error: unknown): NotionError;

// Types
export { Client as NotionClient } from '@notionhq/client';
export type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
export type { NotionLogger, NotionErrorCode, NotionError, NotionPagePreview };
```

## Key Interfaces

```ts
interface NotionLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
}

type NotionErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

interface NotionError {
  code: NotionErrorCode;
  message: string;
}

interface NotionPagePreview {
  id: string;
  title: string;
  url: string;
  blocks: { type: string; content: string }[];
}
```

## Usage Patterns

### Validate a Notion token

```ts
import { validateNotionToken } from '@intexuraos/infra-notion';

const result = await validateNotionToken(token, logger);
if (result.ok && result.data === true) {
  // Token is valid
}
if (result.ok && result.data === false) {
  // Token is unauthorized
}
if (!result.ok) {
  // Network or other error: result.error.code, result.error.message
}
```

### Retrieve a page preview

```ts
import { getPageWithPreview } from '@intexuraos/infra-notion';

const result = await getPageWithPreview(token, pageId, logger);
if (result.ok) {
  const { id, title, url, blocks } = result.data;
  // blocks: first 10 blocks only; non-rich_text types have empty content
}
```

### Use the Notion SDK directly

```ts
import { createNotionClient } from '@intexuraos/infra-notion';

const notion = createNotionClient(token, logger);
const response = await notion.databases.query({ database_id: dbId });
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'UNAUTHORIZED':      // invalid token
    case 'NOT_FOUND':         // page/block not found
    case 'RATE_LIMITED':      // API rate limit
    case 'VALIDATION_ERROR':  // bad request
    case 'INTERNAL_ERROR':    // unexpected
  }
}
```

## Dependencies

- `@intexuraos/common-core` — Result types, getErrorMessage

## Constraints

**Do NOT:**

- Call `getPageWithPreview` to retrieve more than 10 blocks — the `page_size` is hardcoded to 10
- Expect `content` in preview blocks of type `image`, `embed`, `code`, `toggle`, or `callout` — these yield empty strings
- Reuse a single `Client` instance across calls for different tokens — each call to `createNotionClient` creates a new instance

**Requires:**

- `INTEXURAOS_NOTION_TOKEN` environment variable when used in apps
- `logger` field on all function calls (mandatory, enforced by ESLint)
