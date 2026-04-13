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
  OwnerType,
} from './types.js';

export {
  ALL_LLM_MODELS,
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isFastModel,
  isValidModel,
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
  LlmModels,
  LlmProviders,
  isDefaultEligibleModel,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_MODEL_DISPLAY_NAMES,
} from './supportedModels.js';

export type {
  LLMModel,
  LlmProvider,
  ImageModel,
  ResearchModel,
  ValidationModel,
  FastModel,
  GenericModel,
  DefaultEligibleModel,
  DefaultOpenRouterModel,
  // Individual model types
  Gemini25Pro,
  Gemini25Flash,
  Gemini20Flash,
  Gemini25FlashImage,
  O4MiniDeepResearch,
  GPT54,
  GPT4oMini,
  GPTImage1,
  ClaudeOpus46,
  ClaudeSonnet46,
  ClaudeHaiku35,
  Sonar,
  SonarPro,
  SonarDeepResearch,
  OpenRouterModelId,
  // Individual provider types
  Google,
  OpenAI,
  Anthropic,
  Perplexity,
  OpenRouter,
} from './supportedModels.js';

export type { ImageSize, ModelPricing, ProviderPricing, CostCalculator } from './pricing.js';

export type {
  ToolCallingMessage,
  ToolDefinition,
  ToolCallingClient,
  ToolCallingResult,
} from './toolCalling.js';

export type { ToolCallingModel } from './supportedModels.js';
export { ALL_TOOL_CALLING_MODELS, isToolCallingModel } from './supportedModels.js';
