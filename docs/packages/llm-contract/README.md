# @intexuraos/llm-contract

Shared type definitions and constants for all LLM provider implementations. This package serves as the single source of truth for model names, provider identifiers, pricing structures, and client interfaces across the entire LLM stack.

**Version:** 2.1.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`

## Why It Exists

Every LLM-related package needs to agree on model names, provider strings, error codes, and result shapes. Without a shared contract, each provider package would define its own types, leading to incompatible interfaces and runtime mismatches. `llm-contract` prevents this by providing a single canonical set of types that all packages import.

## API Reference

### Model Types (`supportedModels.ts`)

Defines 16 models across 5 providers as branded string literal types.

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
  | 'sonar-deep-research'
  // Zai (2)
  | 'glm-4.7'
  | 'glm-4.7-flash';

type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';
```

**Category types** narrow `LLMModel` for specific use cases:

| Type              | Purpose                           | Models                                                                                               |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ImageModel`      | Image generation                  | `gpt-image-1`, `gemini-2.5-flash-image`                                                              |
| `ResearchModel`   | Web search enhanced generation    | All models except image-only and validation-only                                                     |
| `ValidationModel` | API key validation (cheap, fast)  | `claude-3-5-haiku`, `gemini-2.0-flash`, `gpt-4o-mini`, `sonar`, `glm-4.7-flash`                     |
| `FastModel`       | Quick tasks (classification, etc) | `gemini-2.5-flash`, `gemini-2.0-flash`, `glm-4.7-flash`, `claude-3-5-haiku-20241022`, `gpt-4o-mini` |
| `GenericModel`    | General-purpose                   | `gemini-2.5-pro`, `gpt-5.2`                                                                          |

### Constants

```typescript
const LlmProviders = {
  Google: 'google',
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Perplexity: 'perplexity',
  Zai: 'zai',
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
  Glm47: 'glm-4.7',
  Glm47Flash: 'glm-4.7-flash',
} as const;

const ALL_LLM_MODELS: LLMModel[];
const ALL_FAST_MODELS: FastModel[];
const MODEL_PROVIDER_MAP: Record<LLMModel, LlmProvider>;
const FAST_MODEL_DISPLAY_NAMES: Record<FastModel, string>;
```

### Runtime Helpers

```typescript
function getProviderForModel(model: LLMModel): LlmProvider;
function isValidModel(model: string): model is LLMModel;
function isFastModel(model: string): model is FastModel;
```

### Client Interface (`types.ts`)

All provider implementations conform to this interface:

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

### Result Types

| Type                    | Fields                                                   |
| ----------------------- | -------------------------------------------------------- |
| `GenerateResult`        | `content`, `usage: NormalizedUsage`                      |
| `ResearchResult`        | `content`, `sources: string[]`, `usage: NormalizedUsage` |
| `ImageGenerationResult` | `imageData: Buffer`, `model`, `usage: NormalizedUsage`   |

### Usage Types

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number; // Anthropic
  cacheReadTokens?: number; // Anthropic
  cachedTokens?: number; // OpenAI
  reasoningTokens?: number; // OpenAI o1
  webSearchCalls?: number;
  groundingEnabled?: boolean; // Google
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
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'INVALID_KEY'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'CONTEXT_LENGTH'
  | 'CONTENT_FILTERED';

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
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<ImageSize, number>>;
  useProviderCost?: boolean;
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

**Packages (10):** `llm-factory`, `llm-pricing`, `llm-audit`, `llm-prompts`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-glm`, `infra-perplexity`, `internal-clients`

**Apps (14):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `user-service`, `web`, `web-agent`

**Workers (1):** `orchestrator`

## Recent Changes

| Commit   | Description                                                               | Age     |
| -------- | ------------------------------------------------------------------------- | ------- |
| 0f69a74b | Extend FastModel with ClaudeHaiku35/GPT4oMini; add ALL_FAST_MODELS, isFastModel, FAST_MODEL_DISPLAY_NAMES | 10 days |
| 44017d5c | Fix ESLint OOM with batched parallel lint runner                          | 17 days |
| 21c1528a | Fix release skill to bump all package versions                            | 3 weeks |
| 4fa0fed3 | Release v2.0.0                                                            | 3 weeks |
| 68ab051c | Break llm-contract -> llm-common dependency                               | 3 weeks |
| 2c3a98ce | Add GLM-4.7-Flash support as free Zai AI model                            | 4 weeks |

## Source Files

| File                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `src/index.ts`           | Re-exports all types, constants, and functions |
| `src/types.ts`           | LLMClient, result types, error types           |
| `src/supportedModels.ts` | Model/provider types, constants, helpers       |
| `src/pricing.ts`         | ModelPricing, ProviderPricing, CostCalculator  |
