import type { FastifyReply } from 'fastify';
import type { KnowledgePageIndexingError } from '../domain/usecases/indexKnowledgePage.js';
import type { KnowledgeRepositoryError } from '../domain/ports/knowledgeRepositories.js';

export function sendKnowledgeError(
  reply: FastifyReply,
  error: KnowledgeRepositoryError | KnowledgePageIndexingError
): FastifyReply {
  switch (error.code) {
    case 'NOT_FOUND':
      return reply.fail('NOT_FOUND', error.message);
    case 'FOLDER_NOT_EMPTY':
      return reply.fail('CONFLICT', error.message);
    case 'PAGE_TOO_LARGE':
      return reply.fail('INVALID_REQUEST', error.message);
    case 'EMBEDDING_FAILED':
    case 'FIRESTORE_ERROR':
      return reply.fail('INTERNAL_ERROR', error.message);
  }
}
