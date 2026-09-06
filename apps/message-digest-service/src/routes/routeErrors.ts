import type { FastifyReply } from 'fastify';

export async function sendMessageDigestRouteError(
  reply: FastifyReply,
  code: string
): Promise<unknown> {
  if (
    code === 'INVALID_REQUEST' ||
    code === 'INVALID_SCHEDULE' ||
    code === 'INVALID_QUERY' ||
    code === 'INVALID_CURSOR' ||
    code === 'SOURCE_TOO_LARGE'
  ) {
    return await reply.fail('INVALID_REQUEST', 'Invalid Message Digest request', undefined, {
      reason: code,
      ...(code === 'INVALID_CURSOR' ? { restartPagination: true } : {}),
    });
  }
  if (code === 'NOT_FOUND') {
    return await reply.fail('NOT_FOUND', 'Message Digest not found');
  }
  if (code === 'SOURCE_NOT_FOUND') {
    return await reply.fail('NOT_FOUND', 'WhatsApp chat not found');
  }
  if (code === 'SOURCE_UNAVAILABLE' || code === 'READINESS_UNAVAILABLE') {
    return await reply.fail('DOWNSTREAM_ERROR', 'WhatsApp is temporarily unavailable');
  }
  if (code === 'LLM_UNAVAILABLE' || code === 'INVALID_AGGREGATE') {
    return await reply.fail(
      'DOWNSTREAM_ERROR',
      'Message Digest preview is temporarily unavailable'
    );
  }
  if (code === 'SOURCE_CHANGED') {
    return await reply.fail(
      'CONFLICT',
      'Message Digest state changed; refresh and retry',
      undefined,
      { reason: 'SOURCE_CHANGED', refreshRequired: true }
    );
  }
  return await reply.fail(
    'CONFLICT',
    'Message Digest state changed; refresh and retry',
    undefined,
    {
      reason: code,
      refreshRequired: true,
    }
  );
}
