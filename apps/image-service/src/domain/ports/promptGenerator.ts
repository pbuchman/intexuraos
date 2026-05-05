import type { Result } from '@intexuraos/common-core';
import type { LLMCorrelationOptions } from '@intexuraos/llm-contract';
import type { ThumbnailPrompt } from '../models/index.js';

export interface PromptGenerationError {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'PARSE_ERROR';
  message: string;
}

export interface PromptGenerationOptions {
  promptType?: string;
  correlation?: LLMCorrelationOptions;
}

export interface PromptGenerator {
  generateThumbnailPrompt(
    text: string,
    options?: PromptGenerationOptions
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>>;
}
