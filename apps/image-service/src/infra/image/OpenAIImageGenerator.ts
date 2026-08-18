import { randomUUID } from 'node:crypto';
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { createOpenRouterImageClient } from '@intexuraos/infra-openrouter';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { ImageGenerationModel } from '../../domain/index.js';
import type {
  GeneratedImageData,
  GenerateOptions,
  ImageGenerationError,
  ImageGenerator,
} from '../../domain/ports/imageGenerator.js';
import type { ImageStorage } from '../../domain/ports/imageStorage.js';

export interface OpenRouterImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  generateId?: () => string;
}

export class OpenRouterImageGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly model: ImageGenerationModel;
  private readonly storage: ImageStorage;
  private readonly userId: string;
  private readonly logger: Logger;
  private readonly usageSink: UsageSink;
  private readonly generateId: () => string;

  constructor(config: OpenRouterImageGeneratorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.storage = config.storage;
    this.userId = config.userId;
    this.logger = config.logger;
    this.usageSink = config.usageSink;
    this.generateId = config.generateId ?? ((): string => randomUUID());
  }

  async generate(
    prompt: string,
    options?: GenerateOptions
  ): Promise<Result<GeneratedImageData, ImageGenerationError>> {
    const id = this.generateId();

    const client = createOpenRouterImageClient({
      apiKey: this.apiKey,
      userId: this.userId,
      logger: this.logger,
      usageSink: this.usageSink,
    });

    const generateResult = await client.generateImage(prompt, {
      promptType: options?.promptType ?? 'image-generation',
      ...(options?.correlation !== undefined && { correlation: options.correlation }),
    });

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

export function createOpenRouterImageGenerator(
  config: OpenRouterImageGeneratorConfig
): ImageGenerator {
  return new OpenRouterImageGenerator(config);
}

/** Compatibility alias; execution is OpenRouter-only. */
export const OpenAIImageGenerator = OpenRouterImageGenerator;
/** Compatibility alias; execution is OpenRouter-only. */
export const createOpenAIImageGenerator = createOpenRouterImageGenerator;
/** Compatibility alias; execution is OpenRouter-only. */
export type OpenAIImageGeneratorConfig = OpenRouterImageGeneratorConfig;
