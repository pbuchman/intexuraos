import { err, type Logger, type Result } from '@intexuraos/common-core';
import {
  createOpenRouterClient,
  OPENROUTER_GPT_4_1,
} from '@intexuraos/infra-openrouter';
import type { UsageSink } from '@intexuraos/llm-pricing';
import { generateThumbnailPrompt } from '@intexuraos/llm-prompts';
import type { ThumbnailPrompt } from '../../domain/index.js';
import type {
  PromptGenerationError,
  PromptGenerationOptions,
  PromptGenerator,
} from '../../domain/ports/promptGenerator.js';

export interface OpenRouterPromptAdapterConfig {
  apiKey: string;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  model?: string;
}

const DEFAULT_MODEL = 'gpt-4.1';

export class OpenRouterPromptAdapter implements PromptGenerator {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly usageSink: UsageSink;

  constructor(config: OpenRouterPromptAdapterConfig) {
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.model = config.model ?? DEFAULT_MODEL;
    this.logger = config.logger;
    this.usageSink = config.usageSink;
  }

  async generateThumbnailPrompt(
    text: string,
    options?: PromptGenerationOptions
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    const apiModelId =
      this.model === OPENROUTER_GPT_4_1.publicModelId
        ? OPENROUTER_GPT_4_1.apiModelId
        : this.model.includes('/')
          ? this.model
          : `openai/${this.model}`;
    const client = createOpenRouterClient({
      apiKey: this.apiKey,
      model: apiModelId,
      evidenceModelId: `or:${apiModelId}`,
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

export function mapError(code: string, message: string): PromptGenerationError {
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

export function createOpenRouterPromptAdapter(
  config: OpenRouterPromptAdapterConfig
): PromptGenerator {
  return new OpenRouterPromptAdapter(config);
}

/** Compatibility alias; execution is OpenRouter-only. */
export const GptPromptAdapter = OpenRouterPromptAdapter;
/** Compatibility alias; execution is OpenRouter-only. */
export const createGptPromptAdapter = createOpenRouterPromptAdapter;
/** Compatibility alias; execution is OpenRouter-only. */
export type GptPromptAdapterConfig = OpenRouterPromptAdapterConfig;
