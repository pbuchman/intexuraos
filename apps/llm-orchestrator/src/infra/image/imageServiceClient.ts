/**
 * HTTP client for image-service internal API.
 * Provides access to thumbnail prompt generation, image generation, and deletion.
 */

import { LlmModels } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';

export interface ImageServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface ImageServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

export interface ThumbnailPrompt {
  title: string;
  visualSummary: string;
  prompt: string;
  negativePrompt: string;
  parameters: {
    aspectRatio: '16:9';
    framing: string;
    textOnImage: 'none';
    realism: 'photorealistic' | 'cinematic illustration' | 'clean vector';
    people: string;
    logosTrademarks: 'none';
  };
}

export interface GeneratedImageData {
  id: string;
  thumbnailUrl: string;
  fullSizeUrl: string;
}

export type PromptModel = 'gpt-4.1' | LlmModels.Gemini25Pro;
export type ImageModel = LlmModels.GPTImage1 | LlmModels.Gemini25FlashImage;

export interface GenerateImageOptions {
  title?: string;
}

export interface ImageServiceClient {
  generatePrompt(
    text: string,
    model: PromptModel,
    userId: string
  ): Promise<Result<ThumbnailPrompt, ImageServiceError>>;

  generateImage(
    prompt: string,
    model: ImageModel,
    userId: string,
    options?: GenerateImageOptions
  ): Promise<Result<GeneratedImageData, ImageServiceError>>;

  deleteImage(id: string): Promise<Result<void, ImageServiceError>>;
}

export function createImageServiceClient(config: ImageServiceConfig): ImageServiceClient {
  return {
    async generatePrompt(
      text: string,
      model: PromptModel,
      userId: string
    ): Promise<Result<ThumbnailPrompt, ImageServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/images/prompts/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ text, model, userId }),
        });

        if (!response.ok) {
          const body = await response.text();
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}: ${body}`,
          });
        }

        const data = (await response.json()) as { success: boolean; data: ThumbnailPrompt };
        return ok(data.data);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },

    async generateImage(
      prompt: string,
      model: ImageModel,
      userId: string,
      options?: GenerateImageOptions
    ): Promise<Result<GeneratedImageData, ImageServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/images/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ prompt, model, userId, title: options?.title }),
        });

        if (!response.ok) {
          const body = await response.text();
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}: ${body}`,
          });
        }

        const data = (await response.json()) as { success: boolean; data: GeneratedImageData };
        return ok(data.data);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },

    async deleteImage(id: string): Promise<Result<void, ImageServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/images/${id}`, {
          method: 'DELETE',
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}: ${body}`,
          });
        }

        return ok(undefined);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
