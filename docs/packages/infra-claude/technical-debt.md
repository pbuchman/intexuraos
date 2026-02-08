# Technical Debt: @intexuraos/infra-claude

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Type Assertions for Cache Token Fields

`client.ts` casts `Anthropic.Usage` to access `cache_read_input_tokens` and `cache_creation_input_tokens` because the Anthropic SDK types do not expose these fields directly:

```ts
const cacheReadTokens =
  (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
```

**Impact:** Low. The assertion is safe since the API returns these fields when prompt caching is active, but a future SDK version may expose them natively.

**Recommendation:** Monitor `@anthropic-ai/sdk` releases and replace casts when the SDK adds native type support.

### Web Search Tool Type Assertion

The `web_search_20250305` tool type and `web_search` name are passed with `as const` assertions because the SDK's tool type union may not include the web search variant:

```ts
tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const }],
```

**Impact:** Low. Works at runtime but bypasses type safety.

**Recommendation:** Update when the Anthropic SDK adds web search tool types to its type definitions.

### Hardcoded MAX_TOKENS

The `MAX_TOKENS` constant (8192) is hardcoded rather than configurable. Some models support larger output limits.

**Recommendation:** Consider making `maxTokens` an optional field on `ClaudeConfig`.

## Future Improvements

- Extract the `createRequestContext` + `trackUsage` + error handling pattern into a shared utility across all LLM clients (Claude, Gemini, GPT, GLM, Perplexity share identical boilerplate)
- Add support for system message/instructions configuration
- Add streaming support for long-running requests
