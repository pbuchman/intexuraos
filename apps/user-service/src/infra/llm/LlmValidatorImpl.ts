/**
 * Implementation of LlmValidator port using @intexuraos/infra-* packages.
 * Uses generate() method with cheap models for fast key validation and testing.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { createGptClient } from '@intexuraos/infra-gpt';
import { createClaudeClient } from '@intexuraos/infra-claude';
import { createPerplexityClient } from '@intexuraos/infra-perplexity';
import type { ModelPricing } from '@intexuraos/llm-contract';
import type {
  LlmProvider,
  LlmTestResponse,
  LlmValidationError,
  LlmValidator,
} from '../../domain/settings/index.js';

const VALIDATION_PROMPT = 'Say "API key validated" in exactly 3 words.';

const VALIDATION_MODELS = {
  google: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  perplexity: 'sonar',
} as const;

/**
 * Pricing configuration for validation models.
 */
export interface ValidationPricing {
  google: ModelPricing;
  openai: ModelPricing;
  anthropic: ModelPricing;
  perplexity: ModelPricing;
}

/**
 * Implementation of LlmValidator that delegates to infra packages.
 * Uses cheap/fast models for validation to minimize costs.
 */
export class LlmValidatorImpl implements LlmValidator {
  private readonly pricing: ValidationPricing;

  constructor(pricing: ValidationPricing) {
    this.pricing = pricing;
  }

  async validateKey(
    provider: LlmProvider,
    apiKey: string,
    userId: string
  ): Promise<Result<void, LlmValidationError>> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({
          apiKey,
          model: VALIDATION_MODELS.google,
          userId,
          pricing: this.pricing.google,
        });
        const result = await client.generate(VALIDATION_PROMPT);
        if (!result.ok) {
          return err({
            code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
            message:
              result.error.code === 'INVALID_KEY'
                ? 'Invalid Google API key'
                : `Google API error: ${result.error.message}`,
          });
        }
        return ok(undefined);
      }
      case 'openai': {
        const client = createGptClient({
          apiKey,
          model: VALIDATION_MODELS.openai,
          userId,
          pricing: this.pricing.openai,
        });
        const result = await client.generate(VALIDATION_PROMPT);
        if (!result.ok) {
          return err({
            code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
            message:
              result.error.code === 'INVALID_KEY'
                ? 'Invalid OpenAI API key'
                : `OpenAI API error: ${result.error.message}`,
          });
        }
        return ok(undefined);
      }
      case 'anthropic': {
        const client = createClaudeClient({
          apiKey,
          model: VALIDATION_MODELS.anthropic,
          userId,
          pricing: this.pricing.anthropic,
        });
        const result = await client.generate(VALIDATION_PROMPT);
        if (!result.ok) {
          return err({
            code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
            message:
              result.error.code === 'INVALID_KEY'
                ? 'Invalid Anthropic API key'
                : `Anthropic API error: ${result.error.message}`,
          });
        }
        return ok(undefined);
      }
      case 'perplexity': {
        const client = createPerplexityClient({
          apiKey,
          model: VALIDATION_MODELS.perplexity,
          userId,
          pricing: this.pricing.perplexity,
        });
        const result = await client.generate(VALIDATION_PROMPT);
        if (!result.ok) {
          return err({
            code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
            message:
              result.error.code === 'INVALID_KEY'
                ? 'Invalid Perplexity API key'
                : `Perplexity API error: ${result.error.message}`,
          });
        }
        return ok(undefined);
      }
    }
  }

  async testRequest(
    provider: LlmProvider,
    apiKey: string,
    prompt: string,
    userId: string
  ): Promise<Result<LlmTestResponse, LlmValidationError>> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({
          apiKey,
          model: VALIDATION_MODELS.google,
          userId,
          pricing: this.pricing.google,
        });
        const result = await client.generate(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value.content });
      }
      case 'openai': {
        const client = createGptClient({
          apiKey,
          model: VALIDATION_MODELS.openai,
          userId,
          pricing: this.pricing.openai,
        });
        const result = await client.generate(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value.content });
      }
      case 'anthropic': {
        const client = createClaudeClient({
          apiKey,
          model: VALIDATION_MODELS.anthropic,
          userId,
          pricing: this.pricing.anthropic,
        });
        const result = await client.generate(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value.content });
      }
      case 'perplexity': {
        const client = createPerplexityClient({
          apiKey,
          model: VALIDATION_MODELS.perplexity,
          userId,
          pricing: this.pricing.perplexity,
        });
        const result = await client.generate(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value.content });
      }
    }
  }
}
