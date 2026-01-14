/**
 * Implementation of LlmValidator port using @intexuraos/infra-* packages.
 * Uses generate() method with cheap models for fast key validation and testing.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { createGptClient } from '@intexuraos/infra-gpt';
import { createClaudeClient } from '@intexuraos/infra-claude';
import { createPerplexityClient } from '@intexuraos/infra-perplexity';
import { createGlmClient } from '@intexuraos/infra-glm';
import { LlmModels, LlmProviders, type ModelPricing } from '@intexuraos/llm-contract';
import type {
  LlmProvider,
  LlmTestResponse,
  LlmValidationError,
  LlmValidator,
} from '../../domain/settings/index.js';

const VALIDATION_PROMPT = 'Say "API key validated" in exactly 3 words.';

const VALIDATION_MODELS = {
  [LlmProviders.Google]: LlmModels.Gemini20Flash,
  [LlmProviders.OpenAI]: LlmModels.GPT4oMini,
  [LlmProviders.Anthropic]: LlmModels.ClaudeHaiku35,
  [LlmProviders.Perplexity]: LlmModels.Sonar,
<<<<<<< HEAD
  [LlmProviders.Zhipu]: LlmModels.Glm47,
=======
  [LlmProviders.Zai]: LlmModels.Glm47,
>>>>>>> origin/development
} as const;

/**
 * Pricing configuration for validation models.
 */
export interface ValidationPricing {
  google: ModelPricing;
  openai: ModelPricing;
  anthropic: ModelPricing;
  perplexity: ModelPricing;
<<<<<<< HEAD
  zhipu: ModelPricing;
=======
  zai: ModelPricing;
>>>>>>> origin/development
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
      case LlmProviders.Google: {
        const client = createGeminiClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Google],
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
      case LlmProviders.OpenAI: {
        const client = createGptClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.OpenAI],
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
      case LlmProviders.Anthropic: {
        const client = createClaudeClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Anthropic],
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
      case LlmProviders.Perplexity: {
        const client = createPerplexityClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Perplexity],
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
<<<<<<< HEAD
      case LlmProviders.Zhipu: {
        const client = createGlmClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Zhipu],
          userId,
          pricing: this.pricing.zhipu,
=======
      case LlmProviders.Zai: {
        const client = createGlmClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Zai],
          userId,
          pricing: this.pricing.zai,
>>>>>>> origin/development
        });
        const result = await client.generate(VALIDATION_PROMPT);
        if (!result.ok) {
          return err({
            code: result.error.code === 'INVALID_KEY' ? 'INVALID_KEY' : 'API_ERROR',
            message:
              result.error.code === 'INVALID_KEY'
<<<<<<< HEAD
                ? 'Invalid Zhipu API key'
                : `Zhipu API error: ${result.error.message}`,
=======
                ? 'Invalid Zai API key'
                : `Zai API error: ${result.error.message}`,
>>>>>>> origin/development
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
      case LlmProviders.Google: {
        const client = createGeminiClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Google],
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
      case LlmProviders.OpenAI: {
        const client = createGptClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.OpenAI],
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
      case LlmProviders.Anthropic: {
        const client = createClaudeClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Anthropic],
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
      case LlmProviders.Perplexity: {
        const client = createPerplexityClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Perplexity],
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
<<<<<<< HEAD
      case LlmProviders.Zhipu: {
        const client = createGlmClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Zhipu],
          userId,
          pricing: this.pricing.zhipu,
=======
      case LlmProviders.Zai: {
        const client = createGlmClient({
          apiKey,
          model: VALIDATION_MODELS[LlmProviders.Zai],
          userId,
          pricing: this.pricing.zai,
>>>>>>> origin/development
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
