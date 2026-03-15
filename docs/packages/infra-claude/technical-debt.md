# Technical Debt: @intexuraos/infra-claude

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 3     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 2     | Low      |
| TODOs       | 0     | —        |
| **Total**   | **5** | Low      |

---

## Future Plans

- Extract the `createRequestContext` + `trackUsage` + error handling pattern into a shared `@intexuraos/llm-client-base` utility (shared across Claude, Gemini, GPT)
- Add injectable `auditSink` / `usageSink` to match the API surface of `infra-gemini`
- Add support for system message / instructions configuration
- Add streaming support for long-running requests
- Make `maxTokens` configurable via `ClaudeConfig`

---

## Code Smells

### Low Priority

| File            | Issue                                                                             | Impact                                    |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/client.ts` | `MAX_TOKENS` constant (8192) hardcoded, not configurable                          | Incompatible with models supporting 128k+ |
| `src/client.ts` | `createRequestContext` / `trackUsage` boilerplate duplicated across LLM clients   | Maintenance overhead                      |
| `src/client.ts` | No injectable `auditSink`/`usageSink` unlike `infra-gemini`                       | Harder to test; must mock Firestore       |

---

## TypeScript Issues

| File            | Issue                                                                                   | Count |
| --------------- | --------------------------------------------------------------------------------------- | ----- |
| `src/client.ts` | `as` cast on `Anthropic.Usage` to access `cache_read_input_tokens`                      | 1     |
| `src/client.ts` | `web_search_20250305` and `web_search` passed with `as const` bypassing tool type union | 1     |

**Detail — Cache token fields:**

```ts
const cacheReadTokens =
  (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
```

The Anthropic SDK types do not expose cache fields natively. Cast is safe at runtime since the API returns them when prompt caching is active. Monitor `@anthropic-ai/sdk` releases.

**Detail — Web search tool type:**

```ts
tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const }],
```

Works at runtime but bypasses type safety. Will resolve when Anthropic SDK adds web search types.

---

## TODOs / FIXMEs

No TODO/FIXME markers found in source code.

---

## Resolved Issues

| Date       | Issue                                           | Resolution                                       |
| ---------- | ----------------------------------------------- | ------------------------------------------------ |
| 2026-01-27 | Logger was optional, causing inconsistent usage | Made `logger` mandatory via ESLint rule          |
| 2026-01-27 | Usage tracking used ad-hoc patterns             | Migrated to `UsageLogger` class from llm-pricing |

---

## Related

- [README](README.md) — Developer reference
- [Agent Reference](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
