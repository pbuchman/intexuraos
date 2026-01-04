import { randomUUID } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- Image generation API not available in infra-gpt
import OpenAI from 'openai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { ImageGenerationModel } from '../../domain/index.js';
import type {
  GeneratedImageData,
  ImageGenerationError,
  ImageGenerator,
} from '../../domain/ports/imageGenerator.js';
import type { ImageStorage } from '../../domain/ports/imageStorage.js';

export interface OpenAIImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  generateId?: () => string;
}

export class OpenAIImageGenerator implements ImageGenerator {
  private readonly client: OpenAI;
  private readonly model: ImageGenerationModel;
  private readonly storage: ImageStorage;
  private readonly generateId: () => string;

  constructor(config: OpenAIImageGeneratorConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.storage = config.storage;
    this.generateId = config.generateId ?? ((): string => randomUUID());
  }

  async generate(prompt: string): Promise<Result<GeneratedImageData, ImageGenerationError>> {
    const id = this.generateId();

    try {
      const response = await this.client.images.generate({
        model: this.model,
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      } as Parameters<typeof this.client.images.generate>[0]);

      const imageData = response.data?.[0];
      if (imageData === undefined) {
        return err({ code: 'API_ERROR', message: 'No image data in response' });
      }

      let imageBuffer: Buffer;

      if (imageData.b64_json !== undefined) {
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      } else if (imageData.url !== undefined) {
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) {
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch image: ${String(imageResponse.status)}`,
          });
        }
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else {
        return err({ code: 'API_ERROR', message: 'No image URL or b64_json in response' });
      }

      const uploadResult = await this.storage.upload(id, imageBuffer);
      if (!uploadResult.ok) {
        return err({ code: 'STORAGE_ERROR', message: uploadResult.error.message });
      }

      const image: GeneratedImageData = {
        id,
        prompt,
        thumbnailUrl: uploadResult.value.thumbnailUrl,
        fullSizeUrl: uploadResult.value.fullSizeUrl,
        model: this.model,
        createdAt: new Date().toISOString(),
      };

      return ok(image);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(mapOpenAIError(message));
    }
  }
}

function mapOpenAIError(message: string): ImageGenerationError {
  const messageLower = message.toLowerCase();
  if (messageLower.includes('api key') || messageLower.includes('incorrect api key')) {
    return { code: 'INVALID_KEY', message };
  }
  if (
    message.includes('429') ||
    messageLower.includes('rate limit') ||
    messageLower.includes('rate_limit')
  ) {
    return { code: 'RATE_LIMITED', message };
  }
  if (
    messageLower.includes('timeout') ||
    messageLower.includes('etimedout') ||
    messageLower.includes('timed out')
  ) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

export function createOpenAIImageGenerator(config: OpenAIImageGeneratorConfig): ImageGenerator {
  return new OpenAIImageGenerator(config);
}
