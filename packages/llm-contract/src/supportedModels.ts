/**
 * Central registry of supported LLM models for research.
 * Single source of truth for model names and their providers.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

interface ModelConfig {
  provider: LlmProvider;
  displayName: string;
}

export const SUPPORTED_MODELS = {
  // Google
  'gemini-2.5-pro': { provider: 'google', displayName: 'Gemini Pro (research)' },
  'gemini-2.5-flash': { provider: 'google', displayName: 'Gemini Flash (quick)' },
  // Anthropic
  'claude-opus-4-5-20251101': { provider: 'anthropic', displayName: 'Claude Opus (research)' },
  'claude-sonnet-4-5-20250929': { provider: 'anthropic', displayName: 'Claude Sonnet (quick)' },
  // OpenAI
  'o4-mini-deep-research': { provider: 'openai', displayName: 'O4 Mini (research)' },
  'gpt-5.2': { provider: 'openai', displayName: 'GPT-5.2 (quick)' },
  // Perplexity
  sonar: { provider: 'perplexity', displayName: 'Perplexity Sonar' },
  'sonar-pro': { provider: 'perplexity', displayName: 'Perplexity Sonar Pro' },
  'sonar-deep-research': { provider: 'perplexity', displayName: 'Perplexity Deep Research' },
} as const satisfies Record<string, ModelConfig>;

export type SupportedModel = keyof typeof SUPPORTED_MODELS;

export const SYSTEM_DEFAULT_MODELS: SupportedModel[] = [
  'gemini-2.5-pro',
  'claude-opus-4-5-20251101',
  'gpt-5.2',
  'sonar-pro',
];

export function getProviderForModel(model: SupportedModel): LlmProvider {
  return SUPPORTED_MODELS[model].provider;
}

export function isValidModel(model: string): model is SupportedModel {
  return model in SUPPORTED_MODELS;
}

export function getModelsForProvider(provider: LlmProvider): SupportedModel[] {
  return (Object.entries(SUPPORTED_MODELS) as [SupportedModel, ModelConfig][])
    .filter(([, config]) => config.provider === provider)
    .map(([model]) => model);
}

export function getDisplayName(model: SupportedModel): string {
  return SUPPORTED_MODELS[model].displayName;
}
