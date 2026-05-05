import { err, type Logger, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { UsageSink } from '@intexuraos/llm-pricing';
import { generateThumbnailPrompt } from '@intexuraos/llm-prompts';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type {
  PromptGenerationError,
  PromptGenerationOptions,
  PromptGenerator,
} from '../../domain/ports/promptGenerator.js';

export interface GeminiPromptAdapterConfig {
  apiKey: string;
  userId: string;
  model: string;
  logger: Logger;
  usageSink: UsageSink;
}

export class GeminiPromptAdapter implements PromptGenerator {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly usageSink: UsageSink;

  constructor(config: GeminiPromptAdapterConfig) {
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.model = config.model;
    this.logger = config.logger;
    this.usageSink = config.usageSink;
  }

  async generateThumbnailPrompt(
    text: string,
    options?: PromptGenerationOptions
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const client = createGeminiClient({
      apiKey: this.apiKey,
      model: this.model,
      userId: this.userId,
      logger: this.logger,
      usageSink: this.usageSink,
    });

    const result = await generateThumbnailPrompt(client, text, options);

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
