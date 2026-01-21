/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processCalendarAction, generateCalendarPreview } from '../domain/index.js';

interface ProcessActionBody {
  action: {
    id: string;
    userId: string;
    title: string;
  };
}

interface GeneratePreviewMessage {
  actionId: string;
  userId: string;
  text: string;
  currentDate: string;
}

interface PubSubBody {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GetPreviewParams {
  actionId: string;
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
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  message: { type: 'string', description: 'Human-readable feedback message' },
                  resourceUrl: { type: 'string', description: 'URL to created resource (success only)' },
                  errorCode: { type: 'string', description: 'Error code for debugging (failure only)' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          502: {
            description: 'Bad Gateway',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
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
          processedActionRepository: services.processedActionRepository,
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

      return await reply.ok(result.value);
    }
  );

  // Pub/Sub push handler for generating calendar previews
  fastify.post<{ Body: PubSubBody }>(
    '/internal/calendar/generate-preview',
    {
      schema: {
        operationId: 'generateCalendarPreview',
        summary: 'Generate a calendar event preview from action text',
        description: 'Pub/Sub push handler that generates preview data for a calendar action',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'object',
              required: ['data', 'messageId'],
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string', description: 'Pub/Sub message ID' },
                publishTime: { type: 'string', description: 'Message publish time' },
              },
            },
            subscription: { type: 'string', description: 'Subscription name' },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['previewId', 'status'],
                properties: {
                  previewId: { type: 'string', description: 'The action ID (preview uses same ID)' },
                  status: { type: 'string', enum: ['pending', 'ready', 'failed'] },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          400: {
            description: 'Bad Request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: PubSubBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      // Pub/Sub push requests use OIDC tokens (validated by Cloud Run automatically)
      // Direct service calls use x-internal-auth header
      // Detection: Pub/Sub requests have from: noreply@google.com header
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
            'Internal auth failed for /internal/calendar/generate-preview'
          );
          reply.status(401);
          return await reply.fail('UNAUTHORIZED', 'Unauthorized');
        }
      }

      const { message } = request.body;

      request.log.info(
        { messageId: message.messageId },
        'internal/generateCalendarPreview: received Pub/Sub message'
      );

      // Decode Pub/Sub message
      let messageData: GeneratePreviewMessage;
      try {
        const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
        messageData = JSON.parse(decoded) as GeneratePreviewMessage;
      } catch {
        request.log.error(
          { messageId: message.messageId },
          'internal/generateCalendarPreview: failed to decode message'
        );
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', 'Invalid message format');
      }

      const { actionId, userId, text, currentDate } = messageData;

      request.log.info(
        { messageId: message.messageId, actionId, userId, textLength: text.length },
        'internal/generateCalendarPreview: processing preview request'
      );

      const services = getServices();

      const result = await generateCalendarPreview(
        { actionId, userId, text, currentDate },
        {
          calendarActionExtractionService: services.calendarActionExtractionService,
          calendarPreviewRepository: services.calendarPreviewRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        request.log.error(
          { messageId: message.messageId, actionId, error: result.error },
          'internal/generateCalendarPreview: preview generation failed'
        );
        reply.status(500);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      request.log.info(
        { messageId: message.messageId, actionId, status: result.value.preview.status },
        'internal/generateCalendarPreview: complete'
      );

      return await reply.ok({
        previewId: actionId,
        status: result.value.preview.status,
      });
    }
  );

  // Get calendar preview by action ID
  fastify.get<{ Params: GetPreviewParams }>(
    '/internal/calendar/preview/:actionId',
    {
      schema: {
        operationId: 'getCalendarPreview',
        summary: 'Get a calendar event preview by action ID',
        description: 'Returns the preview data for a calendar action if it exists',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['actionId'],
          properties: {
            actionId: { type: 'string', description: 'Action ID' },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  preview: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      actionId: { type: 'string' },
                      userId: { type: 'string' },
                      status: { type: 'string', enum: ['pending', 'ready', 'failed'] },
                      summary: { type: 'string' },
                      start: { type: 'string' },
                      end: { type: 'string', nullable: true },
                      location: { type: 'string', nullable: true },
                      description: { type: 'string', nullable: true },
                      duration: { type: 'string', nullable: true },
                      isAllDay: { type: 'boolean' },
                      error: { type: 'string' },
                      reasoning: { type: 'string' },
                      generatedAt: { type: 'string' },
                    },
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: GetPreviewParams }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { actionId } = request.params;

      request.log.info(
        { actionId },
        'internal/getCalendarPreview: fetching preview'
      );

      const services = getServices();
      const result = await services.calendarPreviewRepository.getByActionId(actionId);

      if (!result.ok) {
        request.log.error(
          { actionId, error: result.error },
          'internal/getCalendarPreview: failed to fetch preview'
        );
        reply.status(500);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      request.log.info(
        { actionId, found: result.value !== null, status: result.value?.status },
        'internal/getCalendarPreview: complete'
      );

      return await reply.ok({ preview: result.value });
    }
  );

  done();
};
