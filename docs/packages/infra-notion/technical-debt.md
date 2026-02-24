# Technical Debt: @intexuraos/infra-notion

**Last Updated:** 2026-02-19
**Analysis Run:** [2026-02-19 documentation run](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 1     | Low      |
| TODOs       | 0     | —        |
| **Total**   | **5** | —        |

---

## Future Plans

- Add database query support (`notion.databases.query`)
- Add block content creation/update operations
- Support pagination for pages with more than 10 blocks
- Extract more block types in `getPageWithPreview` (code, image, embed, toggle, callout)
- Accept optional `blockLimit` parameter in `getPageWithPreview`

---

## Code Smells

### Low Priority

| File            | Issue                                                                                  | Impact                                                                                              |
| --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/notion.ts` | `validateNotionToken()` and `getPageWithPreview()` create a new `Client` on every call | Lightweight but logging wrapper is recreated; callers doing multiple ops create redundant instances |
| `src/notion.ts` | Headers handling has 3 branches for `Headers`, array, and plain object formats         | Defensive but increases cyclomatic complexity in `createLoggingFetch`                               |
| `src/notion.ts` | `page_size: 10` hardcoded in `getPageWithPreview` block retrieval                      | Not configurable; pages needing more context require a code change or direct SDK call               |
| `src/notion.ts` | `calculateBodyLength` exported with `@internal` comment indicating test-only use       | Could cause confusion; consider unexported test double or `/* v8 ignore */` approach                |

---

## TypeScript Issues

| File            | Issue                                                                    | Count      |
| --------------- | ------------------------------------------------------------------------ | ---------- |
| `src/notion.ts` | Block data cast: `block[type as keyof typeof block] as ... \             | undefined` | 1 |

The Notion SDK block type is a complex discriminated union; the cast is pragmatic. Non-`rich_text` blocks (images, embeds, code) yield empty content in the preview.

---

## TODOs / FIXMEs

None found in source code.

---

## Resolved Issues

| Date       | Issue                                          | Resolution                                           |
| ---------- | ---------------------------------------------- | ---------------------------------------------------- |
| 2026-01-29 | Logger was optional, allowing silent API calls | Logger made mandatory in `createNotionClient` (v2.x) |
| 2026-01-29 | Coverage below 95% threshold                   | Improved to 100% via comprehensive test suite        |

---

## Related

- [README](README.md) — Package overview and API reference
- [Agent Reference](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
