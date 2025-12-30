/**
 * Factory functions for creating LLM adapters from API keys.
 */

import type {
  LlmProvider,
  LlmResearchProvider,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';

export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
}

export function createLlmProviders(
  keys: DecryptedApiKeys
): Record<LlmProvider, LlmResearchProvider> {
  const providers: Partial<Record<LlmProvider, LlmResearchProvider>> = {};

  if (keys.google !== undefined) {
    providers.google = new GeminiAdapter(keys.google);
  }
  if (keys.anthropic !== undefined) {
    providers.anthropic = new ClaudeAdapter(keys.anthropic);
  }
  if (keys.openai !== undefined) {
    providers.openai = new GptAdapter(keys.openai);
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
