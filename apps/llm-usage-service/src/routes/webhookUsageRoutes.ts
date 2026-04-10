import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import { validateOrchestratorSignature } from '../infra/webhookValidation.js';
import type { UsageEventInput } from '../domain/models/usageEvent.js';

interface WebhookIngestBody {
  schemaVersion: number;
  events: UsageEventInput[];
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
      logIncomingRequest(request, { message: 'Orchestrator webhook usage event ingest' });

      const { orchestratorSecret, usageEventRepository, usageAggregateRepository } = getServices();

      const authResult = validateOrchestratorSignature(request, { orchestratorSecret });
      if (!authResult.ok) {
        request.log.warn({ code: authResult.error.code }, 'Webhook auth failed');
        return await reply.fail('UNAUTHORIZED', authResult.error.message);
      }

      // schemaVersion and events are validated by Fastify schema (enum: [1], type: array)
      const body = request.body as WebhookIngestBody;

      // Enforce: all events must have source.service === 'orchestrator'
      for (let i = 0; i < body.events.length; i++) {
        const event = body.events[i];
        if (event !== undefined && event.source.service !== 'orchestrator') {
          return await reply.fail(
            'INVALID_REQUEST',
            `Event at index ${String(i)} has source.service '${event.source.service}' — webhook endpoint only accepts events from 'orchestrator'`,
          );
        }
      }

      const result = await ingestUsageEvents(
        { logger: request.log, usageEventRepository, usageAggregateRepository },
        body.events,
        'orchestrator_webhook',
      );

      return await reply.ok(result);
    },
  );

  done();
};
