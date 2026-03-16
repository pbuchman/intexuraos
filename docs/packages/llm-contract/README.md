# @intexuraos/llm-contract

Shared type definitions, constants, and interfaces for all LLM provider implementations. Serves as the single source of truth for model names, provider identifiers, pricing structures, error codes, and client interfaces across the entire LLM stack.

**Version:** 3.3.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`

## Why It Exists

Every LLM-related package needs to agree on model names, provider strings, error codes, and result shapes. Without a shared contract, each provider package would define its own types, leading to incompatible interfaces and runtime mismatches. `llm-contract` prevents this by providing a single canonical set of types that all packages import.

## API Reference

### Model Types (`supportedModels.ts`)

Defines 14 models across 4 providers as branded string literal types.

```typescript
type LLMModel =
  // Google (4)
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.0-flash'
  | 'gemini-2.5-flash-image'
  // OpenAI (4)
  | 'o4-mini-deep-research'
  | 'gpt-5.2'
  | 'gpt-4o-mini'
  | 'gpt-image-1'
  // Anthropic (3)
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'claude-3-5-haiku-20241022'
  // Perplexity (3)
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-deep-research';

type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';
```

**Category types** narrow `LLMModel` for specific use cases:

| Type               | Purpose                            | Models                                                                                                                                                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImageModel`       | Image generation                   | `gpt-image-1`, `gemini-2.5-flash-image`                                                                                                                                         |
| `ResearchModel`    | Web search enhanced generation     | `gemini-2.5-pro`, `gemini-2.5-flash`, `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `o4-mini-deep-research`, `gpt-5.2`, `sonar`, `sonar-pro`, `sonar-deep-research` |
| `ValidationModel`  | API key validation (cheap, fast)   | `claude-3-5-haiku-20241022`, `gemini-2.0-flash`, `gpt-4o-mini`, `sonar`                                                                                                         |
| `FastModel`        | Quick tasks (classification, etc.) | `gemini-2.5-flash`, `gemini-2.0-flash`, `claude-3-5-haiku-20241022`, `gpt-4o-mini`                                                                                              |
| `GenericModel`     | General-purpose                    | `gemini-2.5-pro`, `gpt-5.2`                                                                                                                                                     |
| `ToolCallingModel` | Agent tool-calling loops           | `gemini-2.5-flash`                                                                                                                                                              |

### Constants

```typescript
const LlmProviders = {
  Google: 'google',
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Perplexity: 'perplexity',
} as const;

const LlmModels = {
  Gemini25Pro: 'gemini-2.5-pro',
  Gemini25Flash: 'gemini-2.5-flash',
  Gemini20Flash: 'gemini-2.0-flash',
  Gemini25FlashImage: 'gemini-2.5-flash-image',
  O4MiniDeepResearch: 'o4-mini-deep-research',
  GPT52: 'gpt-5.2',
  GPT4oMini: 'gpt-4o-mini',
  GPTImage1: 'gpt-image-1',
  ClaudeOpus45: 'claude-opus-4-5-20251101',
  ClaudeSonnet45: 'claude-sonnet-4-5-20250929',
  ClaudeHaiku35: 'claude-3-5-haiku-20241022',
  Sonar: 'sonar',
  SonarPro: 'sonar-pro',
  SonarDeepResearch: 'sonar-deep-research',
} as const;

const ALL_LLM_MODELS: LLMModel[];           // All 14 models
const ALL_FAST_MODELS: FastModel[];         // 4 fast models
const ALL_TOOL_CALLING_MODELS: ToolCallingModel[]; // ['gemini-2.5-flash']
const MODEL_PROVIDER_MAP: Record<LLMModel, LlmProvider>;
const FAST_MODEL_DISPLAY_NAMES: Record<FastModel, string>;
```

### Runtime Helpers

```typescript
function getProviderForModel(model: LLMModel): LlmProvider;
function isValidModel(model: string): model is LLMModel;
function isFastModel(model: string): model is FastModel;
function isToolCallingModel(model: string): model is ToolCallingModel;
```

### Client Interface (`types.ts`)

All LLM provider implementations conform to `LLMClient`:

```typescript
interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
  generateImage?(
    prompt: string,
    options?: ImageGenerateOptions
  ): Promise<Result<ImageGenerationResult, LLMError>>;
}
```

### Tool Calling Interface (`toolCalling.ts`)

Abstract contract for agent loops. Provider-specific implementations live in `infra-*` packages.

```typescript
interface ToolCallingClient {
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;          // default: 5
    onExhausted?: (context: {
      iterationCount: number;
      toolCallsMade: number;
    }) => string | undefined;        // inject repair message or fail
    repairIterations?: number;       // default: 2
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema sent to LLM
  run: (args: Record<string, unknown>) => Promise<string>; // returns JSON string
}

interface ToolCallingResult {
  content: string;
  toolCallsMade: number;
  iterationCount: number;
  usage: NormalizedUsage;
}
```

### Result Types

| Type                    | Fields                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `GenerateResult`        | `content: string`, `usage: NormalizedUsage`                      |
| `ResearchResult`        | `content: string`, `sources: string[]`, `usage: NormalizedUsage` |
| `ImageGenerationResult` | `imageData: Buffer`, `model: string`, `usage: NormalizedUsage`   |

### Usage Types

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number; // Anthropic: tokens written to cache
  cacheReadTokens?: number;     // Anthropic: tokens read from cache
  cachedTokens?: number;        // OpenAI: combined cached tokens
  reasoningTokens?: number;     // OpenAI o-series extended reasoning
  webSearchCalls?: number;
  groundingEnabled?: boolean;   // Google grounding flag
  providerCost?: number;
}

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
}
```

### Error Types

```typescript
type LLMErrorCode =
  | 'API_ERROR'        // General provider error
  | 'TIMEOUT'          // Request timed out — retry with backoff
  | 'INVALID_KEY'      // API key invalid or missing
  | 'RATE_LIMITED'     // Rate limit hit — retry with backoff
  | 'OVERLOADED'       // Provider overloaded — retry after delay
  | 'CONTEXT_LENGTH'   // Prompt exceeds model context window
  | 'CONTENT_FILTERED'; // Content filtered by safety systems

interface LLMError {
  code: LLMErrorCode;
  message: string;
}
```

### Pricing Types (`pricing.ts`)

```typescript
interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;       // e.g. 0.1 = 10% of base (Anthropic)
  cacheWriteMultiplier?: number;      // e.g. 1.25 = 125% of base (Anthropic)
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<ImageSize, number>>;
  useProviderCost?: boolean;          // Use cost from provider response instead
}

interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

interface CostCalculator {
  calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
  calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
}

type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
```

## Used By

**Packages (9):** `llm-factory`, `llm-pricing`, `llm-audit`, `llm-prompts`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-perplexity`, `internal-clients`

**Apps (14):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `user-service`, `web`, `web-agent`

**Workers (1):** `orchestrator`

## Recent Changes

| Commit    | Description                                                     | Age     |
| --------- | --------------------------------------------------------------- | ------- |
| c4e3a13cb | Release v3.3.0                                                  | 2 hours |
| e4d231053 | Remove ZAI provider and GLM-4.7 models, finalize GLM-5 removal  | 3 days  |
| 293426524 | Add tool calling infrastructure for GitHub Agent                | 7 days  |
| 44ae683ae | Release v3.2.0                                                  | 8 days  |

## Source Files

| File                     | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `src/index.ts`           | Re-exports all types, constants, and functions             |
| `src/types.ts`           | `LLMClient`, result types, error types, usage types        |
| `src/supportedModels.ts` | Model/provider types, constants, runtime helpers           |
| `src/pricing.ts`         | `ModelPricing`, `ProviderPricing`, `CostCalculator`        |
| `src/toolCalling.ts`     | `ToolCallingClient`, `ToolDefinition`, `ToolCallingResult` |
