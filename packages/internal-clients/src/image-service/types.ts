import type { GPTImage1, LLMCorrelationOptions } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  ImageGeneratedImageData as SharedGeneratedImageData,
  ImageThumbnailPrompt as SharedThumbnailPrompt,
} from '@intexuraos/http-contracts';

export interface ImageServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface ImageServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

export type ThumbnailPrompt = SharedThumbnailPrompt;

export type GeneratedImageData = SharedGeneratedImageData;

export type PromptModel = 'gpt-4.1';
export type ImageModel = GPTImage1;

export interface GenerateImageOptions {
  title?: string;
  promptType?: string;
  correlation?: LLMCorrelationOptions;
}

export interface GeneratePromptOptions {
  promptType?: string;
  correlation?: LLMCorrelationOptions;
}

export interface ImageServiceClient {
  generatePrompt(
    text: string,
    model: PromptModel,
    userId: string,
    options?: GeneratePromptOptions
  ): Promise<Result<ThumbnailPrompt, ImageServiceError>>;

  generateImage(
    prompt: string,
    model: ImageModel,
    userId: string,
    options?: GenerateImageOptions
  ): Promise<Result<GeneratedImageData, ImageServiceError>>;

  deleteImage(id: string): Promise<Result<void, ImageServiceError>>;
}
