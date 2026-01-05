import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { buildHealthResponse, checkFirestore, type HealthCheck } from '@intexuraos/http-server';
import { dataInsightsRoutes } from './routes/index.js';
import { validateConfigEnv } from './config.js';

const SERVICE_NAME = 'data-insights-service';
const SERVICE_VERSION = '0.0.1';

/**
 * Check required secrets using service-specific validation.
 */
function checkSecrets(): HealthCheck {
  const start = Date.now();
  const missing = validateConfigEnv();

  return {
    name: 'secrets',
    status: missing.length === 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: missing.length > 0 ? { missing } : null,
  };
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const servers = [
    {
      url: 'https://intexuraos-data-insights-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8119', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Data Insights Service - Custom data sources management',
        version: SERVICE_VERSION,
      },
      servers,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
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
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
          Diagnostics: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              durationMs: { type: 'number' },
            },
          },
        },
      },
      tags: [
        { name: 'data-sources', description: 'Custom data sources management' },
        { name: 'composite-feeds', description: 'Composite feed management' },
        { name: 'system', description: 'System endpoints' },
      ],
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
          },
    disableRequestLogging: true,
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as {
      statusCode?: number;
      validation?: unknown;
      validationContext?: string;
      message: string;
    };

    const statusCode = fastifyError.statusCode ?? 500;
    const errorCode = statusCode >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';

    request.log.error(
      {
        err: error,
        requestId: request.id,
        url: request.url,
        method: request.method,
        statusCode,
        validation: fastifyError.validation,
        validationContext: fastifyError.validationContext,
      },
      `Request error: ${fastifyError.message}`
    );

    return reply.status(statusCode).send({
      success: false,
      error: {
        code: errorCode,
        message: fastifyError.message,
        details: fastifyError.validation ?? undefined,
      },
      diagnostics: {
        requestId: request.id,
        durationMs: Date.now() - request.startTime,
      },
    });
  });

  registerQuietHealthCheckLogging(app);

  await app.register(intexuraFastifyPlugin);
  registerCoreSchemas(app);

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(fastifyAuthPlugin);
  await app.register(dataInsightsRoutes);

  // Health endpoint
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
      const checks: HealthCheck[] = [checkSecrets(), firestoreCheck];

      const response = buildHealthResponse(SERVICE_NAME, SERVICE_VERSION, checks);

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  // OpenAPI JSON endpoint
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

  return await Promise.resolve(app);
}
