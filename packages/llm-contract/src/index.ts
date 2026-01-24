/**
 * @intexuraos/llm-contract
 *
 * Common types and interfaces for LLM client implementations.
 */

export type {
  LLMConfig,
  TokenUsage,
  NormalizedUsage,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  LLMErrorCode,
  LLMError,
  LLMClient,
} from './types.js';

export {
  ALL_LLM_MODELS,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isValidModel,
  LlmModels,
  LlmProviders,
} from './supportedModels.js';

export type {
  LLMModel,
  LlmProvider,
  ImageModel,
  ResearchModel,
  ValidationModel,
  FastModel,
  GenericModel,
  // Individual model types
  Gemini25Pro,
  Gemini25Flash,
  Gemini20Flash,
  Gemini25FlashImage,
  O4MiniDeepResearch,
  GPT52,
  GPT4oMini,
  GPTImage1,
  ClaudeOpus45,
  ClaudeSonnet45,
  ClaudeHaiku35,
  Sonar,
  SonarPro,
  SonarDeepResearch,
  // Individual provider types
  Google,
  OpenAI,
  Anthropic,
  Perplexity,
} from './supportedModels.js';

export type { ImageSize, ModelPricing, ProviderPricing, CostCalculator } from './pricing.js';
