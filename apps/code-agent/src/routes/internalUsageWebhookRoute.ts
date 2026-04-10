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
                ],
                additionalProperties: false,
                properties: {
                  schemaVersion: { type: 'number', enum: [1] },
                  eventId: { type: 'string' },
                  occurredAt: { type: 'string' },
                  owner: {
                    type: 'object',
                    required: ['type', 'id'],
                    additionalProperties: false,
                    properties: {
                      type: { type: 'string', enum: ['user', 'system'] },
                      id: { type: 'string' },
                    },
                  },
                  source: {
                    type: 'object',
                    required: ['service', 'component', 'client', 'environment'],
                    additionalProperties: false,
                    properties: {
                      service: { type: 'string' },
                      component: { type: 'string' },
                      client: { type: 'string' },
                      environment: { type: 'string', enum: ['dev', 'prod', 'test'] },
                      workerLocation: { type: 'string' },
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
                      model: { type: 'string' },
                      operation: {
                        type: 'string',
                        enum: [
                          'research',
                          'generate',
                          'image_generation',
                          'tool_calling',
                          'visualization_insights',
                          'visualization_vegalite',
                          'other',
                        ],
                      },
                      success: { type: 'boolean' },
                      durationMs: { type: 'number' },
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
                      inputTokens: { type: 'number' },
                      outputTokens: { type: 'number' },
                      totalTokens: { type: 'number' },
                      cacheReadTokens: { type: 'number' },
                      cacheWriteTokens: { type: 'number' },
                      cachedTokens: { type: 'number' },
                      reasoningTokens: { type: 'number' },
                      thinkingTokens: { type: 'number' },
                      webSearchCalls: { type: 'number' },
                      groundingEnabled: { type: 'boolean' },
                      imageCount: { type: 'number' },
                    },
                  },
                  cost: {
                    type: 'object',
                    required: ['billedUsd', 'providerReportedUsd', 'calculatedUsd', 'pricingSource'],
                    additionalProperties: false,
                    properties: {
                      billedUsd: { type: 'number' },
                      providerReportedUsd: { type: ['number', 'null'] },
                      calculatedUsd: { type: ['number', 'null'] },
                      pricingSource: {
                        type: 'string',
                        enum: ['provider_reported', 'calculated', 'mixed', 'external'],
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
                    type: ['object', 'null'],
                    properties: {
                      code: { type: ['string', 'null'] },
                      message: { type: ['string', 'null'] },
                    },
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
