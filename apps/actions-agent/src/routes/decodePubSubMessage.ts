import type { FastifyRequest, FastifyReply } from 'fastify';

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime?: string;
  };
  subscription?: string;
}

/**
 * Decodes a base64-encoded PubSub message body.
 * Returns null on failure (error response already sent via reply).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function decodePubSubMessage<T>(request: FastifyRequest, reply: FastifyReply): T | null {
  const body = request.body as PubSubMessage;

  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    return JSON.parse(decoded) as T;
  } catch {
    request.log.error({ data: body.message.data }, 'Failed to decode PubSub message');
    void reply.fail('INVALID_REQUEST', 'Failed to decode PubSub message');
    return null;
  }
}
