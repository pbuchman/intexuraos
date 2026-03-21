/**
 * Failed event routes — manage and retry failed calendar event extractions.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createEvent, type CreateEventInput, type FailedEventFilters } from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';

interface FailedEventsQuery {
  limit?: number;
}

interface FailedEventParams {
  id: string;
}

export const failedEventRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: FailedEventsQuery }>(
    '/calendar/failed-events',
    {
      schema: {
        operationId: 'listFailedEvents',
        summary: 'List failed calendar event extractions',
        description: 'Lists failed calendar event extractions for manual review',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of events (default: 10)' },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  failedEvents: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        userId: { type: 'string' },
                        actionId: { type: 'string' },
                        originalText: { type: 'string' },
                        summary: { type: 'string' },
                        start: { type: ['string', 'null'] },
                        end: { type: ['string', 'null'] },
                        location: { type: ['string', 'null'] },
                        description: { type: ['string', 'null'] },
                        error: { type: 'string' },
                        reasoning: { type: 'string' },
                        createdAt: { type: 'string' },
                      },
                    },
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Error',
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
    async (request: FastifyRequest<{ Querystring: FailedEventsQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { failedEventRepository } = getServices();
      const filters: FailedEventFilters = {};
      if (request.query.limit !== undefined) {
        filters.limit = request.query.limit;
      }

      const result = await failedEventRepository.list(user.userId, filters);

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      return await reply.ok({ failedEvents: result.value });
    }
  );

  fastify.delete<{ Params: FailedEventParams }>(
    '/calendar/failed-events/:id',
    {
      schema: {
        operationId: 'deleteFailedEvent',
        summary: 'Delete a failed calendar event extraction',
        description: 'Permanently removes a failed event from the review queue',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Failed event ID' },
          },
        },
        response: {
          204: { description: 'Deleted successfully' },
          404: {
            description: 'Not found',
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
    async (request: FastifyRequest<{ Params: FailedEventParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { failedEventRepository } = getServices();
      const { id } = request.params;

      const eventResult = await failedEventRepository.get(id);
      if (!eventResult.ok) {
        return await handleCalendarError(eventResult.error, reply);
      }

      if (eventResult.value?.userId !== user.userId) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', 'Failed event not found');
      }

      const deleteResult = await failedEventRepository.delete(id);
      if (!deleteResult.ok) {
        return await handleCalendarError(deleteResult.error, reply);
      }

      // @allow-raw-send: 204 No Content response
      reply.status(204);
      return await reply.send();
    }
  );

  fastify.post<{ Params: FailedEventParams }>(
    '/calendar/failed-events/:id/retry',
    {
      schema: {
        operationId: 'retryFailedEvent',
        summary: 'Retry creating a calendar event from a failed attempt',
        description: 'Attempts to create the calendar event again using stored extraction data',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Failed event ID' },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  event: { type: 'object', additionalProperties: true },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          404: {
            description: 'Not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          422: {
            description: 'Unprocessable',
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
    async (request: FastifyRequest<{ Params: FailedEventParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { failedEventRepository, googleCalendarClient, userServiceClient } = getServices();
      const { id } = request.params;

      const eventResult = await failedEventRepository.get(id);
      if (!eventResult.ok) {
        return await handleCalendarError(eventResult.error, reply);
      }

      if (eventResult.value?.userId !== user.userId) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', 'Failed event not found');
      }

      const failedEvent = eventResult.value;

      if (failedEvent.start === null || failedEvent.end === null) {
        reply.status(422);
        return await reply.fail('UNPROCESSABLE_ENTITY', 'Cannot retry: missing start or end time');
      }

      const eventInput: CreateEventInput = {
        summary: failedEvent.summary,
        start: { dateTime: failedEvent.start },
        end: { dateTime: failedEvent.end },
      };
      if (failedEvent.description !== null) {
        eventInput.description = failedEvent.description;
      }
      if (failedEvent.location !== null) {
        eventInput.location = failedEvent.location;
      }

      const createResult = await createEvent(
        { userId: user.userId, event: eventInput },
        { googleCalendarClient, userServiceClient, logger: request.log }
      );

      if (!createResult.ok) {
        // Use inline 422 handling for createEvent errors to maintain API contract
        // (retry failure means the event data is unprocessable)
        reply.status(422);
        return await reply.fail('UNPROCESSABLE_ENTITY', createResult.error.message);
      }

      const deleteResult = await failedEventRepository.delete(id);
      if (!deleteResult.ok) {
        request.log.error(
          { error: deleteResult.error, failedEventId: id, createdEventId: createResult.value.id },
          'Failed to delete resolved failed event from Firestore'
        );
      }

      return await reply.ok({ event: createResult.value });
    }
  );

  done();
};
