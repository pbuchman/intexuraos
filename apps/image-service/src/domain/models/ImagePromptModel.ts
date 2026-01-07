import type { Gemini25Pro, Google, OpenAI } from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export type LlmProvider = Google | OpenAI;
export type ImagePromptModel = 'gpt-4.1' | Gemini25Pro;

export interface ImagePromptModelConfig {
  provider: LlmProvider;
  modelId: string;
}

export const IMAGE_PROMPT_MODELS: Record<ImagePromptModel, ImagePromptModelConfig> = {
  'gpt-4.1': { provider: LlmProviders.OpenAI, modelId: 'gpt-4.1' },
  [LlmModels.Gemini25Pro]: { provider: LlmProviders.Google, modelId: LlmModels.Gemini25Pro },
};

export function isValidImagePromptModel(model: string): model is ImagePromptModel {
  return model in IMAGE_PROMPT_MODELS;
}
