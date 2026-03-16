/**
 * Calendar error handler — maps domain errors to HTTP responses.
 */
import type { FastifyReply } from 'fastify';

export async function handleCalendarError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'TOKEN_ERROR') {
    reply.status(401);
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'NOT_FOUND') {
    reply.status(404);
    return await reply.fail('NOT_FOUND', error.message);
  }
  if (error.code === 'INVALID_REQUEST') {
    reply.status(400);
    return await reply.fail('INVALID_REQUEST', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}
