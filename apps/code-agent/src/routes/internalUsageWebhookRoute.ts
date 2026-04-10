/**
 * Internal usage webhook route.
 *
 * Receives validated usage events from the orchestrator and forwards them
 * to llm-usage-service via the UsageServiceClient.
 *
 * Auth: X-Internal-Auth + HMAC-SHA256 orchestrator signature.
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { validateOrchestratorSignature } from '../infra/webhookValidation.js';
import { loadConfig } from '../config.js';
import { forwardUsageEvents } from '../domain/usecases/forwardUsageEvents.js';

export const internalUsageWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/webhooks/usage-events',
    {
      schema: {
        operationId: 'forwardUsageEvents',
        summary: 'Forward usage events to llm-usage-service',
        description:
          'Receives usage events from the orchestrator, validates internal auth and HMAC, then forwards to llm-usage-service.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['schemaVersion', 'events'],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: 'number', enum: [1] },
            events: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
        response: {
          200: {
            description: 'Events forwarded successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  accepted: { type: 'number' },
                  duplicates: { type: 'number' },
                  rejected: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        index: { type: 'number' },
                        code: { type: 'string' },
                        message: { type: 'string' },
                      },
                      required: ['index', 'code', 'message'],
                    },
                  },
                },
                required: ['accepted', 'duplicates', 'rejected'],
              },
              diagnostics: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  requestId: { type: 'string' },
                  durationMs: { type: 'number' },
                },
                required: ['requestId'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['INTERNAL_ERROR'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Usage service not configured',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['MISCONFIGURED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/webhooks/usage-events',
      });

      // Validate X-Internal-Auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Validate HMAC orchestrator signature
      const hmacResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });
      if (!hmacResult.ok) {
        request.log.warn({ error: hmacResult.error }, 'HMAC validation failed for usage-events webhook');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      // Check that usageServiceClient is configured
      const { usageServiceClient, logger } = getServices();
      if (usageServiceClient === undefined) {
        return await reply.fail('MISCONFIGURED', 'Usage service client is not configured');
      }

      // Forward events
      const result = await forwardUsageEvents(
        request.body as Parameters<typeof forwardUsageEvents>[0],
        { usageServiceClient, logger }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', `Failed to forward usage events: ${result.error.message}`);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
