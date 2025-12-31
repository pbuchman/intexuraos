/**
 * Implementation of LlmValidator port using @intexuraos/infra-* packages.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { createGptClient } from '@intexuraos/infra-gpt';
import { createClaudeClient } from '@intexuraos/infra-claude';
import type {
  LlmProvider,
  LlmTestResponse,
  LlmValidationError,
  LlmValidator,
} from '../../domain/settings/index.js';

/**
 * Implementation of LlmValidator that delegates to infra packages.
 */
export class LlmValidatorImpl implements LlmValidator {
  async validateKey(
    provider: LlmProvider,
    apiKey: string
  ): Promise<Result<void, LlmValidationError>> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({ apiKey });
        const result = await client.validateKey();
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
        const client = createGptClient({ apiKey });
        const result = await client.validateKey();
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
        const client = createClaudeClient({ apiKey });
        const result = await client.validateKey();
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
    }
  }

  async testRequest(
    provider: LlmProvider,
    apiKey: string,
    prompt: string
  ): Promise<Result<LlmTestResponse, LlmValidationError>> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({ apiKey });
        const result = await client.generate(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value });
      }
      case 'openai': {
        const client = createGptClient({ apiKey });
        const result = await client.research(prompt);
        if (!result.ok) {
          return err({
            code: 'API_ERROR',
            message: result.error.message,
          });
        }
        return ok({ content: result.value.content });
      }
      case 'anthropic': {
        const client = createClaudeClient({ apiKey });
        const result = await client.research(prompt);
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
