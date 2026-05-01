import { createPerplexityClient } from '@intexuraos/infra-perplexity';
import type { LLMError } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  GenerateOptions,
  GenerateResult,
  LlmClientConfig,
  LlmGenerateClient,
} from './llmClientFactory.js';

/**
 * Adapts the infra-perplexity client to the {@link LlmGenerateClient} interface.
 *
 * The underlying `createPerplexityClient` already wraps `generate()` with `withRetry`
 * (Task 6 of INT-1533) so this wrapper is a thin adapter; do not double-wrap.
 */
export function createPerplexityGenerateClient(config: LlmClientConfig): LlmGenerateClient {
  const inner = createPerplexityClient({
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
