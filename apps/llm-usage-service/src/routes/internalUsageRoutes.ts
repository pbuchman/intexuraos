import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import type { UsageEventInput } from '../domain/models/usageEvent.js';
import { getResearchCostSummary } from '../domain/usecases/getResearchCostSummary.js';
import type { ResearchCostSummaryRequest } from '../domain/models/researchCostSummary.js';

interface IngestBody {
  schemaVersion: number;
  events: UsageEventInput[];
}

type ResearchCostSummaryBody = ResearchCostSummaryRequest;

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
          additionalProperties: false,
          properties: {
            schemaVersion: { type: 'integer', enum: [2] },
            events: {
              type: 'array',
              items: { $ref: 'UsageEventInput#' },
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

      const body = request.body as IngestBody;

      const { usageEventRepository, usageAggregateRepository, pricingCache } = getServices();

      const result = await ingestUsageEvents(
        { logger: request.log, usageEventRepository, usageAggregateRepository, pricingCache },
        body.events,
        'internal',
      );

      return await reply.ok(result);
    },
  );

  app.post(
    '/internal/usage/research-cost-summary',
    {
      schema: {
        operationId: 'internalResearchCostSummary',
        summary: 'Summarize research usage cost',
        description: 'Internal endpoint for summarizing LLM usage events correlated to a research run.',
        tags: ['usage'],
        body: {
          type: 'object',
          required: ['researchId'],
          additionalProperties: false,
          properties: {
            researchId: { type: 'string', minLength: 1 },
            owner: {
              type: 'object',
              required: ['type', 'id'],
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['user', 'system'] },
                id: { type: 'string', minLength: 1 },
              },
            },
            timeRange: {
              type: 'object',
              required: ['from', 'to'],
              additionalProperties: false,
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Research cost summary',
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
          500: {
            description: 'Internal error',
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
      logIncomingRequest(request, { message: 'Internal research cost summary' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const body = request.body as ResearchCostSummaryBody;
      const { usageEventRepository } = getServices();

      const result = await getResearchCostSummary(
        { logger: request.log, usageEventRepository },
        body,
      );

      if (!result.ok) {
        if (result.error.code !== 'INVALID_REQUEST' && result.error.code !== 'INVALID_TIME_RANGE') {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        return await reply.fail('INVALID_REQUEST', result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  done();
};
