import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import { createGptClient } from '@intexuraos/infra-gpt';
import type { ModelPricing } from '@intexuraos/llm-contract';
import type { ImageGenerationModel } from '../../domain/index.js';
import type {
  GeneratedImageData,
  GenerateOptions,
  ImageGenerationError,
  ImageGenerator,
} from '../../domain/ports/imageGenerator.js';
import type { ImageStorage } from '../../domain/ports/imageStorage.js';

export interface OpenAIImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  userId: string;
  pricing: ModelPricing;
  imagePricing: ModelPricing;
  generateId?: () => string;
}

export class OpenAIImageGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly model: ImageGenerationModel;
  private readonly storage: ImageStorage;
  private readonly userId: string;
  private readonly pricing: ModelPricing;
  private readonly imagePricing: ModelPricing;
  private readonly generateId: () => string;

  constructor(config: OpenAIImageGeneratorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.storage = config.storage;
    this.userId = config.userId;
    this.pricing = config.pricing;
    this.imagePricing = config.imagePricing;
    this.generateId = config.generateId ?? ((): string => randomUUID());
  }

  async generate(
    prompt: string,
    options?: GenerateOptions
  ): Promise<Result<GeneratedImageData, ImageGenerationError>> {
    const id = this.generateId();

    const client = createGptClient({
      apiKey: this.apiKey,
      model: this.model,
      userId: this.userId,
      pricing: this.pricing,
      imagePricing: this.imagePricing,
    });

    if (client.generateImage === undefined) {
      return err({ code: 'API_ERROR', message: 'Image generation not supported' });
    }

    const generateResult = await client.generateImage(
      prompt,
      options?.slug !== undefined ? { slug: options.slug } : undefined
    );

    if (!generateResult.ok) {
      return err(mapLlmError(generateResult.error.code, generateResult.error.message));
    }

    const uploadResult = await this.storage.upload(id, generateResult.value.imageData, {
      slug: options?.slug,
    });

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
      ...(options?.slug !== undefined && { slug: options.slug }),
    };

    return ok(image);
  }
}

function mapLlmError(code: string, message: string): ImageGenerationError {
  switch (code) {
    case 'INVALID_KEY':
      return { code: 'INVALID_KEY', message };
    case 'RATE_LIMITED':
      return { code: 'RATE_LIMITED', message };
    case 'TIMEOUT':
      return { code: 'TIMEOUT', message };
    default:
      return { code: 'API_ERROR', message };
  }
}

export function createOpenAIImageGenerator(config: OpenAIImageGeneratorConfig): ImageGenerator {
  return new OpenAIImageGenerator(config);
}
