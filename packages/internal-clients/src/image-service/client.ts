import { err, ok, type Result } from '@intexuraos/common-core';
import type { ImageGeneratedImageData, ImageThumbnailPrompt } from '@intexuraos/http-contracts';
import { unwrapEnvelope } from '../shared/envelope.js';
import { sendInternalRequest } from '../shared/request.js';
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
  const transport = await sendInternalRequest({
    baseUrl: config.baseUrl,
    path,
    method,
    token: config.internalAuthToken,
    logger: {
      warn: () => undefined,
    },
    ...(body !== undefined ? { jsonBody: body } : {}),
  });

  if (!transport.ok) {
    return err({
      code: 'NETWORK_ERROR',
      message: transport.error.message,
    });
  }

  if (!transport.response.ok) {
    return err({
      code: 'API_ERROR',
      message: `HTTP ${String(transport.response.status)}: ${transport.rawText}`,
    });
  }

  if (method === 'DELETE') {
    return ok(undefined as T);
  }

  const envelope = unwrapEnvelope<T>(transport.body);
  if (!envelope.ok) {
    return err({
      code: 'API_ERROR',
      message: envelope.error.message,
    });
  }

  return ok(envelope.value);
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
