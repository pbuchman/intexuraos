import type { OpenAI } from '@intexuraos/llm-contract';
import { LlmProviders } from '@intexuraos/llm-contract';

export type LlmProvider = OpenAI;
export type ImagePromptModel = 'gpt-4.1';

export interface ImagePromptModelConfig {
  provider: LlmProvider;
  modelId: string;
}

export const IMAGE_PROMPT_MODELS: Record<ImagePromptModel, ImagePromptModelConfig> = {
  'gpt-4.1': { provider: LlmProviders.OpenAI, modelId: 'gpt-4.1' },
};

export function isValidImagePromptModel(model: string): model is ImagePromptModel {
  return model in IMAGE_PROMPT_MODELS;
}
