import { err, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { generateThumbnailPrompt } from '@intexuraos/llm-contract';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type { PromptGenerationError, PromptGenerator } from '../../domain/ports/promptGenerator.js';

export interface GeminiPromptAdapterConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'gemini-2.5-pro';

export class GeminiPromptAdapter implements PromptGenerator {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: GeminiPromptAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async generateThumbnailPrompt(
    text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const client = createGeminiClient({
      apiKey: this.apiKey,
      model: this.model,
    });

    const result = await generateThumbnailPrompt(client, text);

    if (!result.ok) {
      return err(mapError(result.error.code, result.error.message));
    }

    return { ok: true, value: result.value.thumbnailPrompt } as Result<
      ThumbnailPrompt,
      PromptGenerationError
    >;
  }
}

function mapError(code: string, message: string): PromptGenerationError {
  switch (code) {
    case 'INVALID_KEY':
      return { code: 'INVALID_KEY', message };
    case 'RATE_LIMITED':
      return { code: 'RATE_LIMITED', message };
    case 'TIMEOUT':
      return { code: 'TIMEOUT', message };
    case 'PARSE_ERROR':
      return { code: 'PARSE_ERROR', message };
    default:
      return { code: 'API_ERROR', message };
  }
}

export function createGeminiPromptAdapter(config: GeminiPromptAdapterConfig): PromptGenerator {
  return new GeminiPromptAdapter(config);
}
