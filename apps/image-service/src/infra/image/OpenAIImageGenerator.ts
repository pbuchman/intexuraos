// eslint-disable-next-line no-restricted-imports -- Image generation API not available in infra-gpt
import OpenAI from 'openai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { GeneratedImage, ImageGenerationModel } from '../../domain/index.js';
import type { ImageGenerationError, ImageGenerator } from '../../domain/ports/imageGenerator.js';
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
    this.generateId = config.generateId ?? ((): string => crypto.randomUUID());
  }

  async generate(prompt: string): Promise<Result<GeneratedImage, ImageGenerationError>> {
    const id = this.generateId();

    try {
      const response = await this.client.images.generate({
        model: this.model,
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      });

      const b64Data = response.data?.[0]?.b64_json;
      if (b64Data === undefined) {
        return err({ code: 'API_ERROR', message: 'No image data in response' });
      }

      const imageBuffer = Buffer.from(b64Data, 'base64');

      const uploadResult = await this.storage.upload(id, imageBuffer);
      if (!uploadResult.ok) {
        return err({ code: 'STORAGE_ERROR', message: uploadResult.error.message });
      }

      const image: GeneratedImage = {
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
