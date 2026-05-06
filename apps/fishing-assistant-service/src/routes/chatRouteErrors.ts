import type { FastifyReply } from 'fastify';
import type { SendChatMessageError } from '../domain/usecases/sendChatMessage.js';
import type { ChatRepositoryError } from '../domain/ports/chatRepository.js';

type ChatErrorReply = Pick<FastifyReply, 'fail' | 'status'>;

export function sendChatError(
  reply: ChatErrorReply,
  error: ChatRepositoryError | SendChatMessageError
): FastifyReply | Promise<FastifyReply> {
  switch (error.code) {
    case 'NOT_FOUND':
      return reply.fail('NOT_FOUND', error.message);
    case 'NO_API_KEY':
      // @allow-raw-send -- requires typed app-level error code for the web client
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_API_KEY',
          message: error.message,
        },
      });
    case 'DOWNSTREAM_ERROR':
      return reply.fail('DOWNSTREAM_ERROR', error.message);
    case 'CITATION_VALIDATION_FAILED':
    case 'FIRESTORE_ERROR':
      return reply.fail('INTERNAL_ERROR', error.message);
  }
}
