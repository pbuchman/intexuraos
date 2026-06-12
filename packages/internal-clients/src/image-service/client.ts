import { err, ok, type Result } from '@intexuraos/common-core';
import type { ImageGeneratedImageData, ImageThumbnailPrompt } from '@intexuraos/http-contracts';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  GeneratedImageData,
  GenerateImageOptions,
  GeneratePromptOptions,
  ImageModel,
  ImageServiceClient,
  ImageServiceConfig,
  ImageServiceError,
  PromptModel,
  ThumbnailPrompt,
} from './types.js';

async function parseImageResponse<T>(
  config: ImageServiceConfig,
  path: string,
  body: unknown,
  method: 'POST' | 'DELETE'
): Promise<Result<T, ImageServiceError>> {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  });

  const result = await httpClient.request<T>({
    path,
    method,
    ...(body !== undefined ? { body } : {}),
  });

  if (method === 'DELETE' && result.ok) {
    return ok(undefined as T);
  }

  if (result.ok) {
    return ok(result.value);
  }

  if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
    return err({
      code: 'NETWORK_ERROR',
      message: result.error.message,
    });
  }

  if (result.error.code === 'API_ERROR') {
    return err({
      code: 'API_ERROR',
      message: `HTTP ${String(result.error.status)}: ${result.error.rawText}`,
    });
  }

  if (method === 'DELETE') {
    return ok(undefined as T);
  }

  return err({
    code: 'API_ERROR',
    message: result.error.message,
  });
}

export function createImageServiceClient(config: ImageServiceConfig): ImageServiceClient {
  return {
    async generatePrompt(
      text: string,
      model: PromptModel,
      userId: string,
      options?: GeneratePromptOptions
    ): Promise<Result<ThumbnailPrompt, ImageServiceError>> {
      return await parseImageResponse<ImageThumbnailPrompt>(
        config,
        '/internal/images/prompts/generate',
        {
          text,
          model,
          userId,
          ...(options?.promptType !== undefined ? { promptType: options.promptType } : {}),
          ...(options?.correlation !== undefined ? { correlation: options.correlation } : {}),
        },
        'POST'
      );
    },

    async generateImage(
      prompt: string,
      model: ImageModel,
      userId: string,
      options?: GenerateImageOptions
    ): Promise<Result<GeneratedImageData, ImageServiceError>> {
      return await parseImageResponse<ImageGeneratedImageData>(
        config,
        '/internal/images/generate',
        {
          prompt,
          model,
          userId,
          ...(options?.title !== undefined ? { title: options.title } : {}),
          ...(options?.promptType !== undefined ? { promptType: options.promptType } : {}),
          ...(options?.correlation !== undefined ? { correlation: options.correlation } : {}),
        },
        'POST'
      );
    },

    async deleteImage(id: string): Promise<Result<void, ImageServiceError>> {
      return await parseImageResponse(config, `/internal/images/${id}`, undefined, 'DELETE');
    },
  };
}
