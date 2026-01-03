export type LlmProvider = 'google' | 'openai';
export type ImagePromptModel = 'gpt-4.1' | 'gemini-2.5-pro';

export interface ImagePromptModelConfig {
  provider: LlmProvider;
  modelId: string;
}

export const IMAGE_PROMPT_MODELS: Record<ImagePromptModel, ImagePromptModelConfig> = {
  'gpt-4.1': { provider: 'openai', modelId: 'gpt-4.1' },
  'gemini-2.5-pro': { provider: 'google', modelId: 'gemini-2.5-pro' },
};

export function isValidImagePromptModel(model: string): model is ImagePromptModel {
  return model in IMAGE_PROMPT_MODELS;
}
