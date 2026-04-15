import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import { validateOrchestratorSignature } from '../infra/webhookValidation.js';
import type { UsageEventInputAny } from '../domain/models/usageEvent.js';

interface WebhookIngestBody {
  schemaVersion: number;
  events: UsageEventInputAny[];
}

export const webhookUsageRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post(
    '/internal/webhooks/usage-events',
    {
      schema: {
        operationId: 'webhookIngestUsageEvents',
        summary: 'Ingest usage events (orchestrator webhook)',
        description: 'Webhook endpoint for orchestrator to submit LLM usage events with HMAC signature validation.',
        tags: ['usage'],
        body: {
          oneOf: [
            {
              type: 'object',
              required: ['schemaVersion', 'events'],
              additionalProperties: false,
              properties: {
                schemaVersion: { type: 'integer', enum: [1] },
                events: {
                  type: 'array',
                  items: { $ref: 'OrchestratorUsageEventInput#' },
                },
              },
            },
            {
              type: 'object',
              required: ['schemaVersion', 'events'],
              additionalProperties: false,
              properties: {
                schemaVersion: { type: 'integer', enum: [2] },
                events: {
                  type: 'array',
                  items: { $ref: 'OrchestratorUsageEventInputV2#' },
                },
              },
            },
          ],
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
      logIncomingRequest(request, { message: 'Orchestrator webhook usage event ingest' });

      const { orchestratorSecret, usageEventRepository, usageAggregateRepository, pricingCache } = getServices();

      const authResult = validateOrchestratorSignature(request, { orchestratorSecret });
      if (!authResult.ok) {
        request.log.warn({ code: authResult.error.code }, 'Webhook auth failed');
        return await reply.fail('UNAUTHORIZED', authResult.error.message);
      }

      const body = request.body as WebhookIngestBody;

      const result = await ingestUsageEvents(
        { logger: request.log, usageEventRepository, usageAggregateRepository, pricingCache },
        body.events,
        'orchestrator_webhook',
      );

      return await reply.ok(result);
    },
  );

  done();
};
