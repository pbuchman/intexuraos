import { randomUUID } from 'node:crypto';
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels } from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { ImageGenerationModel } from '../../domain/index.js';
import type {
  GeneratedImageData,
  GenerateOptions,
  ImageGenerationError,
  ImageGenerator,
} from '../../domain/ports/imageGenerator.js';
import type { ImageStorage } from '../../domain/ports/imageStorage.js';

export interface GoogleImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  generateId?: () => string;
}

export class GoogleImageGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly model: ImageGenerationModel;
  private readonly storage: ImageStorage;
  private readonly userId: string;
  private readonly logger: Logger;
  private readonly usageSink: UsageSink;
  private readonly generateId: () => string;

  constructor(config: GoogleImageGeneratorConfig) {
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

    const client = createGeminiClient({
      apiKey: this.apiKey,
      model: LlmModels.Gemini25FlashImage,
      userId: this.userId,
      logger: this.logger,
      usageSink: this.usageSink,
    });

    if (client.generateImage === undefined) {
      return err({ code: 'API_ERROR', message: 'Image generation not supported' });
    }

    const generateResult = await client.generateImage(prompt, {
      ...(options?.slug !== undefined && { slug: options.slug }),
      ...(options?.promptType !== undefined && { promptType: options.promptType }),
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

export function createGoogleImageGenerator(config: GoogleImageGeneratorConfig): ImageGenerator {
  return new GoogleImageGenerator(config);
}
