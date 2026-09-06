import { err, getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createOpenRouterEmbeddingsClient } from '@intexuraos/infra-openrouter';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { KnowledgeEmbeddingClient } from '../../domain/ports/embeddingClient.js';

export interface OpenRouterKnowledgeEmbeddingClientDeps {
  apiKey: string;
  logger: Logger;
  usageSink: UsageSink;
}

/** Routes Fishing knowledge embeddings through the platform OpenRouter key. */
export function createOpenRouterKnowledgeEmbeddingClient(
  deps: OpenRouterKnowledgeEmbeddingClientDeps
): KnowledgeEmbeddingClient {
  return {
    async embedTexts(input): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      const client = createOpenRouterEmbeddingsClient({
        apiKey: deps.apiKey,
        userId: input.userId,
        ownerType: 'user',
        logger: deps.logger,
        usageSink: deps.usageSink,
      });
      const result = await client.embedMany(input.texts, {
        promptType: 'fishing-knowledge-embedding',
      });
      if (result.ok) return result;

      deps.logger.error(
        { error: getErrorMessage(result.error), userId: input.userId },
        'Failed to embed fishing knowledge chunks'
      );
      return err({ code: 'EMBEDDING_FAILED', message: result.error.message });
    },
  };
}
