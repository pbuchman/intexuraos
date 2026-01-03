export type ImageGenerationModel = 'gpt-image-1' | 'nano-banana-pro';

export interface ImageGenerationModelConfig {
  provider: 'openai' | 'google';
  modelId: string;
}

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageGenerationModelConfig> = {
  'gpt-image-1': { provider: 'openai', modelId: 'gpt-image-1' },
  'nano-banana-pro': { provider: 'google', modelId: 'imagen-3.0-generate-002' },
};

export function isValidImageGenerationModel(model: string): model is ImageGenerationModel {
  return model in IMAGE_GENERATION_MODELS;
}
