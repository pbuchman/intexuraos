import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listUsageEvents } from '../domain/usecases/listUsageEvents.js';
import type { ListUsageEventsRequest } from '../domain/usecases/listUsageEvents.js';
import { getUsageEvent } from '../domain/usecases/getUsageEvent.js';
import { queryUsage } from '../domain/usecases/queryUsage.js';
import type { UsageQueryRequest } from '../domain/models/usageQuery.js';

interface ListEventsBody {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: ListUsageEventsRequest['filters'];
  sortBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
  cursor?: string;
}

interface QueryBody {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: UsageQueryRequest['filters'];
  groupBy?: string[];
  sortBy?: UsageQueryRequest['sortBy'];
  limit?: number;
}

export const publicUsageRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post(
    '/llm-usage/events/list',
    {
      schema: {
        operationId: 'publicListUsageEvents',
        summary: 'List usage events (authenticated)',
        description: 'Public endpoint for listing LLM usage events with pagination, filtering, and sorting.',
        tags: ['usage'],
        body: {
          type: 'object',
          required: ['timeRange'],
          properties: {
            timeRange: {
              type: 'object',
              required: ['from', 'to'],
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
            filters: { type: 'object' },
            sortBy: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: ['occurredAt', 'costUsd', 'totalTokens'] },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'List result',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
          401: {
            description: 'Authentication failed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Public usage events list' });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as ListEventsBody;

      const listRequest: ListUsageEventsRequest = {
        timeRange: body.timeRange,
        ...(body.filters !== undefined ? { filters: body.filters } : {}),
        ...(body.sortBy !== undefined ? { sortBy: body.sortBy } : {}),
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
        ...(body.cursor !== undefined ? { cursor: body.cursor } : {}),
      };

      const { usageEventRepository } = getServices();

      const result = await listUsageEvents(
        { logger: request.log, usageEventRepository },
        listRequest,
      );

      if (!result.ok) {
        return await reply.fail('INVALID_REQUEST', result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  app.get(
    '/llm-usage/events/:eventId',
    {
      schema: {
        operationId: 'publicGetUsageEvent',
        summary: 'Get a single usage event (authenticated)',
        description: 'Public endpoint for retrieving a single usage event by ID.',
        tags: ['usage'],
        params: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Event found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          401: {
            description: 'Authentication failed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
          404: {
            description: 'Event not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Public get usage event' });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { eventId } = request.params as { eventId: string };
      const { usageEventRepository } = getServices();

      const result = await getUsageEvent(
        { logger: request.log, usageEventRepository },
        eventId,
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch usage event');
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', `Usage event ${eventId} not found`);
      }

      return await reply.ok({ event: result.value });
    },
  );

  app.post(
    '/llm-usage/query',
    {
      schema: {
        operationId: 'publicQueryUsage',
        summary: 'Query usage aggregates (authenticated)',
        description: 'Public endpoint for querying aggregated LLM usage data.',
        tags: ['usage'],
        body: {
          type: 'object',
          required: ['timeRange'],
          properties: {
            timeRange: {
              type: 'object',
              required: ['from', 'to'],
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
            filters: { type: 'object' },
            groupBy: { type: 'array', items: { type: 'string' } },
            sortBy: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
            limit: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: {
            description: 'Query result',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
          401: {
            description: 'Authentication failed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Public usage query' });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as QueryBody;

      const queryRequest: UsageQueryRequest = {
        timeRange: body.timeRange,
        ...(body.filters !== undefined ? { filters: body.filters } : {}),
        ...(body.groupBy !== undefined ? { groupBy: body.groupBy } : {}),
        ...(body.sortBy !== undefined ? { sortBy: body.sortBy } : {}),
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
      };

      const { usageAggregateRepository } = getServices();

      const result = await queryUsage(
        { logger: request.log, usageAggregateRepository },
        queryRequest,
      );

      if (!result.ok) {
        return await reply.fail('INVALID_REQUEST', result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  done();
};
