# Technical Debt: @intexuraos/infra-gpt

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Type Assertions for Usage Details

`extractUsageDetails` uses type assertions to access `input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens` because the OpenAI SDK types do not fully expose nested detail fields:

```ts
const cachedTokens =
  'input_tokens_details' in usage
    ? ((usage as { input_tokens_details?: { cached_tokens?: number } }).input_tokens_details
        ?.cached_tokens ?? 0)
    : 0;
```

**Impact:** Low. The assertion is safe for current API versions but fragile if the response shape changes.

**Recommendation:** Monitor OpenAI SDK releases for improved type definitions.

### Dual API Pattern (Responses + Chat Completions)

The client uses two different OpenAI APIs:

- `research()` uses `client.responses.create` (Responses API with tool support)
- `generate()` uses `client.chat.completions.create` (Chat Completions API)

This creates a dual code path for usage extraction since the two APIs return different response shapes (`ResponseUsage` vs `CompletionUsage`).

**Impact:** Low. Both APIs are stable, but maintaining two code paths increases surface area.

### Image URL Fallback

The `generateImage` method handles both `b64_json` and `url` response formats:

```ts
const b64Data = imageData?.b64_json ?? imageData?.url;
```

When a URL is returned, it fetches the image data with a bare `fetch()` call without timeout or error handling beyond try/catch.

**Impact:** Medium. The URL fetch has no timeout, so a slow image host could hang indefinitely.

**Recommendation:** Add `AbortController` timeout to the image URL fetch, similar to the pattern used in `infra-whatsapp`.

### Hardcoded MAX_TOKENS

The `MAX_TOKENS` constant (8192) limits all text generation. Some GPT models support up to 128k output tokens.

**Recommendation:** Make `maxTokens` configurable via `GptConfig`.

## Shared Pattern Duplication

The `createRequestContext`, `trackUsage`, and error handling boilerplate is nearly identical across all five LLM client packages.

**Recommendation:** Extract into a shared `@intexuraos/llm-client-base` utility.

## Future Improvements

- Unify the Responses API and Chat Completions API code paths if OpenAI converges these APIs
- Add `AbortController` timeout to image URL fetch
- Add streaming support for long-running requests
- Make `maxTokens` configurable
