/**
 * Implementation of LlmValidator port using @intexuraos/infra-* packages.
 * Uses generate() method with cheap models for fast key validation and testing.
 */
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { createOpenRouterClient, OPENROUTER_VALIDATION_MODEL } from '@intexuraos/infra-openrouter';
import {
  createOpenRouterModelId,
  type ExecutableLlmProvider,
} from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type {
  LlmTestResponse,
  LlmValidationError,
  LlmValidator,
} from '../../domain/settings/index.js';

/**
 * Implementation of LlmValidator that delegates to infra packages.
 * Uses cheap/fast models for validation to minimize costs.
 */
export class LlmValidatorImpl implements LlmValidator {
  private readonly logger: Logger;
  private readonly usageSink: UsageSink;

  constructor(logger: Logger, usageSink: UsageSink) {
    this.logger = logger;
    this.usageSink = usageSink;
  }

  async validateKey(
    _provider: ExecutableLlmProvider,
    apiKey: string,
    userId: string
  ): Promise<Result<void, LlmValidationError>> {
    const client = createOpenRouterClient({
      apiKey,
      model: OPENROUTER_VALIDATION_MODEL,
      evidenceModelId: createOpenRouterModelId(OPENROUTER_VALIDATION_MODEL),
      userId,
      logger: this.logger,
      usageSink: this.usageSink,
    });
    const result = await client.validateKey(apiKey);
    if (!result.ok) {
      return err({
        code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
        message:
          result.error.code === 'INVALID_KEY'
            ? 'Invalid OpenRouter API key'
            : `OpenRouter API error: ${result.error.message}`,
      });
    }
    return ok(undefined);
  }

  async testRequest(
    _provider: ExecutableLlmProvider,
    apiKey: string,
    prompt: string,
    userId: string
  ): Promise<Result<LlmTestResponse, LlmValidationError>> {
    const client = createOpenRouterClient({
      apiKey,
      model: OPENROUTER_VALIDATION_MODEL,
      evidenceModelId: createOpenRouterModelId(OPENROUTER_VALIDATION_MODEL),
      userId,
      logger: this.logger,
      usageSink: this.usageSink,
    });
    const result = await client.generate(prompt, { promptType: 'user-service-validation' });
    if (!result.ok) {
      return err({
        code: 'API_ERROR',
        message: result.error.message,
      });
    }
    return ok({ content: result.value.content });
  }
}
