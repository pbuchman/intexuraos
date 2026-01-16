/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processCalendarAction } from '../domain/index.js';

interface ProcessActionBody {
  action: {
    id: string;
    userId: string;
    title: string;
  };
}

async function handleCalendarError(
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
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ProcessActionBody }>(
    '/internal/calendar/process-action',
    {
      schema: {
        operationId: 'processCalendarAction',
        summary: 'Process a calendar action from natural language',
        description: 'Extracts calendar event data from text and creates in Google Calendar or saves as draft',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'object',
              required: ['id', 'userId', 'title'],
              properties: {
                id: { type: 'string', description: 'Action ID' },
                userId: { type: 'string', description: 'User ID' },
                title: { type: 'string', description: 'User message text to extract event from' },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['completed', 'failed'] },
              resourceUrl: { type: 'string', description: 'Frontend URL for created event' },
              error: { type: 'string', description: 'Error message if failed' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ProcessActionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { action } = request.body;

      request.log.info(
        { actionId: action.id, userId: action.userId, textLength: action.title.length },
        'internal/processCalendarAction: processing action'
      );

      const result = await processCalendarAction(
        {
          actionId: action.id,
          userId: action.userId,
          text: action.title,
        },
        {
          userServiceClient: services.userServiceClient,
          googleCalendarClient: services.googleCalendarClient,
          failedEventRepository: services.failedEventRepository,
          calendarActionExtractionService: services.calendarActionExtractionService,
          logger: request.log,
        }
      );

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      request.log.info(
        { actionId: action.id, status: result.value.status },
        'internal/processCalendarAction: complete'
      );

      return await reply.send(result.value);
    }
  );

  done();
};
