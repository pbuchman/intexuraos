# @intexuraos/infra-gpt

OpenAI GPT API wrapper implementing the `LLMClient` interface from `@intexuraos/llm-contract`.

## What It Wraps

- **External API:** OpenAI API via `openai` SDK (v6.15+)
- **Provider:** `LlmProviders.OpenAI`
- **Capabilities:** Text generation, web search research (via `web_search_preview` tool), image generation (via `gpt-image-1`), prompt caching, reasoning token tracking

## API Reference

### `createGptClient(config: GptConfig): GptClient`

Factory function that returns an `LLMClient` instance configured for OpenAI GPT.

```ts
import { createGptClient } from '@intexuraos/infra-gpt';

const client = createGptClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  imagePricing: {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricing: { '1024x1024': 0.04, '1536x1024': 0.05, '1024x1536': 0.05 },
  },
  logger: pinoLogger,
});
```

**Methods on the returned client:**

| Method                            | Signature                                                                                              | Description                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `research(prompt)`                | `(prompt: string) => Promise<Result<ResearchResult, GptError>>`                                        | Web search research via Responses API    |
| `generate(prompt)`                | `(prompt: string) => Promise<Result<GenerateResult, GptError>>`                                        | Text generation via Chat Completions API |
| `generateImage(prompt, options?)` | `(prompt: string, options?: ImageGenerateOptions) => Promise<Result<ImageGenerationResult, GptError>>` | Image generation via DALL-E              |

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number`

Calculates USD cost for text operations. Splits input tokens into regular and cached portions using `cacheReadMultiplier` (default 0.5).

### `calculateImageCost(size: ImageSize, pricing: ModelPricing): number`

Looks up the image generation cost from `pricing.imagePricing` by size key.

### `normalizeUsage(inputTokens, outputTokens, cachedTokens, webSearchCalls, reasoningTokens, pricing): NormalizedUsage`

Converts raw OpenAI usage data into `NormalizedUsage`. Optionally includes `cacheTokens`, `reasoningTokens`, and `webSearchCalls`.

## Exported Types

| Type                    | Description                                   |
| ----------------------- | --------------------------------------------- |
| `GptClient`             | Type alias for `LLMClient`                    |
| `GptConfig`             | Configuration interface for `createGptClient` |
| `GptError`              | Re-export of `LLMError` from `llm-contract`   |
| `ResearchResult`        | Re-export from `llm-contract`                 |
| `GenerateResult`        | Re-export from `llm-contract`                 |
| `ImageGenerationResult` | Re-export from `llm-contract`                 |
| `ImageGenerateOptions`  | Re-export from `llm-contract`                 |
| `SynthesisInput`        | Re-export from `llm-contract`                 |

### GptConfig

```ts
interface GptConfig {
  apiKey: string;            // OpenAI API key from platform.openai.com
  model: string;             // e.g., 'gpt-4.1', 'gpt-4o-mini', 'o4-mini-deep-research'
  userId: string;            // User ID for usage tracking
  pricing: ModelPricing;     // Cost configuration for text operations
  imagePricing?: ModelPricing; // Separate pricing for image generation
  logger: Logger;            // Pino logger for structured logging
}
```

## Configuration

### Environment Variables

| Variable                        | Description    | Required |
| ------------------------------- | -------------- | -------- |
| `INTEXURAOS_OPENAI_APP_API_KEY` | OpenAI API key | Yes      |

### Pricing Fields

| Field                   | Type   | Description                                      |
| ----------------------- | ------ | ------------------------------------------------ |
| `inputPricePerMillion`  | number | Cost per million input tokens                    |
| `outputPricePerMillion` | number | Cost per million output tokens                   |
| `cacheReadMultiplier`   | number | Multiplier for cached input tokens (default 0.5) |
| `webSearchCostPerCall`  | number | Cost per web search tool invocation              |
| `imagePricing`          | object | Size-to-cost map for image generation            |

## Error Handling

All methods return `Result<T, GptError>`. Error mapping:

| HTTP Status / Condition   | Error Code       | Description                   |
| ------------------------- | ---------------- | ----------------------------- |
| 401                       | `INVALID_KEY`    | Invalid API key               |
| 429                       | `RATE_LIMITED`   | Rate limit exceeded           |
| `context_length_exceeded` | `CONTEXT_LENGTH` | Prompt exceeds context window |
| Contains "timeout"        | `TIMEOUT`        | Request timed out             |
| Other `APIError`          | `API_ERROR`      | General API error             |

## Implementation Notes

- **Research** uses the OpenAI Responses API (`client.responses.create`) with `web_search_preview` tool at `medium` search context size.
- **Generate** uses the Chat Completions API (`client.chat.completions.create`) with `max_completion_tokens: 8192`.
- **Image generation** uses `client.images.generate` with `gpt-image-1` model. Supports both `b64_json` (primary) and URL (fallback) response formats — URL responses are fetched via `fetch()` with no timeout.
- **Reasoning tokens:** Extracted from `output_tokens_details.reasoning_tokens` for o-series models. Included in `NormalizedUsage.reasoningTokens` when present.
- **Dual usage shapes:** The Responses API and Chat Completions API return different usage structures (`ResponseUsage` vs `CompletionUsage`). `extractUsageDetails` handles both shapes.
- **Audit sink:** This client does not accept injectable `auditSink`/`usageSink` — it uses the default Firestore sinks.

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts built via `@intexuraos/llm-prompts` `buildResearchPrompt()`

## Used By

| App / Package    | Purpose                      |
| ---------------- | ---------------------------- |
| `research-agent` | Research and text generation |
| `user-service`   | API key validation and usage |
| `image-service`  | Image generation via DALL-E  |

## Dependencies

| Package                    | Role                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `openai` ^6.15.0           | OpenAI API SDK                                                           |
| `@intexuraos/common-core`  | `Result` types, `getErrorMessage`, `Logger`                              |
| `@intexuraos/llm-contract` | `LLMClient`, `NormalizedUsage`, `ModelPricing`, `LlmModels`, `ImageSize` |
| `@intexuraos/llm-prompts`  | `buildResearchPrompt`                                                    |
| `@intexuraos/llm-audit`    | `createAuditContext`                                                     |
| `@intexuraos/llm-pricing`  | `createUsageLogger`                                                      |

## Recent Changes

| Commit     | Description                                       | When        |
| ---------- | ------------------------------------------------- | ----------- |
| `c4e3a13c` | Release v3.3.0                                    | 2 hours ago |
| `51b4a325` | Migrate LLM clients to UsageLogger class          | 4 weeks ago |
| `8aad9098` | Migrate imports and delete llm-common             | 4 weeks ago |
| `816afa55` | Add ESLint rule to ban optional logger parameters | 5 weeks ago |
| `6ec4205e` | Make logger mandatory in all LLM configs          | 5 weeks ago |
