import type { FastifyReply } from 'fastify';

/**
 * Map domain LinearError codes to HTTP error responses.
 * Shared across all linear-agent route files.
 */
export async function handleLinearError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'INVALID_API_KEY') {
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'RATE_LIMIT') {
    return await reply.fail('DOWNSTREAM_ERROR', error.message);
  }
  if (error.code === 'INTERNAL_ERROR') {
    return await reply.fail('INTERNAL_ERROR', error.message);
  }
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}
