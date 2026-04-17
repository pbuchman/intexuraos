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
            schemaVersion: { type: 'integer', enum: [2] },
            events: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'schemaVersion',
                  'eventId',
                  'occurredAt',
                  'owner',
                  'source',
                  'request',
                  'usage',
                  'cost',
                  'correlation',
                  'error',
                ],
                additionalProperties: false,
                properties: {
                  schemaVersion: { type: 'integer', enum: [2] },
                  eventId: { type: 'string', minLength: 1 },
                  occurredAt: { type: 'string', format: 'date-time' },
                  owner: {
                    type: 'object',
                    required: ['type', 'id'],
                    additionalProperties: false,
                    properties: {
                      type: { type: 'string', enum: ['user', 'system'] },
                      id: { type: 'string', minLength: 1 },
                    },
                  },
                  source: {
                    type: 'object',
                    required: ['service', 'component', 'client', 'environment'],
                    additionalProperties: false,
                    properties: {
                      service: { type: 'string', minLength: 1 },
                      component: { type: 'string', minLength: 1 },
                      client: { type: 'string', minLength: 1 },
                      environment: { type: 'string', enum: ['dev', 'prod', 'test'] },
                      workerLocation: { type: 'string', minLength: 1 },
                    },
                  },
                  request: {
                    type: 'object',
                    required: ['provider', 'model', 'operation', 'success', 'durationMs'],
                    additionalProperties: false,
                    properties: {
                      provider: {
                        type: 'string',
                        enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                      },
                      model: { type: 'string', minLength: 1 },
                      operation: {
                        type: 'string',
                        enum: [
                          'research',
                          'generate',
                          'image_generation',
                          'tool_calling',
                          'other',
                        ],
                      },
                      success: { type: 'boolean' },
                      durationMs: { type: 'number', minimum: 0 },
                      promptType: { type: 'string' },
                    },
                  },
                  usage: {
                    type: 'object',
                    required: [
                      'inputTokens',
                      'outputTokens',
                      'totalTokens',
                      'cacheReadTokens',
                      'cacheWriteTokens',
                      'cachedTokens',
                      'reasoningTokens',
                      'thinkingTokens',
                      'webSearchCalls',
                      'groundingEnabled',
                      'imageCount',
                    ],
                    additionalProperties: false,
                    properties: {
                      inputTokens: { type: 'number', minimum: 0 },
                      outputTokens: { type: 'number', minimum: 0 },
                      totalTokens: { type: 'number', minimum: 0 },
                      cacheReadTokens: { type: 'number', minimum: 0 },
                      cacheWriteTokens: { type: 'number', minimum: 0 },
                      cachedTokens: { type: 'number', minimum: 0 },
                      reasoningTokens: { type: 'number', minimum: 0 },
                      thinkingTokens: { type: 'number', minimum: 0 },
                      webSearchCalls: { type: 'number', minimum: 0 },
                      groundingEnabled: { type: 'boolean' },
                      imageCount: { type: 'number', minimum: 0 },
                    },
                  },
                  cost: {
                    type: 'object',
                    required: ['providerReportedUsd', 'pricingSource'],
                    additionalProperties: false,
                    properties: {
                      providerReportedUsd: { type: ['number', 'null'] },
                      pricingSource: {
                        type: 'string',
                        enum: ['provider_reported', 'pending'],
                      },
                    },
                  },
                  correlation: {
                    type: 'object',
                    required: [
                      'requestId',
                      'traceId',
                      'taskId',
                      'researchId',
                      'attempt',
                      'sessionId',
                    ],
                    additionalProperties: false,
                    properties: {
                      requestId: { type: ['string', 'null'] },
                      traceId: { type: ['string', 'null'] },
                      taskId: { type: ['string', 'null'] },
                      researchId: { type: ['string', 'null'] },
                      attempt: { type: ['number', 'null'] },
                      sessionId: { type: ['string', 'null'] },
                    },
                  },
                  error: {
                    anyOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['code', 'message'],
                        properties: {
                          code: { type: ['string', 'null'] },
                          message: { type: ['string', 'null'] },
                        },
                      },
                    ],
                  },
                },
              },
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
