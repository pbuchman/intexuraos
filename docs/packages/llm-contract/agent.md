# @intexuraos/llm-contract - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-contract
version: 2.1.0
type: module
leaf: false
dependencies: @intexuraos/common-core
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

```typescript
// supportedModels.ts
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';
type LLMModel =
  | 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.0-flash' | 'gemini-2.5-flash-image'
  | 'o4-mini-deep-research' | 'gpt-5.2' | 'gpt-4o-mini' | 'gpt-image-1'
  | 'claude-opus-4-5-20251101' | 'claude-sonnet-4-5-20250929' | 'claude-3-5-haiku-20241022'
  | 'sonar' | 'sonar-pro' | 'sonar-deep-research'
  | 'glm-4.7' | 'glm-4.7-flash';
type ImageModel = 'gpt-image-1' | 'gemini-2.5-flash-image';
type ResearchModel = /* all non-image, non-validation-only models */;
type ValidationModel = 'claude-3-5-haiku-20241022' | 'gemini-2.0-flash' | 'gpt-4o-mini' | 'sonar' | 'glm-4.7' | 'glm-4.7-flash';
type FastModel = 'gemini-2.5-flash' | 'gemini-2.0-flash' | 'glm-4.7-flash' | 'claude-3-5-haiku-20241022' | 'gpt-4o-mini';
type GenericModel = 'gemini-2.5-pro' | 'gpt-5.2';

// types.ts
interface LLMConfig { apiKey: string; model: LLMModel; userId: string; }
interface TokenUsage { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number; cachedTokens?: number; reasoningTokens?: number; webSearchCalls?: number; groundingEnabled?: boolean; providerCost?: number; }
interface NormalizedUsage { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; cacheTokens?: number; reasoningTokens?: number; webSearchCalls?: number; groundingEnabled?: boolean; }
interface GenerateResult { content: string; usage: NormalizedUsage; }
interface ResearchResult { content: string; sources: string[]; usage: NormalizedUsage; }
interface ImageGenerationResult { imageData: Buffer; model: string; usage: NormalizedUsage; }
interface ImageGenerateOptions { size?: '1024x1024' | '1536x1024' | '1024x1536'; slug?: string; }
interface SynthesisInput { model: string; content: string; }
type LLMErrorCode = 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED' | 'CONTEXT_LENGTH' | 'CONTENT_FILTERED';
interface LLMError { code: LLMErrorCode; message: string; }
interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
  generateImage?(prompt: string, options?: ImageGenerateOptions): Promise<Result<ImageGenerationResult, LLMError>>;
}

// pricing.ts
type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
interface ModelPricing { inputPricePerMillion: number; outputPricePerMillion: number; cacheReadMultiplier?: number; cacheWriteMultiplier?: number; webSearchCostPerCall?: number; groundingCostPerRequest?: number; imagePricing?: Partial<Record<ImageSize, number>>; useProviderCost?: boolean; }
interface ProviderPricing { provider: LlmProvider; models: Record<string, ModelPricing>; updatedAt: string; }
interface CostCalculator { calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number; calculateImageCost(size: ImageSize, pricing: ModelPricing): number; }
```

## Exported Functions

```typescript
function getProviderForModel(model: LLMModel): LlmProvider;
function isValidModel(model: string): model is LLMModel;
function isFastModel(model: string): model is FastModel;
```

## Exported Constants

```typescript
const LlmProviders: {
  Google: 'google';
  OpenAI: 'openai';
  Anthropic: 'anthropic';
  Perplexity: 'perplexity';
  Zai: 'zai';
};
const LlmModels: { Gemini25Pro: 'gemini-2.5-pro' /* ...15 more */ };
const ALL_LLM_MODELS: LLMModel[]; // 16 entries
const ALL_FAST_MODELS: FastModel[]; // 5 entries: Gemini25Flash, Gemini20Flash, Glm47Flash, ClaudeHaiku35, GPT4oMini
const MODEL_PROVIDER_MAP: Record<LLMModel, LlmProvider>;
const FAST_MODEL_DISPLAY_NAMES: Record<FastModel, string>; // human-readable names for UI dropdowns
```

## Dependency Graph

```
common-core
  <- llm-contract
       <- llm-factory, llm-pricing, llm-audit, llm-prompts
       <- infra-claude, infra-gemini, infra-gpt, infra-glm, infra-perplexity
       <- internal-clients
       <- 14 apps
       <- workers/orchestrator
```

## Usage Patterns

```typescript
// Check if a string is a valid model
import { isValidModel, isFastModel, getProviderForModel } from '@intexuraos/llm-contract';
if (isValidModel(userInput)) {
  const provider = getProviderForModel(userInput);
}

// Check if a model is fast (for default model selection)
if (isFastModel(userInput)) {
  // TypeScript narrows to FastModel
}

// Use typed constants
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
const model = LlmModels.Gemini25Flash;
const provider = LlmProviders.Google;

// Implement the LLMClient interface
import type { LLMClient, GenerateResult, LLMError } from '@intexuraos/llm-contract';
class MyClient implements LLMClient {
  async generate(prompt: string): Promise<Result<GenerateResult, LLMError>> {
    /* ... */
  }
  async research(prompt: string): Promise<Result<ResearchResult, LLMError>> {
    /* ... */
  }
}
```
