import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  intexuraFastifyPlugin,
  fastifyAuthPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import {
  buildHealthResponse,
  checkFirestore,
  checkSecrets,
  type HealthCheck,
} from '@intexuraos/http-server';
import { createSentryStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { internalRoutes } from './routes/internalRoutes.js';
import { publicRoutes } from './routes/publicRoutes.js';

const SERVICE_NAME = 'app-settings-service';
const SERVICE_VERSION = '0.0.4';

const REQUIRED_SECRETS = ['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const servers = [
    {
      url: 'https://intexuraos-app-settings-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8122', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS App Settings Service - Centralized configuration management',
        version: SERVICE_VERSION,
      },
      servers,
      components: {
        schemas: {
          ApiOk: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object' },
              diagnostics: { $ref: '#/components/schemas/Diagnostics' },
            },
            required: ['success', 'data'],
          },
          ApiError: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: '#/components/schemas/ErrorBody' },
              diagnostics: { $ref: '#/components/schemas/Diagnostics' },
            },
            required: ['success', 'error'],
          },
          ErrorBody: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { $ref: '#/components/schemas/ErrorCode' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
          ErrorCode: {
            type: 'string',
            enum: [
              'INVALID_REQUEST',
              'UNAUTHORIZED',
              'FORBIDDEN',
              'NOT_FOUND',
              'CONFLICT',
              'DOWNSTREAM_ERROR',
              'INTERNAL_ERROR',
              'MISCONFIGURED',
            ],
          },
          Diagnostics: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              durationMs: { type: 'number' },
              downstreamStatus: { type: 'integer' },
              downstreamRequestId: { type: 'string' },
            },
          },
          ModelPricing: {
            type: 'object',
            required: ['inputPricePerMillion', 'outputPricePerMillion'],
            properties: {
              inputPricePerMillion: { type: 'number' },
              outputPricePerMillion: { type: 'number' },
              cacheReadMultiplier: { type: 'number' },
              cacheWriteMultiplier: { type: 'number' },
              webSearchCostPerCall: { type: 'number' },
              groundingCostPerRequest: { type: 'number' },
              imagePricing: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
              useProviderCost: { type: 'boolean' },
            },
          },
          ProviderPricing: {
            type: 'object',
            required: ['provider', 'models', 'updatedAt'],
            properties: {
              provider: { type: 'string' },
              models: {
                type: 'object',
                additionalProperties: { $ref: '#/components/schemas/ModelPricing' },
              },
              updatedAt: { type: 'string' },
            },
          },
          MonthlyCost: {
            type: 'object',
            required: ['month', 'costUsd', 'calls', 'inputTokens', 'outputTokens', 'percentage'],
            properties: {
              month: { type: 'string' },
              costUsd: { type: 'number' },
              calls: { type: 'integer' },
              inputTokens: { type: 'integer' },
              outputTokens: { type: 'integer' },
              percentage: { type: 'integer' },
            },
          },
          ModelCost: {
            type: 'object',
            required: ['model', 'costUsd', 'calls', 'percentage'],
            properties: {
              model: { type: 'string' },
              costUsd: { type: 'number' },
              calls: { type: 'integer' },
              percentage: { type: 'integer' },
            },
          },
          CallTypeCost: {
            type: 'object',
            required: ['callType', 'costUsd', 'calls', 'percentage'],
            properties: {
              callType: { type: 'string' },
              costUsd: { type: 'number' },
              calls: { type: 'integer' },
              percentage: { type: 'integer' },
            },
          },
          AggregatedCosts: {
            type: 'object',
            required: [
              'totalCostUsd',
              'totalCalls',
              'totalInputTokens',
              'totalOutputTokens',
              'monthlyBreakdown',
              'byModel',
              'byCallType',
            ],
            properties: {
              totalCostUsd: { type: 'number' },
              totalCalls: { type: 'integer' },
              totalInputTokens: { type: 'integer' },
              totalOutputTokens: { type: 'integer' },
              monthlyBreakdown: {
                type: 'array',
                items: { $ref: '#/components/schemas/MonthlyCost' },
              },
              byModel: {
                type: 'array',
                items: { $ref: '#/components/schemas/ModelCost' },
              },
              byCallType: {
                type: 'array',
                items: { $ref: '#/components/schemas/CallTypeCost' },
              },
            },
          },
        },
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT authentication token',
          },
          internalAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Internal-Auth',
            description: 'Internal service-to-service authentication token',
          },
        },
      },
    },
  };
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env['NODE_ENV'] === 'test'
        ? false
        : {
            level: process.env['LOG_LEVEL'] ?? 'info',
            stream: createSentryStream(
              pino.multistream([
                pino.destination({ dest: 1, sync: false }),
              ])
            ),
          },
    disableRequestLogging: true,
  });

  registerQuietHealthCheckLogging(app);

  await app.register(fastifyCors, { origin: true });
  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);
  setupSentryErrorHandler(app as unknown as FastifyInstance);
  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  registerCoreSchemas(app);

  // Register service-specific schemas for Fastify serialization
  app.addSchema({
    $id: 'ModelPricing',
    type: 'object',
    required: ['inputPricePerMillion', 'outputPricePerMillion'],
    properties: {
      inputPricePerMillion: { type: 'number' },
      outputPricePerMillion: { type: 'number' },
      cacheReadMultiplier: { type: 'number' },
      cacheWriteMultiplier: { type: 'number' },
      webSearchCostPerCall: { type: 'number' },
      groundingCostPerRequest: { type: 'number' },
      imagePricing: {
        type: 'object',
        additionalProperties: { type: 'number' },
      },
      useProviderCost: { type: 'boolean' },
    },
  });

  app.addSchema({
    $id: 'ProviderPricing',
    type: 'object',
    required: ['provider', 'models', 'updatedAt'],
    properties: {
      provider: { type: 'string' },
      models: {
        type: 'object',
        additionalProperties: { $ref: 'ModelPricing#' },
      },
      updatedAt: { type: 'string' },
    },
  });

  app.addSchema({
    $id: 'MonthlyCost',
    type: 'object',
    required: ['month', 'costUsd', 'calls', 'inputTokens', 'outputTokens', 'percentage'],
    properties: {
      month: { type: 'string' },
      costUsd: { type: 'number' },
      calls: { type: 'integer' },
      inputTokens: { type: 'integer' },
      outputTokens: { type: 'integer' },
      percentage: { type: 'integer' },
    },
  });

  app.addSchema({
    $id: 'ModelCost',
    type: 'object',
    required: ['model', 'costUsd', 'calls', 'percentage'],
    properties: {
      model: { type: 'string' },
      costUsd: { type: 'number' },
      calls: { type: 'integer' },
      percentage: { type: 'integer' },
    },
  });

  app.addSchema({
    $id: 'CallTypeCost',
    type: 'object',
    required: ['callType', 'costUsd', 'calls', 'percentage'],
    properties: {
      callType: { type: 'string' },
      costUsd: { type: 'number' },
      calls: { type: 'integer' },
      percentage: { type: 'integer' },
    },
  });

  app.addSchema({
    $id: 'AggregatedCosts',
    type: 'object',
    required: [
      'totalCostUsd',
      'totalCalls',
      'totalInputTokens',
      'totalOutputTokens',
      'monthlyBreakdown',
      'byModel',
      'byCallType',
    ],
    properties: {
      totalCostUsd: { type: 'number' },
      totalCalls: { type: 'integer' },
      totalInputTokens: { type: 'integer' },
      totalOutputTokens: { type: 'integer' },
      monthlyBreakdown: {
        type: 'array',
        items: { $ref: 'MonthlyCost#' },
      },
      byModel: {
        type: 'array',
        items: { $ref: 'ModelCost#' },
      },
      byCallType: {
        type: 'array',
        items: { $ref: 'CallTypeCost#' },
      },
    },
  });

  // Register routes
  await app.register(publicRoutes);
  await app.register(internalRoutes, { prefix: '/internal' });

  // OpenAPI spec endpoint
  app.get(
    '/openapi.json',
    {
      schema: {
        description: 'OpenAPI specification',
        tags: ['system'],
        hide: true,
      },
    },
    async (_req, reply) => {
      const spec = app.swagger();
      return await reply.type('application/json').send(spec);
    }
  );

  // Health check endpoint
  app.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            description: 'Service health status',
            type: 'object',
            required: ['status', 'serviceName', 'version', 'timestamp', 'checks'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              serviceName: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'status', 'latencyMs'],
                  properties: {
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
                    latencyMs: { type: 'number' },
                    details: { type: 'object', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const started = Date.now();
      const firestoreCheck = await checkFirestore();
      const checks: HealthCheck[] = [checkSecrets(REQUIRED_SECRETS), firestoreCheck];

      const response = buildHealthResponse(SERVICE_NAME, SERVICE_VERSION, checks);

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
