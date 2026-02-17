# Technical Debt: @intexuraos/infra-notion

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Client Re-creation Per Operation

Both `validateNotionToken()` and `getPageWithPreview()` create a new `Client` instance on every call:

```ts
const client = createNotionClient(token, logger);
```

**Impact:** Low. Notion client creation is lightweight (no connection pooling), but it means the logging fetch wrapper is recreated for each operation.

**Recommendation:** Consider accepting a pre-created client as an alternative to token + logger for scenarios with multiple sequential operations.

### Type Assertions for Block Content

`getPageWithPreview` casts block data to extract rich text content:

```ts
const blockData = block[type as keyof typeof block] as
  | { rich_text?: { plain_text?: string }[] }
  | undefined;
```

**Impact:** Low. The Notion SDK's block types are complex discriminated unions, and this is the pragmatic approach. However, it skips blocks that do not have a `rich_text` array (e.g., images, embeds).

**Recommendation:** Add support for more block types (images, embeds, code blocks) in `getPageWithPreview` as needed.

### Headers Type Handling Complexity

The `createLoggingFetch` function handles three possible `headers` formats (Headers object, array of tuples, plain object):

```ts
const headers =
  init.headers instanceof Headers
    ? Object.fromEntries(...)
    : Array.isArray(init.headers)
      ? Object.fromEntries(init.headers as [string, string][])
      : (init.headers as Record<string, string>);
```

**Impact:** Low. This is defensive programming but increases code complexity.

### Fixed Page Size for Preview

`getPageWithPreview` hardcodes `page_size: 10` for block retrieval. This is not configurable.

**Impact:** Low. 10 blocks is sufficient for a preview, but some pages may need more context.

**Recommendation:** Accept an optional `blockLimit` parameter.

## Future Improvements

- Add database query support (`notion.databases.query`)
- Add block content creation/update operations
- Support pagination for pages with more than 10 blocks
- Extract more block types in `getPageWithPreview` (code, image, embed, toggle, callout)
