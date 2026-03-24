/**
 * LLM Model Types.
 *
 * Single source of truth for model names via TypeScript union types.
 * Models are categorized by their primary use case.
 * All 14 models from migrations 012+ are defined here.
 */

// =============================================================================
// Individual Provider Types
// =============================================================================

export type Google = 'google';
export type OpenAI = 'openai';
export type Anthropic = 'anthropic';
export type Perplexity = 'perplexity';
export type OpenRouter = 'openrouter';

/** Union of all LLM providers */
export type LlmProvider = Google | OpenAI | Anthropic | Perplexity | OpenRouter;

// =============================================================================
// Individual Model Types - Google
// =============================================================================

export type Gemini25Pro = 'gemini-2.5-pro';
export type Gemini25Flash = 'gemini-2.5-flash';
export type Gemini20Flash = 'gemini-2.0-flash';
export type Gemini25FlashImage = 'gemini-2.5-flash-image';

// =============================================================================
// Individual Model Types - OpenAI
// =============================================================================

export type O4MiniDeepResearch = 'o4-mini-deep-research';
export type GPT52 = 'gpt-5.2';
export type GPT4oMini = 'gpt-4o-mini';
export type GPTImage1 = 'gpt-image-1';

// =============================================================================
// Individual Model Types - Anthropic
// =============================================================================

export type ClaudeOpus45 = 'claude-opus-4-5-20251101';
export type ClaudeSonnet45 = 'claude-sonnet-4-5-20250929';
export type ClaudeHaiku35 = 'claude-3-5-haiku-20241022';

// =============================================================================
// Individual Model Types - Perplexity
// =============================================================================

export type Sonar = 'sonar';
export type SonarPro = 'sonar-pro';
export type SonarDeepResearch = 'sonar-deep-research';

// =============================================================================
// Model Category Types (composed from individual types)
// =============================================================================

/**
 * Models for image generation.
 */
export type ImageModel = GPTImage1 | Gemini25FlashImage;

/**
 * Models for research tasks (web search, deep analysis).
 */
export type ResearchModel =
  | Gemini25Pro
  | Gemini25Flash
  | ClaudeOpus45
  | ClaudeSonnet45
  | O4MiniDeepResearch
  | GPT52
  | Sonar
  | SonarPro
  | SonarDeepResearch
  | OpenRouterModelId;

/**
 * OpenRouter model ID with or: prefix.
 * This is a branded string type to distinguish OpenRouter models from static LLMModel IDs.
 */
export type OpenRouterModelId = string & { readonly __brand: 'OpenRouterModelId' };

/**
 * Models for API key validation (cheap, fast).
 */
export type ValidationModel = ClaudeHaiku35 | Gemini20Flash | GPT4oMini | Sonar;

/**
 * Fast models for quick tasks (classification, title generation).
 */
export type FastModel = Gemini25Flash | Gemini20Flash | ClaudeHaiku35 | GPT4oMini;

/**
 * General-purpose models.
 */
export type GenericModel = Gemini25Pro | GPT52;

/**
 * Union of all LLM model names.
 * This is the exhaustive list of all supported models.
 */
export type LLMModel =
  // Google (4 models)
  | Gemini25Pro
  | Gemini25Flash
  | Gemini20Flash
  | Gemini25FlashImage
  // OpenAI (4 models)
  | O4MiniDeepResearch
  | GPT52
  | GPT4oMini
  | GPTImage1
  // Anthropic (3 models)
  | ClaudeOpus45
  | ClaudeSonnet45
  | ClaudeHaiku35
  // Perplexity (3 models)
  | Sonar
  | SonarPro
  | SonarDeepResearch;

// =============================================================================
// Provider Constants Object
// =============================================================================

/**
 * Typed constants for LLM providers.
 * Use these instead of string literals: LlmProviders.Google instead of 'google'
 */
export const LlmProviders = {
  Google: 'google' as Google,
  OpenAI: 'openai' as OpenAI,
  Anthropic: 'anthropic' as Anthropic,
  Perplexity: 'perplexity' as Perplexity,
  OpenRouter: 'openrouter' as OpenRouter,
} as const;

// =============================================================================
// Model Constants Object
// =============================================================================

/**
 * Typed constants for LLM models.
 * Use these instead of string literals: LlmModels.Gemini25Pro instead of 'gemini-2.5-pro'
 */
export const LlmModels = {
  // Google
  Gemini25Pro: 'gemini-2.5-pro' as Gemini25Pro,
  Gemini25Flash: 'gemini-2.5-flash' as Gemini25Flash,
  Gemini20Flash: 'gemini-2.0-flash' as Gemini20Flash,
  Gemini25FlashImage: 'gemini-2.5-flash-image' as Gemini25FlashImage,
  // OpenAI
  O4MiniDeepResearch: 'o4-mini-deep-research' as O4MiniDeepResearch,
  GPT52: 'gpt-5.2' as GPT52,
  GPT4oMini: 'gpt-4o-mini' as GPT4oMini,
  GPTImage1: 'gpt-image-1' as GPTImage1,
  // Anthropic
  ClaudeOpus45: 'claude-opus-4-5-20251101' as ClaudeOpus45,
  ClaudeSonnet45: 'claude-sonnet-4-5-20250929' as ClaudeSonnet45,
  ClaudeHaiku35: 'claude-3-5-haiku-20241022' as ClaudeHaiku35,
  // Perplexity
  Sonar: 'sonar' as Sonar,
  SonarPro: 'sonar-pro' as SonarPro,
  SonarDeepResearch: 'sonar-deep-research' as SonarDeepResearch,
} as const;

// =============================================================================
// Runtime Model List (for validation)
// =============================================================================

/**
 * Array of all LLM models for runtime validation.
 * Must be kept in sync with LLMModel type - TypeScript will error if not.
 */
export const ALL_LLM_MODELS: LLMModel[] = [
  // Google
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.Gemini20Flash,
  LlmModels.Gemini25FlashImage,
  // OpenAI
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.GPT4oMini,
  LlmModels.GPTImage1,
  // Anthropic
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.ClaudeHaiku35,
  // Perplexity
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
] as const;

/**
 * Array of all fast models for runtime validation.
 */
export const ALL_FAST_MODELS: FastModel[] = [
  LlmModels.Gemini25Flash,
  LlmModels.Gemini20Flash,
  LlmModels.ClaudeHaiku35,
  LlmModels.GPT4oMini,
] as const;

// =============================================================================
// Provider Mapping
// =============================================================================

/**
 * Map from model to provider.
 */
export const MODEL_PROVIDER_MAP: Record<LLMModel, LlmProvider> = {
  // Google
  [LlmModels.Gemini25Pro]: LlmProviders.Google,
  [LlmModels.Gemini25Flash]: LlmProviders.Google,
  [LlmModels.Gemini20Flash]: LlmProviders.Google,
  [LlmModels.Gemini25FlashImage]: LlmProviders.Google,
  // OpenAI
  [LlmModels.O4MiniDeepResearch]: LlmProviders.OpenAI,
  [LlmModels.GPT52]: LlmProviders.OpenAI,
  [LlmModels.GPT4oMini]: LlmProviders.OpenAI,
  [LlmModels.GPTImage1]: LlmProviders.OpenAI,
  // Anthropic
  [LlmModels.ClaudeOpus45]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet45]: LlmProviders.Anthropic,
  [LlmModels.ClaudeHaiku35]: LlmProviders.Anthropic,
  // Perplexity
  [LlmModels.Sonar]: LlmProviders.Perplexity,
  [LlmModels.SonarPro]: LlmProviders.Perplexity,
  [LlmModels.SonarDeepResearch]: LlmProviders.Perplexity,
} as const;

/**
 * Human-readable display names for fast models.
 */
export const FAST_MODEL_DISPLAY_NAMES: Record<FastModel, string> = {
  [LlmModels.Gemini25Flash]: 'Gemini 2.5 Flash',
  [LlmModels.Gemini20Flash]: 'Gemini 2.0 Flash',
  [LlmModels.ClaudeHaiku35]: 'Claude 3.5 Haiku',
  [LlmModels.GPT4oMini]: 'GPT-4o Mini',
};

/**
 * Get provider for a model.
 */
export function getProviderForModel(model: ResearchModel): LlmProvider {
  if (isOpenRouterModel(model)) {
    return LlmProviders.OpenRouter;
  }
  // After the OpenRouter guard, model is a static LLMModel
  return MODEL_PROVIDER_MAP[model as LLMModel];
}

/**
 * Check if a string is an OpenRouter model ID (prefixed with 'or:').
 */
export function isOpenRouterModel(model: string): model is `${string}` & { __brand: 'OpenRouterModelId' } {
  return model.startsWith('or:');
}

/**
 * Create an OpenRouter model ID by adding the 'or:' prefix.
 */
export function createOpenRouterModelId(rawModelId: string): OpenRouterModelId {
  return `or:${rawModelId}` as OpenRouterModelId;
}

/**
 * Strip the 'or:' prefix from an OpenRouter model ID.
 * Returns the original string for non-OpenRouter models.
 */
export function getOpenRouterRawId(model: string): string {
  if (isOpenRouterModel(model)) {
    return model.slice(3);
  }
  return model;
}

/**
 * Check if a string is a valid LLM model.
 */
export function isValidModel(model: string): model is LLMModel {
  return ALL_LLM_MODELS.includes(model as LLMModel);
}

/**
 * Check if a string is a valid fast model.
 */
export function isFastModel(model: string): model is FastModel {
  return ALL_FAST_MODELS.includes(model as FastModel);
}

// =============================================================================
// Tool Calling Models
// =============================================================================

/**
 * Narrowed subset of LLMModel for tool calling agent loops.
 *
 * Every ToolCallingModel is also a valid LLMModel, so
 * getProviderForModel() works out of the box.
 */
export type ToolCallingModel = Gemini25Flash;

/** All models that support tool calling */
export const ALL_TOOL_CALLING_MODELS: ToolCallingModel[] = ['gemini-2.5-flash'];

/**
 * Check if a string is a valid tool calling model.
 */
export function isToolCallingModel(model: string): model is ToolCallingModel {
  return ALL_TOOL_CALLING_MODELS.includes(model as ToolCallingModel);
}
