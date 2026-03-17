import { validateInternalAuth } from '@intexuraos/common-http';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface PubSubPushMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export async function authenticatePubSub(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const fromHeader = request.headers.from;
  const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

  if (isPubSubPush) {
    request.log.info(
      { from: fromHeader, userAgent: request.headers['user-agent'] },
      'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
    );
    return true;
  }

  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    request.log.warn(
      { reason: authResult.reason },
      `Internal auth failed for ${request.url}`
    );
    await reply.fail('UNAUTHORIZED', `Internal auth failed for ${request.url}`);
    return false;
  }

  return true;
}

interface PubSubEvent {
  type: string;
}

export function decodePubSubMessage(
  request: FastifyRequest
): { data: PubSubEvent; messageId: string } | null {
  const body = request.body as PubSubPushMessage;

  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const eventData = JSON.parse(decoded) as PubSubEvent;
    return { data: eventData, messageId: body.message.messageId };
  } catch {
    request.log.error(
      { messageId: body.message.messageId },
      'Failed to decode PubSub message'
    );
    return null;
  }
}
