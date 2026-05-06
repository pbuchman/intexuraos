import { err, getErrorMessage, ok, type Logger } from '@intexuraos/common-core';
import type { KnowledgeEmbeddingClient } from '../../domain/ports/embeddingClient.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;

interface OpenAiEmbeddingsClient {
  embeddings: {
    create(input: { model: string; input: string[] }): Promise<{
      data: { embedding: number[] }[];
    }>;
  };
}

export interface OpenAiKnowledgeEmbeddingClientDeps {
  openAiClient: OpenAiEmbeddingsClient;
  logger: Logger;
}

export function createOpenAiKnowledgeEmbeddingClient(
  deps: OpenAiKnowledgeEmbeddingClientDeps
): KnowledgeEmbeddingClient {
  return {
    async embedTexts(input): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      try {
        const response = await deps.openAiClient.embeddings.create({
          model: EMBEDDING_MODEL,
          input: input.texts,
        });

        const embeddings = response.data.map((item) => item.embedding);
        const hasUnexpectedDimension = embeddings.some(
          (embedding) => embedding.length !== EMBEDDING_DIMENSION
        );
        if (hasUnexpectedDimension) {
          return err({
            code: 'EMBEDDING_FAILED',
            message: 'OpenAI returned an embedding with an unexpected dimension.',
          });
        }

        return ok(embeddings);
      } catch (error) {
        deps.logger.error(
          { error: getErrorMessage(error), userId: input.userId },
          'Failed to embed fishing knowledge chunks'
        );
        return err({ code: 'EMBEDDING_FAILED', message: getErrorMessage(error) });
      }
    },
  };
}
