export type ImageGenerationModel = 'gpt-image-1' | 'gemini-2.5-flash-image';

export interface ImageGenerationModelConfig {
  provider: 'openai' | 'google';
  modelId: string;
}

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageGenerationModelConfig> = {
  'gpt-image-1': { provider: 'openai', modelId: 'gpt-image-1' },
  'gemini-2.5-flash-image': { provider: 'google', modelId: 'gemini-2.5-flash-image' },
};

export function isValidImageGenerationModel(model: string): model is ImageGenerationModel {
  return model in IMAGE_GENERATION_MODELS;
}
