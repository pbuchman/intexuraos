# Technical Debt: @intexuraos/infra-glm

**Last Updated:** 2026-02-19

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 3     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 2     | Medium   |
| TODOs       | 0     | —        |
| **Total**   | **5** | Medium   |

---

## Future Plans

- Replace `unknown` casts for web search tool type with proper GLM-specific type definitions
- Add streaming support for long-running research queries
- Make API base URL configurable via `GlmConfig` for alternative Zai environments
- Extract `createRequestContext` / `trackUsage` boilerplate into `@intexuraos/llm-client-base`
- Clean up or document the `reasoningTokens` parameter — always `undefined` at call sites

---

## Code Smells

### Medium Priority

| File            | Issue                                                                             | Impact                                   |
| --------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/client.ts` | `GLM_API_BASE` hardcoded constant — cannot target alternative Zai environments    | Must modify code to test against staging |
| `src/client.ts` | `createRequestContext` / `trackUsage` boilerplate duplicated across 4 LLM clients | Maintenance overhead                     |

### Low Priority

| File                    | Issue                                                                           | Impact                               |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `src/costCalculator.ts` | `normalizeUsage` accepts `reasoningTokens` but client always passes `undefined` | Dead parameter; misleading signature |

---

## TypeScript Issues

| File            | Issue                                                                                           | Count |
| --------------- | ----------------------------------------------------------------------------------------------- | ----- |
| `src/client.ts` | Web search tool cast: `as unknown as OpenAI.Chat.Completions.ChatCompletionTool`                | 1     |
| `src/client.ts` | Tool call type cast: `(toolCall.type as string)` and `toolCall as unknown as WebSearchToolCall` | 1     |

**Detail — Tool type cast:**

```ts
tools: [
  {
    type: 'web_search',
    web_search: { search_query: prompt },
  } as unknown as OpenAI.Chat.Completions.ChatCompletionTool,
],
```

The OpenAI SDK types do not include Zai's `web_search` tool type. Cast through `unknown` bypasses all type safety. If the Zai API changes the tool format, errors will only surface at runtime.

**Recommendation:** Define a local `ZaiWebSearchTool` interface and use it instead of casting through `unknown`.

**Detail — Source extraction cast:**

```ts
if ((toolCall.type as string) === 'web_search') {
  const webSearchData = toolCall as unknown as WebSearchToolCall;
```

Same issue — accessing response fields that are not in the OpenAI SDK response types. The local `WebSearchToolCall` interface is defined in `client.ts` but cannot be connected to the `toolCall` type without casting.

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
