# @intexuraos/infra-gemini

Google Gemini API wrapper implementing the `LLMClient` interface from `@intexuraos/llm-contract`.

## What It Wraps

- **External API:** Google Generative AI via `@google/genai` (v1.0+)
- **Provider:** `LlmProviders.Google`
- **Capabilities:** Text generation, web search research (via Google Search grounding), image generation (via Gemini 2.5 Flash Image)

## API Reference

### `createGeminiClient(config: GeminiConfig): GeminiClient`

Factory function that returns an `LLMClient` instance configured for Google Gemini.

```ts
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    groundingCostPerRequest: 0.002,
  },
  logger: pinoLogger,
});
```

**Methods on the returned client:**

| Method                            | Signature                                                                                                 | Description                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `research(prompt)`                | `(prompt: string) => Promise<Result<ResearchResult, GeminiError>>`                                        | Research using Google Search grounding |
| `generate(prompt)`                | `(prompt: string) => Promise<Result<GenerateResult, GeminiError>>`                                        | Text generation without grounding      |
| `generateImage(prompt, options?)` | `(prompt: string, options?: ImageGenerateOptions) => Promise<Result<ImageGenerationResult, GeminiError>>` | Image generation via Gemini 2.5 Flash  |

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number`

Calculates USD cost for text operations including optional grounding cost per request.

### `calculateImageCost(size: ImageSize, pricing: ModelPricing): number`

Looks up the image generation cost from `pricing.imagePricing` by size key.

### `normalizeUsage(inputTokens, outputTokens, groundingEnabled, pricing): NormalizedUsage`

Converts raw Gemini usage data into `NormalizedUsage`. Includes `groundingEnabled` flag when Google Search grounding was active.

## Exported Types

| Type                    | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `GeminiClient`          | Type alias for `LLMClient`                       |
| `GeminiConfig`          | Configuration interface for `createGeminiClient` |
| `GeminiError`           | Re-export of `LLMError` from `llm-contract`      |
| `ResearchResult`        | Re-export from `llm-contract`                    |
| `GenerateResult`        | Re-export from `llm-contract`                    |
| `ImageGenerationResult` | Re-export from `llm-contract`                    |
| `ImageGenerateOptions`  | Re-export from `llm-contract`                    |
| `SynthesisInput`        | Re-export from `llm-contract`                    |

### GeminiConfig

```ts
interface GeminiConfig {
  apiKey: string; // Google API key
  model: string; // e.g., 'gemini-2.5-pro', 'gemini-2.5-flash'
  userId: string; // User ID for usage tracking
  pricing: ModelPricing; // Cost configuration for text operations
  imagePricing?: ModelPricing; // Separate pricing for image generation
  logger: Logger; // Pino logger for structured logging
  auditSink?: AuditSink; // Optional audit sink override (defaults to Firestore)
  usageSink?: UsageSink; // Optional usage sink override (defaults to Firestore)
}
```

## Configuration

### Environment Variables

| Variable                    | Description    | Required |
| --------------------------- | -------------- | -------- |
| `INTEXURAOS_GOOGLE_API_KEY` | Google API key | Yes      |

### Pricing Fields

| Field                     | Type   | Description                                          |
| ------------------------- | ------ | ---------------------------------------------------- |
| `inputPricePerMillion`    | number | Cost per million input tokens                        |
| `outputPricePerMillion`   | number | Cost per million output tokens                       |
| `groundingCostPerRequest` | number | Flat cost per grounded research request              |
| `imagePricing`            | object | Size-to-cost map for image generation (per size key) |

## Error Handling

All methods return `Result<T, GeminiError>`. Error mapping:

| Condition                   | Error Code         | Description             |
| --------------------------- | ------------------ | ----------------------- |
| Contains "API_KEY"          | `INVALID_KEY`      | Invalid Google API key  |
| Contains "429"/"quota"      | `RATE_LIMITED`     | Quota exceeded          |
| Contains "timeout"          | `TIMEOUT`          | Request timed out       |
| Contains "SAFETY"/"blocked" | `CONTENT_FILTERED` | Safety filter triggered |
| Other errors                | `API_ERROR`        | General API error       |

## Implementation Notes

- **Grounding:** Research uses `{ googleSearch: {} }` in the tool config. The presence of `groundingMetadata` on the response determines `groundingEnabled`.
- **Image model:** Hardcoded to `LlmModels.Gemini25FlashImage` regardless of the `model` field in config.
- **Default image size:** `1024x1024`
- **Image data:** Returned as a `Buffer` decoded from the base64 `inlineData` field of the first candidate part.
- **No MAX_TOKENS:** Unlike other clients, Gemini uses the model's default output limit.
- **Injectable sinks:** Supports `auditSink` and `usageSink` overrides for testing without Firestore.

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts built via `@intexuraos/llm-prompts` `buildResearchPrompt()`

## Used By

| App / Package         | Purpose                      |
| --------------------- | ---------------------------- |
| `research-agent`      | Research and text generation |
| `user-service`        | API key validation and usage |
| `todos-agent`         | Task processing              |
| `data-insights-agent` | Data analysis generation     |
| `image-service`       | Image generation             |
| `commands-agent`      | Command processing           |
| `llm-factory`         | Dynamic client creation      |

## Dependencies

| Package                    | Role                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `@google/genai` ^1.0.0     | Google Generative AI SDK                                                 |
| `@intexuraos/common-core`  | `Result` types, `getErrorMessage`, `Logger`                              |
| `@intexuraos/llm-contract` | `LLMClient`, `NormalizedUsage`, `ModelPricing`, `LlmModels`, `ImageSize` |
| `@intexuraos/llm-prompts`  | `buildResearchPrompt`                                                    |
| `@intexuraos/llm-audit`    | `createAuditContext`, `AuditSink`                                        |
| `@intexuraos/llm-pricing`  | `createUsageLogger`, `UsageSink`                                         |

## Recent Changes

| Commit     | Description                                       | When        |
| ---------- | ------------------------------------------------- | ----------- |
| `51b4a325` | Migrate LLM clients to UsageLogger class          | 4 weeks ago |
| `8aad9098` | Migrate imports and delete llm-common             | 4 weeks ago |
| `816afa55` | Add ESLint rule to ban optional logger parameters | 5 weeks ago |
| `6ec4205e` | Make logger mandatory in all LLM configs          | 5 weeks ago |
