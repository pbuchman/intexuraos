import { err, type Logger, type Result } from '@intexuraos/common-core';
import { createGptClient } from '@intexuraos/infra-gpt';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { generateThumbnailPrompt } from '@intexuraos/llm-prompts';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type { PromptGenerationError, PromptGenerator } from '../../domain/ports/promptGenerator.js';

export interface GptPromptAdapterConfig {
  apiKey: string;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  model?: string;
}

const DEFAULT_MODEL = 'gpt-4.1';

export class GptPromptAdapter implements PromptGenerator {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly model: string;
  private readonly pricing: ModelPricing;
  private readonly logger: Logger;

  constructor(config: GptPromptAdapterConfig) {
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.model = config.model ?? DEFAULT_MODEL;
    this.pricing = config.pricing;
    this.logger = config.logger;
  }

  async generateThumbnailPrompt(
    text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const client = createGptClient({
      apiKey: this.apiKey,
      model: this.model,
      userId: this.userId,
      pricing: this.pricing,
      logger: this.logger,
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

export function createGptPromptAdapter(config: GptPromptAdapterConfig): PromptGenerator {
  return new GptPromptAdapter(config);
}
