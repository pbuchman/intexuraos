/**
 * Factory functions for creating LLM adapters from API keys.
 */

import { CLAUDE_DEFAULTS } from '@intexuraos/infra-claude';
import { GEMINI_DEFAULTS } from '@intexuraos/infra-gemini';
import { GPT_DEFAULTS } from '@intexuraos/infra-gpt';
import type {
  LlmProvider,
  LlmResearchProvider,
  LlmSynthesisProvider,
  SearchMode,
  TitleGenerator,
} from '../../domain/research/index.js';
import type { DecryptedApiKeys } from '../user/index.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';

export function createLlmProviders(
  keys: DecryptedApiKeys,
  searchMode: SearchMode = 'deep'
): Record<LlmProvider, LlmResearchProvider> {
  const providers: Partial<Record<LlmProvider, LlmResearchProvider>> = {};

  const geminiModel = searchMode === 'quick' ? GEMINI_DEFAULTS.defaultModel : undefined;
  const claudeModel = searchMode === 'quick' ? CLAUDE_DEFAULTS.defaultModel : undefined;
  const gptModel = searchMode === 'quick' ? GPT_DEFAULTS.defaultModel : undefined;

  if (keys.google !== undefined) {
    providers.google = new GeminiAdapter(keys.google, geminiModel);
  }
  if (keys.anthropic !== undefined) {
    providers.anthropic = new ClaudeAdapter(keys.anthropic, claudeModel);
  }
  if (keys.openai !== undefined) {
    providers.openai = new GptAdapter(keys.openai, gptModel);
  }

  return providers as Record<LlmProvider, LlmResearchProvider>;
}

export function createSynthesizer(provider: LlmProvider, apiKey: string): LlmSynthesisProvider {
  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey);
    case 'anthropic':
      return new ClaudeAdapter(apiKey);
    case 'openai':
      return new GptAdapter(apiKey);
  }
}

export function createTitleGenerator(googleApiKey: string): TitleGenerator {
  return new GeminiAdapter(googleApiKey);
}

export function createResearchProvider(
  provider: LlmProvider,
  apiKey: string,
  searchMode: SearchMode = 'deep'
): LlmResearchProvider {
  const useDefaultModel = searchMode === 'quick';

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, useDefaultModel ? GEMINI_DEFAULTS.defaultModel : undefined);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, useDefaultModel ? CLAUDE_DEFAULTS.defaultModel : undefined);
    case 'openai':
      return new GptAdapter(apiKey, useDefaultModel ? GPT_DEFAULTS.defaultModel : undefined);
  }
}
