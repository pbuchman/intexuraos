# Technical Debt: @intexuraos/infra-glm

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Force-Cast for Web Search Tool Type

The GLM web search tool is passed as an unknown cast because the OpenAI SDK types do not support the `web_search` tool type:

```ts
tools: [
  {
    type: 'web_search',
    web_search: { search_query: prompt },
  } as unknown as OpenAI.Chat.Completions.ChatCompletionTool,
],
```

**Impact:** Medium. Bypasses type safety entirely. If the Zai API changes the tool format, the error will only surface at runtime.

**Recommendation:** Create a local type definition for GLM-specific tools rather than casting through `unknown`.

### Force-Cast for Web Search Tool Call Response

Source extraction casts tool calls through `unknown` to access GLM-specific fields:

```ts
if ((toolCall.type as string) === 'web_search') {
  const webSearchData = toolCall as unknown as WebSearchToolCall;
```

**Impact:** Medium. Same rationale as above -- runtime-only validation.

### Unused `reasoningTokens` Parameter

The `normalizeUsage` function accepts a `reasoningTokens` parameter, but `createGlmClient` always passes `undefined` for it. The GLM client calls `extractUsageDetails` which does not extract reasoning tokens.

**Impact:** Low. The parameter exists for API compatibility with the GPT cost calculator (they share the same signature).

**Recommendation:** Clean up if GLM models never support reasoning tokens, or document the intent to support future GLM reasoning models.

### Hardcoded API Base URL

The API base URL is a hardcoded constant:

```ts
const GLM_API_BASE = 'https://api.z.ai/api/paas/v4/';
```

**Impact:** Low. The URL is stable, but it prevents using alternative environments or API versions.

**Recommendation:** Consider making the base URL configurable via `GlmConfig`.

## Shared Pattern Duplication

The `createRequestContext`, `trackUsage`, and error handling boilerplate is nearly identical across all five LLM client packages.

**Recommendation:** Extract into a shared `@intexuraos/llm-client-base` utility.

## Future Improvements

- Replace `unknown` casts with proper GLM-specific type definitions
- Add streaming support for long-running research queries
- Make API base URL configurable for different Zai environments
