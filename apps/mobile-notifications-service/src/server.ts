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
import { type HealthCheck, registerHealthCheck } from '@intexuraos/http-server';
import { firestoreHealthCheck } from '@intexuraos/infra-firestore';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { mobileNotificationsRoutes } from './routes/index.js';
import { validateConfigEnv } from './config.js';

const SERVICE_NAME = 'mobile-notifications-service';
const SERVICE_VERSION = '0.0.4';

/**
 * Probe required secrets using this service's bespoke validation logic
 * (`validateConfigEnv`). Wraps the validator in the functional `HealthCheck`
 * shape consumed by `registerHealthCheck`.
 */
function configEnvHealthCheck(): HealthCheck {
  return {
    name: 'secrets',
    check: (): Promise<{ ok: true } | { ok: false; detail?: string }> => {
      const missing = validateConfigEnv();
      if (missing.length === 0) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, detail: `missing: ${missing.join(', ')}` });
    },
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
            stream: createLogStream(),
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
  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: [configEnvHealthCheck(), firestoreHealthCheck()],
  });

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
