# @intexuraos/infra-glm

Zai GLM API wrapper implementing the `LLMClient` interface from `@intexuraos/llm-contract`. Uses the OpenAI SDK pointed at Zai's OpenAI-compatible API endpoint.

## What It Wraps

- **External API:** Zai GLM API (OpenAI-compatible) via `openai` SDK (v6.15+)
- **Provider:** `LlmProviders.Zai`
- **Base URL:** `https://api.z.ai/api/paas/v4/`
- **Capabilities:** Text generation, web search research (via GLM's built-in web search tool), prompt caching

## API Reference

### `createGlmClient(config: GlmConfig): GlmClient`

Factory function that returns an `LLMClient` instance configured for Zai GLM.

```ts
import { createGlmClient } from '@intexuraos/infra-glm';

const client = createGlmClient({
  apiKey: process.env.GLM_API_KEY,
  model: 'glm-4.7',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 0.6,
    outputPricePerMillion: 2.2,
    webSearchCostPerCall: 0.005,
  },
  logger: pinoLogger,
});
```

**Methods on the returned client:**

| Method             | Signature                                                       | Description                             |
| ------------------ | --------------------------------------------------------------- | --------------------------------------- |
| `research(prompt)` | `(prompt: string) => Promise<Result<ResearchResult, GlmError>>` | Web search research via GLM search tool |
| `generate(prompt)` | `(prompt: string) => Promise<Result<GenerateResult, GlmError>>` | Text generation without web search      |

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number`

Calculates USD cost for text operations. Splits input tokens into regular and cached portions using `cacheReadMultiplier` (default 0.5).

### `normalizeUsage(inputTokens, outputTokens, cachedTokens, webSearchCalls, reasoningTokens, pricing): NormalizedUsage`

Converts raw GLM usage data into `NormalizedUsage`. Optionally includes `cacheTokens`, `reasoningTokens`, and `webSearchCalls`.

## Exported Types

| Type             | Description                                   |
| ---------------- | --------------------------------------------- |
| `GlmClient`      | Type alias for `LLMClient`                    |
| `GlmConfig`      | Configuration interface for `createGlmClient` |
| `GlmError`       | Re-export of `LLMError` from `llm-contract`   |
| `ResearchResult` | Re-export from `llm-contract`                 |
| `GenerateResult` | Re-export from `llm-contract`                 |
| `SynthesisInput` | Re-export from `llm-contract`                 |

### GlmConfig

```ts
interface GlmConfig {
  apiKey: string;         // Zai GLM API key from open.bigmodel.cn
  model: string;          // e.g., 'glm-4.7'
  userId: string;         // User ID for usage tracking
  pricing: ModelPricing;  // Cost configuration per million tokens
  logger: Logger;         // Pino logger for structured logging
  auditSink?: AuditSink;  // Optional audit sink override (defaults to Firestore)
  usageSink?: UsageSink;  // Optional usage sink override (defaults to Firestore)
}
```

## Configuration

### Environment Variables

| Variable                 | Description     | Required |
| ------------------------ | --------------- | -------- |
| `INTEXURAOS_GLM_API_KEY` | Zai GLM API key | Yes      |

### Pricing Fields

| Field                   | Type   | Description                                      |
| ----------------------- | ------ | ------------------------------------------------ |
| `inputPricePerMillion`  | number | Cost per million input tokens                    |
| `outputPricePerMillion` | number | Cost per million output tokens                   |
| `cacheReadMultiplier`   | number | Multiplier for cached input tokens (default 0.5) |
| `webSearchCostPerCall`  | number | Cost per web search tool invocation              |

## Error Handling

All methods return `Result<T, GlmError>`. Error mapping:

| HTTP Status / Condition         | Error Code         | Description                     |
| ------------------------------- | ------------------ | ------------------------------- |
| 401                             | `INVALID_KEY`      | Invalid API key                 |
| 429                             | `RATE_LIMITED`     | Rate limit exceeded             |
| 500+                            | `OVERLOADED`       | Server error / overloaded       |
| `context_length_exceeded`       | `CONTEXT_LENGTH`   | Prompt exceeds context window   |
| Contains "timeout"              | `TIMEOUT`          | Request timed out               |
| Contains "sensitive"/"filtered" | `CONTENT_FILTERED` | Content safety filter triggered |
| Other `APIError`                | `API_ERROR`        | General API error               |

## Implementation Notes

- Uses the `openai` SDK with `baseURL: 'https://api.z.ai/api/paas/v4/'` to communicate with Zai's OpenAI-compatible API.
- **Research:** Uses a system message instructing the model to act as a senior research analyst. Web search is invoked via a custom tool type `{ type: 'web_search', web_search: { search_query } }` — not part of OpenAI's type definitions; cast as `unknown as ChatCompletionTool`.
- **Source extraction:** URLs are extracted from `web_search` tool call results via `toolCall.web_search.search_result[].link`.
- **Cached tokens:** Extracted from `prompt_tokens_details.cached_tokens` in the response usage.
- **MAX_TOKENS:** Hardcoded to 8192.
- **Injectable sinks:** Supports `auditSink` and `usageSink` overrides for testing without Firestore.

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts built via `@intexuraos/llm-prompts` `buildResearchPrompt()`

## Used By

| App / Package    | Purpose                      |
| ---------------- | ---------------------------- |
| `research-agent` | Research and text generation |
| `user-service`   | API key validation and usage |
| `todos-agent`    | Task processing              |
| `chat-agent`     | Chat completions             |
| `llm-factory`    | Dynamic client creation      |

## Dependencies

| Package                    | Role                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `openai` ^6.15.0           | OpenAI-compatible SDK (pointed at Zai API)                   |
| `@intexuraos/common-core`  | `Result` types, `getErrorMessage`, `Logger`                  |
| `@intexuraos/llm-contract` | `LLMClient`, `NormalizedUsage`, `TokenUsage`, `ModelPricing` |
| `@intexuraos/llm-prompts`  | `buildResearchPrompt`                                        |
| `@intexuraos/llm-audit`    | `createAuditContext`, `AuditSink`                            |
| `@intexuraos/llm-pricing`  | `createUsageLogger`, `UsageSink`                             |

## Recent Changes

| Commit     | Description                                       | When        |
| ---------- | ------------------------------------------------- | ----------- |
| `51b4a325` | Migrate LLM clients to UsageLogger class          | 4 weeks ago |
| `8aad9098` | Migrate imports and delete llm-common             | 4 weeks ago |
| `816afa55` | Add ESLint rule to ban optional logger parameters | 5 weeks ago |
| `6ec4205e` | Make logger mandatory in all LLM configs          | 5 weeks ago |
