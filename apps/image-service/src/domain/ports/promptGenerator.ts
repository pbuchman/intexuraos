import type { Result } from '@intexuraos/common-core';
import type { ThumbnailPrompt } from '../models/index.js';

export interface PromptGenerationError {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'PARSE_ERROR';
  message: string;
}

export interface PromptGenerator {
  generateThumbnailPrompt(text: string): Promise<Result<ThumbnailPrompt, PromptGenerationError>>;
}
