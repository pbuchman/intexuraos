import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { IntexIncomingMessage } from '../domain/ports/incomingMessageHandler.js';
import { decodeIntexMessageIngestPush } from '../infra/pubsub/decoder.js';
import { getServices } from '../services.js';

const incomingMessageBodySchema = {
  type: 'object',
  required: ['type', 'userId', 'messageId', 'text', 'sourceType', 'timestamp'],
  properties: {
    type: { type: 'string', enum: ['intex.message.ingest'] },
    userId: { type: 'string', minLength: 1 },
    messageId: { type: 'string', minLength: 1 },
    text: { type: 'string' },
    sourceType: { type: 'string', minLength: 1 },
    whatsappSender: { type: 'string' },
    timestamp: { type: 'string', minLength: 1 },
  },
} as const;

const pubSubPushBodySchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: {
      type: 'object',
      required: ['data', 'messageId'],
      properties: {
        data: { type: 'string', minLength: 1 },
        messageId: { type: 'string', minLength: 1 },
        publishTime: { type: 'string' },
      },
    },
    subscription: { type: 'string' },
  },
} as const;

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: unknown }>(
    '/internal/intex-agent/messages',
    {
      schema: {
        operationId: 'ingestIntexAgentMessage',
        summary: 'Ingest WhatsApp Assistant message',
        description: 'Internal endpoint for WhatsApp Assistant text and transcription events.',
        tags: ['internal'],
        body: {
          anyOf: [incomingMessageBodySchema, pubSubPushBodySchema],
        },
      },
    },
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/intex-agent/messages',
      });

      if (!isAuthenticatedIntexMessageRequest(request)) {
        request.log.warn('Internal auth failed for intex message ingest');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for intex message ingest');
      }

      let incomingMessage: IntexIncomingMessage;
      try {
        incomingMessage = decodeIncomingMessageBody(request.body);
      } catch (error) {
        const message = getErrorMessage(error, 'Invalid intex.message.ingest event');
        request.log.warn({ error: message }, 'Invalid intex message ingest payload');
        return await reply.fail('INVALID_REQUEST', message);
      }

      const result = await getServices().incomingMessageHandler.handle(incomingMessage);

      void reply.status(202);
      return await reply.ok({
        accepted: true,
        sessionId: result.sessionId,
      });
    }
  );

  done();
};

function isAuthenticatedIntexMessageRequest(request: FastifyRequest): boolean {
  const fromHeader = request.headers.from;
  if (typeof fromHeader === 'string' && fromHeader === 'noreply@google.com') {
    request.log.info(
      { from: fromHeader, userAgent: request.headers['user-agent'] },
      'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
    );
    return true;
  }

  const authResult = validateInternalAuth(request);
  return authResult.valid;
}

function decodeIncomingMessageBody(body: unknown): IntexIncomingMessage {
  if (isDirectIntexIncomingMessage(body)) {
    return body;
  }

  return decodeIntexMessageIngestPush(body);
}

function isDirectIntexIncomingMessage(body: unknown): body is IntexIncomingMessage {
  /* v8 ignore start -- schema: Fastify body schema cannot pass non-object route payloads to this helper @preserve */
  if (body === null || typeof body !== 'object') {
    return false;
  }
  /* v8 ignore stop @preserve */

  return (body as Record<string, unknown>)['type'] === 'intex.message.ingest';
}
