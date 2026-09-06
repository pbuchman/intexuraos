import { createGptClient } from '@intexuraos/infra-gpt';
import type { LLMError } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  GenerateOptions,
  GenerateResult,
  LegacyDirectLlmClientConfig,
  LlmGenerateClient,
} from './llmClientFactory.js';

/**
 * Adapts the infra-gpt client to the {@link LlmGenerateClient} interface.
 *
 * The underlying `createGptClient` already wraps `generate()` with `withRetry`
 * (Task 6 of INT-1533) so this wrapper is a thin adapter; do not double-wrap.
 */
export function createGptGenerateClient(config: LegacyDirectLlmClientConfig): LlmGenerateClient {
  const inner = createGptClient({
    apiKey: config.apiKey,
    model: config.model,
    userId: config.userId,
    logger: config.logger,
    usageSink: config.usageSink,
    ...(config.ownerType !== undefined && { ownerType: config.ownerType }),
  });

  return {
    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, LLMError>> {
      return await inner.generate(prompt, options);
    },
  };
}
