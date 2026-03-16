# @intexuraos/llm-contract — Agent Reference

> Machine-readable interface for automated tooling and AI agents.

## Identity

| Attribute | Value                                                               |
| --------- | ------------------------------------------------------------------- |
| Package   | `@intexuraos/llm-contract`                                          |
| Role      | Shared type contract for all LLM providers                          |
| Goal      | Single source of truth for model names, interfaces, and error codes |
| Type      | Types-only (plus small runtime helpers) — no business logic         |

## Exports

### Runtime Constants

| Export                     | Type                                        | Value                                    |
| -------------------------- | ------------------------------------------- | ---------------------------------------- |
| `LlmProviders`             | `{ Google, OpenAI, Anthropic, Perplexity }` | Provider string constants                |
| `LlmModels`                | `Record<string, LLMModel>`                  | All 14 model string constants            |
| `ALL_LLM_MODELS`           | `LLMModel[]`                                | Array of all 14 models                   |
| `ALL_FAST_MODELS`          | `FastModel[]`                               | Array of 4 fast models                   |
| `ALL_TOOL_CALLING_MODELS`  | `ToolCallingModel[]`                        | `['gemini-2.5-flash']`                   |
| `MODEL_PROVIDER_MAP`       | `Record<LLMModel, LlmProvider>`             | Model → provider lookup                  |
| `FAST_MODEL_DISPLAY_NAMES` | `Record<FastModel, string>`                 | Human-readable names for fast models     |

### Runtime Functions

| Export                | Signature                                      | Purpose                             |
| --------------------- | ---------------------------------------------- | ----------------------------------- |
| `getProviderForModel` | `(model: LLMModel) => LlmProvider`             | Map model to its provider           |
| `isValidModel`        | `(model: string) => model is LLMModel`         | Runtime type guard for model string |
| `isFastModel`         | `(model: string) => model is FastModel`        | Runtime guard for fast models       |
| `isToolCallingModel`  | `(model: string) => model is ToolCallingModel` | Guard for tool calling models       |

### Key Types

```typescript
// Providers
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

// All 14 supported models
type LLMModel = 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.0-flash'
  | 'gemini-2.5-flash-image' | 'o4-mini-deep-research' | 'gpt-5.2'
  | 'gpt-4o-mini' | 'gpt-image-1' | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929' | 'claude-3-5-haiku-20241022'
  | 'sonar' | 'sonar-pro' | 'sonar-deep-research';

// Narrowed subsets
type ImageModel = 'gpt-image-1' | 'gemini-2.5-flash-image';
type FastModel = 'gemini-2.5-flash' | 'gemini-2.0-flash' | 'claude-3-5-haiku-20241022' | 'gpt-4o-mini';
type ToolCallingModel = 'gemini-2.5-flash';

// Client interface
interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
  generateImage?(prompt: string, options?: ImageGenerateOptions): Promise<Result<ImageGenerationResult, LLMError>>;
}

// Tool calling
interface ToolCallingClient {
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;
    onExhausted?: (ctx: { iterationCount: number; toolCallsMade: number }) => string | undefined;
    repairIterations?: number;
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

// Error codes
type LLMErrorCode = 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED'
  | 'OVERLOADED' | 'CONTEXT_LENGTH' | 'CONTENT_FILTERED';

interface LLMError { code: LLMErrorCode; message: string; }

// Pricing
interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<'1024x1024' | '1536x1024' | '1024x1536', number>>;
  useProviderCost?: boolean;
}
```

## Constraints

**Do NOT:**
- Add business logic to this package — it must remain types + runtime guards only
- Reference this package from `common-*` packages (would create circular dependency)
- Add provider-specific implementation details here

**Requires:**
- Only `@intexuraos/common-core` as a dependency (for `Result` type)

## Dependencies

| Package                   | Why Needed          |
| ------------------------- | ------------------- |
| `@intexuraos/common-core` | `Result` type usage |
