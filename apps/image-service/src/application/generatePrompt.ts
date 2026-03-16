import { ok, err, type Result, type Logger } from '@intexuraos/common-core';
import type { Google, OpenAI } from '@intexuraos/llm-contract';
import type { ThumbnailPrompt, PromptGenerator, ImagePromptModelConfig } from '../domain/index.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

export interface GeneratePromptInput {
  text: string;
  model: string;
  userId: string;
}

export type GeneratePromptError =
  | { code: 'API_KEYS_UNAVAILABLE'; message: string }
  | { code: 'MISSING_API_KEY'; message: string; provider: string }
  | { code: 'RATE_LIMITED'; message: string }
  | { code: 'GENERATION_FAILED'; message: string };

export type GeneratePromptUseCase = (
  input: GeneratePromptInput
) => Promise<Result<ThumbnailPrompt, GeneratePromptError>>;

export interface GeneratePromptDeps {
  userServiceClient: UserServiceClient;
  createPromptGenerator: (
    provider: Google | OpenAI,
    apiKey: string,
    userId: string,
    logger: Logger
  ) => PromptGenerator;
  logger: Logger;
}

export function createGeneratePromptUseCase(
  deps: GeneratePromptDeps,
  modelConfig: ImagePromptModelConfig
): GeneratePromptUseCase {
  return async (input: GeneratePromptInput) => {
    deps.logger.info(
      { userId: input.userId, provider: modelConfig.provider },
      'Fetching API keys from user-service'
    );
    const keysResult = await deps.userServiceClient.getApiKeys(input.userId);
    if (!keysResult.ok) {
      deps.logger.error(
        { userId: input.userId, error: keysResult.error },
        'Failed to retrieve API keys from user-service'
      );
      return err({ code: 'API_KEYS_UNAVAILABLE', message: 'Failed to retrieve API keys' });
    }

    const apiKey = keysResult.value[modelConfig.provider];
    if (apiKey === undefined) {
      deps.logger.warn(
        { userId: input.userId, provider: modelConfig.provider },
        'User missing required API key'
      );
      return err({
        code: 'MISSING_API_KEY',
        message: `No ${modelConfig.provider} API key configured for this user`,
        provider: modelConfig.provider,
      });
    }

    deps.logger.info({ model: input.model, provider: modelConfig.provider }, 'Starting prompt generation');
    const generator = deps.createPromptGenerator(modelConfig.provider, apiKey, input.userId, deps.logger);
    const result = await generator.generateThumbnailPrompt(input.text);

    if (!result.ok) {
      deps.logger.error(
        { model: input.model, errorCode: result.error.code, errorMessage: result.error.message },
        'Prompt generation failed'
      );
      // Preserve RATE_LIMITED as a distinct error code — callers can retry rate-limited
      // requests, whereas GENERATION_FAILED is a terminal failure.
      if (result.error.code === 'RATE_LIMITED') {
        return err({ code: 'RATE_LIMITED', message: result.error.message });
      }
      return err({ code: 'GENERATION_FAILED', message: result.error.message });
    }

    deps.logger.info(
      { model: input.model, promptLength: result.value.prompt.length },
      'Prompt generation completed successfully'
    );
    return ok(result.value);
  };
}
