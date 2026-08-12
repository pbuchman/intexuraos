import type { GPTImage1, OpenAI } from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export type ImageGenerationModel = GPTImage1;

export interface ImageGenerationModelConfig {
  provider: OpenAI;
  modelId: string;
}

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageGenerationModelConfig> = {
  [LlmModels.GPTImage1]: { provider: LlmProviders.OpenAI, modelId: LlmModels.GPTImage1 },
};

export function isValidImageGenerationModel(model: string): model is ImageGenerationModel {
  return model in IMAGE_GENERATION_MODELS;
}
