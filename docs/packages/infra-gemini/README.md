# @intexuraos/infra-gemini

Google Gemini API wrapper implementing the `LLMClient` interface from `@intexuraos/llm-contract`. Also provides a tool calling client (`ToolCallingClient`) for multi-step agentic loops.

## What It Wraps

- **External API:** Google Generative AI via `@google/genai` (v1.0+)
- **Provider:** `LlmProviders.Google`
- **Capabilities:** Text generation, web search research (via Google Search grounding), image generation (via Gemini 2.5 Flash Image), function/tool calling with multi-iteration agent loops

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

### `createGeminiToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient`

Factory function returning a `ToolCallingClient` that implements a multi-iteration function calling loop with Gemini. On the first iteration, uses `FunctionCallingConfigMode.ANY` to force a tool call; subsequent iterations use `AUTO`.

```ts
import { createGeminiToolCallingClient, TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';

const toolClient = createGeminiToolCallingClient({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId: 'user-123',
  pricing: TOOL_CALLING_PRICING['gemini-2.5-flash'],
  logger,
});

const result = await toolClient.run({
  systemPrompt: 'You are a GitHub assistant.',
  messages: [{ role: 'user', content: 'List open PRs' }],
  tools: [
    {
      name: 'list_prs',
      description: 'List open pull requests',
      parameters: { type: 'object', properties: { state: { type: 'string' } } },
      run: async (args) => JSON.stringify(await githubClient.listPRs(args)),
    },
  ],
  maxIterations: 5,
});
```

**`ToolCallingClient.run` parameters:**

| Parameter          | Type                     | Description                                                                           |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| `systemPrompt`     | `string`                 | System instruction passed to Gemini                                                   |
| `messages`         | `{ role, content }[]`    | Initial conversation messages                                                         |
| `tools`            | `ToolDefinition[]`       | Tool definitions with `name`, `description`, `parameters`, `run`                      |
| `maxIterations`    | `number` (default 5)     | Maximum tool-call iterations before returning last text response                      |
| `onExhausted`      | `function` (optional)    | Callback invoked when `maxIterations` is reached — returns a repair message to inject |
| `repairIterations` | `number` (default 2)     | Additional iterations allowed after a repair message is injected                      |

**Returns:** `Result<ToolCallingResult, LLMError>` where `ToolCallingResult` includes `content`, `toolCallsMade`, `iterationCount`, and `usage`.

### `TOOL_CALLING_PRICING`

Pre-configured pricing for tool calling models:

```ts
export const TOOL_CALLING_PRICING: Record<ToolCallingModel, ModelPricing> = {
  'gemini-2.5-flash': {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.0,
    groundingCostPerRequest: 0,
  },
};
```

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number`

Calculates USD cost for text operations including optional grounding cost per request.

### `calculateImageCost(size: ImageSize, pricing: ModelPricing): number`

Looks up the image generation cost from `pricing.imagePricing` by size key.

### `normalizeUsage(inputTokens, outputTokens, groundingEnabled, pricing): NormalizedUsage`

Converts raw Gemini usage data into `NormalizedUsage`. Includes `groundingEnabled` flag when Google Search grounding was active.

## Exported Types

| Type                      | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `GeminiClient`            | Type alias for `LLMClient`                            |
| `GeminiConfig`            | Configuration interface for `createGeminiClient`      |
| `GeminiError`             | Re-export of `LLMError` from `llm-contract`           |
| `ToolCallingClientConfig` | Configuration interface for tool calling client       |
| `ResearchResult`          | Re-export from `llm-contract`                         |
| `GenerateResult`          | Re-export from `llm-contract`                         |
| `ImageGenerationResult`   | Re-export from `llm-contract`                         |
| `ImageGenerateOptions`    | Re-export from `llm-contract`                         |
| `SynthesisInput`          | Re-export from `llm-contract`                         |

### GeminiConfig

```ts
interface GeminiConfig {
  apiKey: string;           // Google API key
  model: string;            // e.g., 'gemini-2.5-pro', 'gemini-2.5-flash'
  userId: string;           // User ID for usage tracking
  pricing: ModelPricing;    // Cost configuration for text operations
  imagePricing?: ModelPricing; // Separate pricing for image generation
  logger: Logger;           // Pino logger for structured logging
  auditSink?: AuditSink;    // Optional audit sink override (defaults to Firestore)
  usageSink?: UsageSink;    // Optional usage sink override (defaults to Firestore)
}
```

### ToolCallingClientConfig

```ts
interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel;  // Currently: 'gemini-2.5-flash'
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;
  usageSink?: UsageSink;
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

- **Grounding:** Research uses `{ googleSearch: {} }` in the tool config. The presence of `groundingMetadata` on the response candidate determines `groundingEnabled`.
- **Image model:** Hardcoded to `LlmModels.Gemini25FlashImage` regardless of the `model` field in config.
- **Default image size:** `1024x1024`
- **Image data:** Returned as a `Buffer` decoded from the base64 `inlineData` field of the first candidate part.
- **No MAX_TOKENS:** Unlike other clients, Gemini uses the model's default output limit.
- **Tool calling — first-iteration forcing:** Uses `FunctionCallingConfigMode.ANY` on the first iteration to guarantee a tool call when tools are provided. Switches to `AUTO` for subsequent iterations.
- **Tool calling — hallucinated tool names:** If Gemini calls a tool name not in the tool map, the fake error response is sent back for self-correction rather than returning an error.
- **Tool calling — repair callback:** `onExhausted` allows injecting a correction message when `maxIterations` is reached, giving the model additional repair iterations.
- **Injectable sinks:** `GeminiConfig` and `ToolCallingClientConfig` both support `auditSink` and `usageSink` overrides for testing without Firestore.

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts built via `@intexuraos/llm-prompts` `buildResearchPrompt()`

## Used By

| App / Package         | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `research-agent`      | Research and text generation                  |
| `user-service`        | API key validation and usage                  |
| `todos-agent`         | Task processing                               |
| `data-insights-agent` | Data analysis generation                      |
| `image-service`       | Image generation                              |
| `commands-agent`      | Command processing                            |
| `code-agent`          | GitHub Agent tool calling loop                |
| `llm-factory`         | Dynamic client creation                       |

## Dependencies

| Package                    | Role                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `@google/genai` ^1.0.0     | Google Generative AI SDK                                                                      |
| `@intexuraos/common-core`  | `Result` types, `getErrorMessage`, `Logger`                                                   |
| `@intexuraos/llm-contract` | `LLMClient`, `ToolCallingClient`, `NormalizedUsage`, `ModelPricing`, `LlmModels`, `ImageSize` |
| `@intexuraos/llm-prompts`  | `buildResearchPrompt`                                                                         |
| `@intexuraos/llm-audit`    | `createAuditContext`, `AuditSink`                                                             |
| `@intexuraos/llm-pricing`  | `createUsageLogger`, `UsageSink`                                                              |

## Recent Changes

| Commit      | Description                                                                | When         |
| ----------- | -------------------------------------------------------------------------- | ------------ |
| `c4e3a13c`  | Release v3.3.0                                                             | 2 hours ago  |
| `f098dba2d` | fix(infra-gemini): omit tools from generateContent when no tools provided  | 26 hours ago |
| `987c1f8be` | fix(gemini): enforce tool-call mode and retry on LLM failure for PR triage | 27 hours ago |
| `f83d0d2ae` | fix(infra-gemini): enforce tool calling mode ANY on first iteration        | 31 hours ago |
| `0d6873e40` | feat: add onExhausted repair callback to ToolCallingClient                 | 2 days ago   |
| `293426524` | feat(llm): add tool calling infrastructure for GitHub Agent                | 7 days ago   |
