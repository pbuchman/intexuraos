/**
 * LLM Model Types.
 *
 * Single source of truth for model names via TypeScript union types.
 * Models are categorized by their primary use case.
 * OpenRouter IDs are the only executable model identifiers. Direct-provider
 * model unions remain available for persisted history and rollback-only code.
 * Retired direct-Google identifiers are isolated in the legacy-read contract.
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

/** Direct providers retained for historical data and rollback-only adapters. */
export type DirectLlmProvider = OpenAI | Anthropic | Perplexity;

/** Providers that can execute new LLM requests. */
export type ExecutableLlmProvider = OpenRouter;

// =============================================================================
// Legacy Model Types - Direct Google (read/migration only)
// =============================================================================

export const LegacyGoogleModels = {
  Gemini25Pro: 'gemini-2.5-pro',
  Gemini25Flash: 'gemini-2.5-flash',
  Gemini20Flash: 'gemini-2.0-flash',
  Gemini25FlashImage: 'gemini-2.5-flash-image',
} as const;

export type LegacyGoogleModel = (typeof LegacyGoogleModels)[keyof typeof LegacyGoogleModels];

export const LEGACY_GOOGLE_MODELS: readonly LegacyGoogleModel[] = Object.values(LegacyGoogleModels);

const LEGACY_GOOGLE_MODEL_IDS: ReadonlySet<string> = new Set(LEGACY_GOOGLE_MODELS);

/** Recognize retired direct-Google IDs in persisted historical data. */
export function isLegacyGoogleModel(model: string): model is LegacyGoogleModel {
  return LEGACY_GOOGLE_MODEL_IDS.has(model);
}

// =============================================================================
// Individual Model Types - OpenAI
// =============================================================================

export type O4MiniDeepResearch = 'o4-mini-deep-research';
export type GPT54 = 'gpt-5.4';
export type GPT4oMini = 'gpt-4o-mini';
export type GPTImage1 = 'gpt-image-1';

// =============================================================================
// Individual Model Types - Anthropic
// =============================================================================

export type ClaudeOpus46 = 'claude-opus-4-6';
export type ClaudeSonnet46 = 'claude-sonnet-4-6';
export type ClaudeSonnet47 = 'claude-sonnet-4-7';
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
export type ImageModel = GPTImage1;

/**
 * Models for research tasks (web search, deep analysis).
 */
export type ResearchModel =
  | ClaudeOpus46
  | ClaudeSonnet46
  | ClaudeSonnet47
  | O4MiniDeepResearch
  | GPT54
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
export type ValidationModel = ClaudeHaiku35 | GPT4oMini | Sonar;

/**
 * Fast models for quick tasks (classification, title generation).
 */
export type FastModel = ClaudeHaiku35 | GPT4oMini;

/**
 * General-purpose models.
 */
export type GenericModel = GPT54;

/**
 * Union of all LLM model names.
 * This is the exhaustive list of all supported models.
 */
export type LLMModel =
  // OpenAI (4 models)
  | O4MiniDeepResearch
  | GPT54
  | GPT4oMini
  | GPTImage1
  // Anthropic (4 models)
  | ClaudeOpus46
  | ClaudeSonnet46
  | ClaudeSonnet47
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

/** Runtime allowlist for provider-selection and key-validation endpoints. */
export const EXECUTABLE_LLM_PROVIDERS: readonly ExecutableLlmProvider[] = [
  LlmProviders.OpenRouter,
] as const;

// =============================================================================
// Model Constants Object
// =============================================================================

/**
 * Typed constants for historical direct-provider LLM model IDs.
 * They are not accepted by executable factories or preference writes.
 */
export const LlmModels = {
  // OpenAI
  O4MiniDeepResearch: 'o4-mini-deep-research' as O4MiniDeepResearch,
  GPT54: 'gpt-5.4' as GPT54,
  GPT4oMini: 'gpt-4o-mini' as GPT4oMini,
  GPTImage1: 'gpt-image-1' as GPTImage1,
  // Anthropic
  ClaudeOpus46: 'claude-opus-4-6' as ClaudeOpus46,
  ClaudeSonnet46: 'claude-sonnet-4-6' as ClaudeSonnet46,
  ClaudeSonnet47: 'claude-sonnet-4-7' as ClaudeSonnet47,
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
  // OpenAI
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT54,
  LlmModels.GPT4oMini,
  LlmModels.GPTImage1,
  // Anthropic
  LlmModels.ClaudeOpus46,
  LlmModels.ClaudeSonnet46,
  LlmModels.ClaudeSonnet47,
  LlmModels.ClaudeHaiku35,
  // Perplexity
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
] as const;

/**
 * Array of all fast models for runtime validation.
 */
export const ALL_FAST_MODELS: FastModel[] = [LlmModels.ClaudeHaiku35, LlmModels.GPT4oMini] as const;

// =============================================================================
// Provider Mapping
// =============================================================================

/**
 * Map from model to provider.
 */
export const MODEL_PROVIDER_MAP: Record<LLMModel, DirectLlmProvider> = {
  // OpenAI
  [LlmModels.O4MiniDeepResearch]: LlmProviders.OpenAI,
  [LlmModels.GPT54]: LlmProviders.OpenAI,
  [LlmModels.GPT4oMini]: LlmProviders.OpenAI,
  [LlmModels.GPTImage1]: LlmProviders.OpenAI,
  // Anthropic
  [LlmModels.ClaudeOpus46]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet46]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet47]: LlmProviders.Anthropic,
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
  [LlmModels.ClaudeHaiku35]: 'Claude 3.5 Haiku',
  [LlmModels.GPT4oMini]: 'GPT-4o Mini',
};

// =============================================================================
// Default-Eligible Models (for user's default model preference)
// =============================================================================

export interface DefaultOpenRouterModel {
  /** Raw OpenRouter model ID (without 'or:' prefix) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider name for UI grouping */
  provider: string;
}

export const DEFAULT_OPENROUTER_MODELS: readonly DefaultOpenRouterModel[] = [
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT (Free)', provider: 'Google' },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT', provider: 'Google' },
  { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Google' },
  { id: 'minimax/minimax-m3', name: 'MiniMax M3', provider: 'MiniMax' },
  { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'Qwen' },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    provider: 'NVIDIA',
  },
] as const;

const DEFAULT_OPENROUTER_MODEL_IDS: ReadonlySet<string> = new Set(
  DEFAULT_OPENROUTER_MODELS.map((m) => `or:${m.id}`)
);

/**
 * A model that can be selected as the user's default LLM model.
 * Includes all FastModel values plus curated OpenRouter models (with 'or:' prefix).
 *
 * Note: The type includes all OpenRouterModelId values for type ergonomics,
 * but runtime validation via `isDefaultEligibleModel()` only accepts the
 * curated models in `DEFAULT_OPENROUTER_MODELS`. Always validate at runtime.
 */
export type DefaultEligibleStaticModel = never;
export type DefaultEligibleModel = OpenRouterModelId;

export const DEFAULT_ELIGIBLE_STATIC_MODELS: readonly DefaultEligibleStaticModel[] = [];

export function isDefaultEligibleModel(model: string): model is DefaultEligibleModel {
  return DEFAULT_OPENROUTER_MODEL_IDS.has(model);
}

export const DEFAULT_MODEL_DISPLAY_NAMES: Record<string, string> = {
  ...Object.fromEntries(DEFAULT_OPENROUTER_MODELS.map((m) => [`or:${m.id}`, m.name])),
};

// =============================================================================
// Conversation Assistant Models
// =============================================================================

export type OpenRouterMiniMaxM3 = 'or:minimax/minimax-m3' & OpenRouterModelId;
export type OpenRouterClaudeSonnet5 = 'or:anthropic/claude-sonnet-5' & OpenRouterModelId;
export type OpenRouterGemini35Flash = 'or:google/gemini-3.5-flash' & OpenRouterModelId;
export type OpenRouterDeepSeekV4Flash = 'or:deepseek/deepseek-v4-flash' & OpenRouterModelId;
export type OpenRouterGemini36Flash = 'or:google/gemini-3.6-flash' & OpenRouterModelId;

export type ConversationAssistantModel =
  | OpenRouterMiniMaxM3
  | OpenRouterClaudeSonnet5
  | OpenRouterGemini35Flash;

export interface ConversationAssistantModelOption {
  id: ConversationAssistantModel;
  label: string;
  provider: string;
  supportsReasoning: boolean;
}

export const ConversationAssistantModels = {
  MiniMaxM3: createOpenRouterModelId('minimax/minimax-m3') as OpenRouterMiniMaxM3,
  ClaudeSonnet5: createOpenRouterModelId('anthropic/claude-sonnet-5') as OpenRouterClaudeSonnet5,
  Gemini35FlashThinking: createOpenRouterModelId(
    'google/gemini-3.5-flash'
  ) as OpenRouterGemini35Flash,
} as const;

export const DEFAULT_CONVERSATION_ASSISTANT_MODEL = ConversationAssistantModels.MiniMaxM3;

export const CONVERSATION_ASSISTANT_MODEL_OPTIONS: readonly ConversationAssistantModelOption[] = [
  {
    id: ConversationAssistantModels.MiniMaxM3,
    label: 'MiniMax M3',
    provider: 'MiniMax',
    supportsReasoning: true,
  },
  {
    id: ConversationAssistantModels.ClaudeSonnet5,
    label: 'Claude Sonnet 5',
    provider: 'Anthropic',
    supportsReasoning: true,
  },
  {
    id: ConversationAssistantModels.Gemini35FlashThinking,
    label: 'Gemini 3.5 Flash Thinking',
    provider: 'Google',
    supportsReasoning: true,
  },
] as const;

const CONVERSATION_ASSISTANT_MODEL_IDS: ReadonlySet<string> = new Set(
  CONVERSATION_ASSISTANT_MODEL_OPTIONS.map((option) => option.id)
);

export const CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> =
  Object.fromEntries(
    CONVERSATION_ASSISTANT_MODEL_OPTIONS.map((option) => [option.id, option.label])
  );

export function isConversationAssistantModel(model: string): model is ConversationAssistantModel {
  return CONVERSATION_ASSISTANT_MODEL_IDS.has(model);
}

export function getConversationAssistantModelDisplayName(model: string): string {
  return isConversationAssistantModel(model)
    ? (CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES[model] ?? model)
    : model;
}

// =============================================================================
// Intex Agent Models
// =============================================================================

export type IntexAgentModel =
  | OpenRouterDeepSeekV4Flash
  | OpenRouterMiniMaxM3
  | OpenRouterGemini36Flash;

export const IntexAgentModels = {
  DeepSeekV4Flash: createOpenRouterModelId(
    'deepseek/deepseek-v4-flash'
  ) as OpenRouterDeepSeekV4Flash,
  MiniMaxM3: createOpenRouterModelId('minimax/minimax-m3') as OpenRouterMiniMaxM3,
  Gemini36Flash: createOpenRouterModelId('google/gemini-3.6-flash') as OpenRouterGemini36Flash,
} as const;

export const DEFAULT_INTEX_AGENT_MODEL = IntexAgentModels.DeepSeekV4Flash;

/**
 * Canonical model for platform-owned LLM calls and fallbacks.
 *
 * Keeping this separate from feature-specific defaults makes the routing
 * contract explicit: platform traffic always uses an `or:` OpenRouter model.
 */
export const DEFAULT_PLATFORM_LLM_MODEL = IntexAgentModels.MiniMaxM3;

export type OpenRouterGPT54 = 'or:openai/gpt-5.4' & OpenRouterModelId;

/** OpenRouter models explicitly allowed for new Research synthesis calls. */
export const ResearchSynthesisModels = {
  MiniMaxM3: DEFAULT_PLATFORM_LLM_MODEL,
  GPT54: createOpenRouterModelId('openai/gpt-5.4') as OpenRouterGPT54,
} as const;

export const RESEARCH_SYNTHESIS_MODELS: readonly ResearchModel[] = [
  ResearchSynthesisModels.MiniMaxM3,
  ResearchSynthesisModels.GPT54,
] as const;

export const DEFAULT_RESEARCH_SYNTHESIS_MODEL: ResearchModel = DEFAULT_PLATFORM_LLM_MODEL;

export const INTEX_AGENT_MODEL_OPTIONS = [
  { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash', provider: 'DeepSeek' },
  { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3', provider: 'MiniMax' },
  {
    id: IntexAgentModels.Gemini36Flash,
    label: 'Gemini 3.6 Flash',
    provider: 'Google',
  },
] as const;

const INTEX_AGENT_MODEL_IDS: ReadonlySet<string> = new Set(Object.values(IntexAgentModels));

export function isIntexAgentModel(value: unknown): value is IntexAgentModel {
  return typeof value === 'string' && INTEX_AGENT_MODEL_IDS.has(value);
}

const RETIRED_GEMINI_3_FLASH_PREVIEW_MODEL = 'or:google/gemini-3-flash-preview';

/**
 * Translate the retired Gemini preview identifier at read boundaries.
 * This keeps rolling deployments safe while migration 130 rewrites persisted settings.
 */
export function normalizeRetiredOpenRouterModel(model: string): string {
  return model === RETIRED_GEMINI_3_FLASH_PREVIEW_MODEL ? IntexAgentModels.Gemini36Flash : model;
}

/**
 * Normalize a persisted executable preference at read boundaries only.
 *
 * Research history must not use this helper. Unknown, direct-provider, and
 * retired preferences fall back to the active platform model without writeback.
 */
export function normalizeLlmModelPreferenceForRead(model: string): DefaultEligibleModel {
  const normalizedModel = normalizeRetiredOpenRouterModel(model);
  return isDefaultEligibleModel(normalizedModel) ? normalizedModel : DEFAULT_PLATFORM_LLM_MODEL;
}

/**
 * Get provider for a model.
 */
export function getProviderForModel(model: LegacyGoogleModel): Google;
export function getProviderForModel(model: LLMModel): DirectLlmProvider;
export function getProviderForModel(model: OpenRouterModelId): ExecutableLlmProvider;
export function getProviderForModel(model: string): LlmProvider;
export function getProviderForModel(model: string): LlmProvider {
  if (isOpenRouterModel(model)) {
    return LlmProviders.OpenRouter;
  }
  if (isLegacyGoogleModel(model)) {
    return LlmProviders.Google;
  }

  const provider = (MODEL_PROVIDER_MAP as Partial<Record<string, DirectLlmProvider>>)[model];
  if (provider === undefined) {
    throw new Error(`Unknown LLM model: ${model}`);
  }
  return provider;
}

/**
 * Check if a string is an OpenRouter model ID (prefixed with 'or:').
 */
export function isOpenRouterModel(model: string): model is OpenRouterModelId {
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
 * Narrowed subset for tool calling agent loops.
 *
 * Tool calling is OpenRouter-only. Google-hosted models use an `or:google/...`
 * identifier and never a retired raw `gemini-*` identifier.
 */
export type OpenRouterToolCallingModel = IntexAgentModel;

export const OpenRouterToolCallingModels = {
  DeepSeekV4Flash: IntexAgentModels.DeepSeekV4Flash,
  MiniMaxM3: IntexAgentModels.MiniMaxM3,
  Gemini36Flash: IntexAgentModels.Gemini36Flash,
} as const;

export type ToolCallingModel = OpenRouterToolCallingModel;

/** All models that support tool calling */
export const ALL_TOOL_CALLING_MODELS: readonly ToolCallingModel[] = [
  OpenRouterToolCallingModels.DeepSeekV4Flash,
  OpenRouterToolCallingModels.MiniMaxM3,
  OpenRouterToolCallingModels.Gemini36Flash,
];

const TOOL_CALLING_MODEL_IDS: ReadonlySet<string> = new Set(ALL_TOOL_CALLING_MODELS);

/**
 * Check if a string is a valid tool calling model.
 */
export function isToolCallingModel(model: string): model is ToolCallingModel {
  return TOOL_CALLING_MODEL_IDS.has(model);
}
