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
  LlmChatRole,
  LlmChatTextBlock,
  LlmChatMessage,
  ConversationAssistantDateRange,
  GenerateChatReasoningEffort,
  GenerateChatReasoningOptions,
  LlmResponseFormat,
  GenerateChatOptions,
  GenerateChatResult,
  GenerateChatStreamEvent,
  ImageGenerationResult,
  ImageGenerateOptions,
  LLMCorrelationOptions,
  ResearchOptions,
  SynthesisInput,
  LLMErrorCode,
  LLMError,
  LLMClient,
  OwnerType,
  MatrixCorpusLlmStageV1,
  MatrixCorpusLlmCallContextV1,
  MatrixCorpusProviderCallUsageV1,
} from './types.js';

export { isMatrixCorpusLlmCallContextV1 } from './types.js';

export {
  ALL_LLM_MODELS,
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isFastModel,
  isValidModel,
  isLegacyGoogleModel,
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
  LlmModels,
  LegacyGoogleModels,
  LEGACY_GOOGLE_MODELS,
  LlmProviders,
  EXECUTABLE_LLM_PROVIDERS,
  isDefaultEligibleModel,
  DEFAULT_ELIGIBLE_STATIC_MODELS,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_MODEL_DISPLAY_NAMES,
  ConversationAssistantModels,
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  CONVERSATION_ASSISTANT_MODEL_OPTIONS,
  CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES,
  isConversationAssistantModel,
  getConversationAssistantModelInputTokenBudget,
  getConversationAssistantModelDisplayName,
  IntexAgentModels,
  DEFAULT_INTEX_AGENT_MODEL,
  DEFAULT_PLATFORM_LLM_MODEL,
  ResearchSynthesisModels,
  RESEARCH_SYNTHESIS_MODELS,
  DEFAULT_RESEARCH_SYNTHESIS_MODEL,
  INTEX_AGENT_MODEL_OPTIONS,
  isIntexAgentModel,
  normalizeRetiredOpenRouterModel,
  normalizeLlmModelPreferenceForRead,
  OpenRouterToolCallingModels,
} from './supportedModels.js';

export type {
  LLMModel,
  LegacyGoogleModel,
  ExecutableLlmProvider,
  DirectLlmProvider,
  LlmProvider,
  ImageModel,
  ResearchModel,
  ValidationModel,
  FastModel,
  GenericModel,
  DefaultEligibleModel,
  DefaultEligibleStaticModel,
  DefaultOpenRouterModel,
  ConversationAssistantModel,
  ConversationAssistantModelOption,
  IntexAgentModel,
  OpenRouterDeepSeekV4Flash,
  OpenRouterGemini36Flash,
  OpenRouterGPT54,
  OpenRouterMiniMaxM3,
  OpenRouterClaudeSonnet5,
  OpenRouterGemini35Flash,
  OpenRouterToolCallingModel,
  // Individual executable model types
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

export type { ImageSize, ModelPricing, ProviderPricing } from './pricing.js';

export type {
  ToolCallingMessage,
  ToolDefinition,
  ToolCallingClient,
  ToolCallingResult,
} from './toolCalling.js';

export type { ToolCallingModel } from './supportedModels.js';
export { ALL_TOOL_CALLING_MODELS, isToolCallingModel } from './supportedModels.js';
