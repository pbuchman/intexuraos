import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import { queryUsage } from '../domain/usecases/queryUsage.js';
import type { UsageEventInput } from '../domain/models/usageEvent.js';
import type { UsageQueryRequest } from '../domain/models/usageQuery.js';

interface IngestBody {
  schemaVersion: number;
  events: UsageEventInput[];
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

export const internalUsageRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post(
    '/internal/usage/events',
    {
      schema: {
        operationId: 'internalIngestUsageEvents',
        summary: 'Ingest usage events (internal)',
        description: 'Internal endpoint for ingesting LLM usage events from other services.',
        tags: ['usage'],
        body: {
          type: 'object',
          required: ['schemaVersion', 'events'],
          properties: {
            schemaVersion: { type: 'integer', enum: [1] },
            events: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
        response: {
          200: {
            description: 'Ingest result',
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
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal usage event ingest' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      // schemaVersion and events are validated by Fastify schema (enum: [1], type: array)
      const body = request.body as IngestBody;

      const { usageEventRepository, usageAggregateRepository } = getServices();

      const result = await ingestUsageEvents(
        { logger: request.log, usageEventRepository, usageAggregateRepository },
        body.events,
        'internal',
      );

      return await reply.ok(result);
    },
  );

  app.post(
    '/internal/usage/query',
    {
      schema: {
        operationId: 'internalQueryUsage',
        summary: 'Query usage aggregates (internal)',
        description: 'Internal endpoint for querying aggregated LLM usage data.',
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
          401: {
            description: 'Authentication failed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'object', additionalProperties: true },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal usage query' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const body = request.body as QueryBody;

      // timeRange is validated by schema as required; this cast is safe
      // eslint types body.timeRange as always defined after schema validation

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
