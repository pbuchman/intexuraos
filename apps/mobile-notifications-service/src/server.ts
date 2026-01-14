import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
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
<<<<<<< HEAD
import { setupSentryErrorHandler } from '@intexuraos/infra-sentry';
=======
import { createSentryStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
>>>>>>> origin/development
import { mobileNotificationsRoutes } from './routes/index.js';
import { validateConfigEnv } from './config.js';

const SERVICE_NAME = 'mobile-notifications-service';
const SERVICE_VERSION = '0.0.4';

/**
 * Check required secrets using service-specific validation.
 * Uses validateConfigEnv() which has service-specific validation logic.
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
      url: 'https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8114', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description:
          'IntexuraOS Mobile Notifications Service - Receive and store mobile device notifications',
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
        { name: 'mobile-notifications', description: 'Mobile notification management' },
        { name: 'webhooks', description: 'Webhook endpoints for mobile devices' },
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
            stream: createSentryStream(
              pino.multistream([
                pino.destination({ dest: 1, sync: false }),
              ])
            ),
          },
    disableRequestLogging: true,
  });

  // Capture raw body for debugging JSON parse errors
  // Only capture for webhook endpoint where we see these errors
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.url === '/mobile-notifications/webhooks') {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      const rawBody = Buffer.concat(chunks);
      // Store raw body on request for error handler to access
      (request as { rawBody?: string }).rawBody = rawBody.toString('utf8');
      // Return a new readable stream with the same data
      const { Readable } = await import('stream');
      return Readable.from(rawBody);
    }
    return payload;
  });

  setupSentryErrorHandler(app as unknown as FastifyInstance);

  // Register quiet health check logging (skips /health endpoint logs)
  registerQuietHealthCheckLogging(app);

  await app.register(intexuraFastifyPlugin);

  // Register core schemas for $ref usage in routes (Diagnostics, ErrorCode, ErrorBody)
  registerCoreSchemas(app);

  // CORS for cross-origin API access (web app + api-docs-hub)
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Register auth plugin (JWT validation)
  await app.register(fastifyAuthPlugin);

  // Register mobile notifications routes
  await app.register(mobileNotificationsRoutes);

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
