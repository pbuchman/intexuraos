import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import type { UsageEventInput } from '../domain/models/usageEvent.js';

interface IngestBody {
  schemaVersion: number;
  events: UsageEventInput[];
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

  done();
};
