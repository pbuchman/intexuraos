import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { TodoProcessingEvent } from '@intexuraos/infra-pubsub';
import { getServices } from '../services.js';
import { processTodoCreated } from '../domain/usecases/processTodoCreated.js';

interface PubSubPushMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export const pubsubRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/todos/pubsub/todos-processing',
    {
      schema: {
        operationId: 'processTodosProcessing',
        summary: 'Process todo processing event from PubSub',
        description:
          'Internal endpoint for PubSub push. Updates todo status from processing to pending.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Processing completed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
            required: ['success'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/todos/pubsub/todos-processing',
        bodyPreviewLength: 200,
      });

      const fromHeader = request.headers.from;
      const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

      if (isPubSubPush) {
        request.log.info(
          { from: fromHeader, userAgent: request.headers['user-agent'] },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for pubsub/todos-processing endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubPushMessage;

      let eventData: TodoProcessingEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as TodoProcessingEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        return { success: true };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'todos.processing.created') {
        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return { success: true };
      }

      request.log.info(
        {
          pubsubMessageId: body.message.messageId,
          todoId: eventData.todoId,
          userId: eventData.userId,
          correlationId: eventData.correlationId,
        },
        'Processing todo created event'
      );

      const { todoRepository, todoItemExtractionService } = getServices();

      const result = await processTodoCreated(
        { todoRepository, logger: request.log, todoItemExtractionService },
        eventData.todoId
      );

      if (!result.ok) {
        request.log.warn(
          { todoId: eventData.todoId, error: result.error },
          'Todo processing failed'
        );
      } else {
        request.log.info(
          { todoId: eventData.todoId, newStatus: result.value.status },
          'Todo processing completed successfully'
        );
      }

      return { success: true };
    }
  );

  done();
};
