import type { Result } from '@intexuraos/common-core';
import type { GeneratedImage } from '../models/index.js';

export interface ImageGenerationError {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'STORAGE_ERROR';
  message: string;
}

export interface ImageGenerator {
  generate(prompt: string): Promise<Result<GeneratedImage, ImageGenerationError>>;
}
