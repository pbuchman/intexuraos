# Technical Debt: @intexuraos/infra-perplexity

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Raw HTTP Instead of SDK

Unlike other LLM clients that use official SDKs, this package uses raw `fetch` calls:

```ts
const response = await fetchWithTimeout(
  `${API_BASE_URL}/chat/completions`,
  { method: 'POST', ... },
  timeoutMs
);
```

**Impact:** Medium. This gives full control over streaming and timeouts but requires manual handling of request construction, error parsing, and response processing. The Perplexity OpenAI-compatible API could potentially be accessed via the `openai` SDK.

**Recommendation:** Evaluate whether the `openai` SDK with a custom `baseURL` (similar to `infra-glm`) could replace raw fetch while preserving streaming support.

### Swallowed Parse Errors in Stream Processing

The SSE stream processor silently catches and ignores JSON parse errors:

```ts
try {
  const data = JSON.parse(dataStr) as PerplexityStreamChunk;
  // ...
} catch {
  // Swallow parse errors for malformed intermediate chunks
}
```

**Impact:** Low. SSE streams can contain non-JSON lines (comments, empty data), so swallowing is intentional. However, legitimate parse errors (corrupted responses) are also silently dropped.

**Recommendation:** Add debug-level logging for parse errors to aid troubleshooting.

### Hardcoded webSearchCalls: 1

`normalizeUsage` always sets `webSearchCalls: 1`:

```ts
webSearchCalls: 1, // Default to 1 call for Perplexity normalization
```

**Impact:** Low. Every Perplexity request involves search, so this is semantically correct. However, it does not reflect actual search call counts (Perplexity does not report this metric).

### Cost Calculation Dual Strategy

The cost calculator uses a two-tier approach: prefer provider-reported cost, fall back to calculated cost. This creates a code path that may produce different values depending on whether the provider reports costs.

**Impact:** Low. The fallback calculation is correct, but it means the same model may report slightly different costs depending on whether the API response includes cost data.

## Future Improvements

- Evaluate replacing raw `fetch` with `openai` SDK (custom baseURL) for consistency with other LLM clients
- Add debug-level logging in SSE parse error catch block
- Support `sonar-reasoning` model with reasoning token tracking
- Add citation metadata extraction (title, date) from `search_results` in non-streaming responses
