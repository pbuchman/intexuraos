/**
 * LLM Model Types.
 *
 * Single source of truth for model names via TypeScript union types.
 * Models are categorized by their primary use case.
 * All 14 models from migration 012 are defined here.
 */

// =============================================================================
// Individual Provider Types
// =============================================================================

export type Google = 'google';
export type OpenAI = 'openai';
export type Anthropic = 'anthropic';
export type Perplexity = 'perplexity';

/** Union of all LLM providers */
export type LlmProvider = Google | OpenAI | Anthropic | Perplexity;

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
  | SonarDeepResearch;

/**
 * Models for API key validation (cheap, fast).
 */
export type ValidationModel = ClaudeHaiku35 | Gemini20Flash | GPT4oMini | Sonar;

/**
 * Fast models for quick tasks (classification, title generation).
 */
export type FastModel = Gemini25Flash | Gemini20Flash;

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
 * Get provider for a model.
 */
export function getProviderForModel(model: LLMModel): LlmProvider {
  return MODEL_PROVIDER_MAP[model];
}

/**
 * Check if a string is a valid LLM model.
 */
export function isValidModel(model: string): model is LLMModel {
  return ALL_LLM_MODELS.includes(model as LLMModel);
}
