import type { Result } from '@intexuraos/common-core';

export interface KnowledgeEmbeddingInput {
  userId: string;
  texts: string[];
}

export interface KnowledgeEmbeddingError {
  code: 'EMBEDDING_FAILED';
  message: string;
}

export interface KnowledgeEmbeddingClient {
  embedTexts(input: KnowledgeEmbeddingInput): Promise<Result<number[][], KnowledgeEmbeddingError>>;
}
