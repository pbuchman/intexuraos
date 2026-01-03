export type ImageGenerationModel = 'gpt-image-1' | 'dall-e-3';

export interface ImageGenerationModelConfig {
  provider: 'openai';
  modelId: string;
}

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageGenerationModelConfig> = {
  'gpt-image-1': { provider: 'openai', modelId: 'gpt-image-1' },
  'dall-e-3': { provider: 'openai', modelId: 'dall-e-3' },
};

export function isValidImageGenerationModel(model: string): model is ImageGenerationModel {
  return model in IMAGE_GENERATION_MODELS;
}
