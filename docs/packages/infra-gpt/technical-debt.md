# Technical Debt: @intexuraos/infra-gpt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 1     | Low      |
| TODOs       | 0     | —        |
| **Total**   | **5** | Medium   |

---

## Future Plans

- Unify the Responses API and Chat Completions API code paths if OpenAI converges these APIs
- Add `AbortController` timeout to image URL fetch (currently no timeout — can hang indefinitely)
- Add streaming support for long-running requests
- Make `maxTokens` configurable via `GptConfig` (some GPT models support 128k output tokens)
- Add injectable `auditSink` / `usageSink` to match the API surface of `infra-gemini`
- Extract `createRequestContext` / `trackUsage` boilerplate into `@intexuraos/llm-client-base`

---

## Code Smells

### Medium Priority

| File            | Issue                                                                                                 | Impact                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/client.ts` | Image URL fetch has no timeout: `const imageResponse = await fetch(imageUrl)` — can hang indefinitely | Production risk if image CDN is slow or unresponsive |
| `src/client.ts` | Dual API pattern (Responses + Chat Completions) requires two usage extraction code paths              | Complexity; must be maintained separately            |
| `src/client.ts` | `MAX_TOKENS` constant (8192) hardcoded — incompatible with 128k output models                         | Cannot use full output capacity of GPT-4o            |
| `src/client.ts` | `createRequestContext` / `trackUsage` boilerplate duplicated across LLM clients                       | Maintenance overhead                                 |

---

## TypeScript Issues

| File            | Issue                                                                                                               | Count |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/client.ts` | Type assertion on usage to access `input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens` | 1     |

**Detail:**

```ts
const cachedTokens =
  'input_tokens_details' in usage
    ? ((usage as { input_tokens_details?: { cached_tokens?: number } }).input_tokens_details
        ?.cached_tokens ?? 0)
    : 0;
```

The OpenAI SDK types do not fully expose nested detail fields. The assertion is safe for current API versions. Monitor OpenAI SDK releases for improved type definitions.

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
