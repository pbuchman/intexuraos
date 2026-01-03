import { ok, type Result } from '@intexuraos/common-core';
import type { GeneratedImage } from '../../domain/index.js';
import type { ImageGenerationError, ImageGenerator } from '../../domain/ports/imageGenerator.js';

export interface FakeImageGeneratorConfig {
  bucketName: string;
  generateId?: () => string;
}

export class FakeImageGenerator implements ImageGenerator {
  private readonly bucketName: string;
  private readonly generateId: () => string;

  constructor(config: FakeImageGeneratorConfig) {
    this.bucketName = config.bucketName;
    this.generateId = config.generateId ?? ((): string => crypto.randomUUID());
  }

  async generate(
    prompt: string,
    model: string
  ): Promise<Result<GeneratedImage, ImageGenerationError>> {
    const id = this.generateId();
    const now = new Date().toISOString();

    const baseUrl = `https://storage.googleapis.com/${this.bucketName}`;
    const thumbnailUrl = `${baseUrl}/${id}/thumbnail.png`;
    const fullSizeUrl = `${baseUrl}/${id}/full.png`;

    const image: GeneratedImage = {
      id,
      prompt,
      thumbnailUrl,
      fullSizeUrl,
      model,
      createdAt: now,
    };

    return await Promise.resolve(ok(image));
  }
}

export function createFakeImageGenerator(config: FakeImageGeneratorConfig): ImageGenerator {
  return new FakeImageGenerator(config);
}
