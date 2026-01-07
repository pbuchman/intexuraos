import type { GPTImage1, Gemini25FlashImage, Google, OpenAI } from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export type ImageGenerationModel = GPTImage1 | Gemini25FlashImage;

export interface ImageGenerationModelConfig {
  provider: Google | OpenAI;
  modelId: string;
}

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageGenerationModelConfig> = {
  [LlmModels.GPTImage1]: { provider: LlmProviders.OpenAI, modelId: LlmModels.GPTImage1 },
  [LlmModels.Gemini25FlashImage]: { provider: LlmProviders.Google, modelId: LlmModels.Gemini25FlashImage },
};

export function isValidImageGenerationModel(model: string): model is ImageGenerationModel {
  return model in IMAGE_GENERATION_MODELS;
}
