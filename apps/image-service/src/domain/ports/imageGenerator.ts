import type { Result } from '@intexuraos/common-core';
import type { GeneratedImage } from '../models/index.js';

export interface ImageGenerationError {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'STORAGE_ERROR';
  message: string;
}

export type GeneratedImageData = Omit<GeneratedImage, 'userId' | 'slug'> & { slug?: string | undefined };

export interface GenerateOptions {
  slug?: string | undefined;
}

export interface ImageGenerator {
  generate(prompt: string, options?: GenerateOptions): Promise<Result<GeneratedImageData, ImageGenerationError>>;
}
