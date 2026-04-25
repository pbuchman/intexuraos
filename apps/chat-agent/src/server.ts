import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import {
  buildHealthResponse,
  checkFirestore,
  checkSecrets,
  type HealthCheck,
} from '@intexuraos/http-server';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { chatRoutes, guestSessionRoutes } from './routes/index.js';

const SERVICE_NAME = 'chat-agent';
const SERVICE_VERSION = '0.1.0';

const REQUIRED_SECRETS: string[] = [
  'INTEXURAOS_OPENAI_APP_API_KEY',
];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const servers = [
    {
      url: 'https://intexuraos-chat-agent-xxxx.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8080', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Chat Agent Service - In-app AI assistant with RAG',
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
              'NOT_IMPLEMENTED',
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
              endpointCalled: { type: 'string' },
            },
          },
          HealthResponse: {
            type: 'object',
            required: ['status', 'serviceName', 'version', 'timestamp', 'checks'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              serviceName: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'array',
                items: { $ref: '#/components/schemas/HealthCheck' },
              },
            },
          },
          HealthCheck: {
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
      tags: [
        { name: 'system', description: 'System endpoints (health, docs)' },
        { name: 'chat', description: 'Chat endpoints' },
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
    // Cloud Run terminates TLS and forwards client IP via X-Forwarded-For;
    // trust the proxy so request.ip resolves to the real client.
    trustProxy: true,
  });

  registerQuietHealthCheckLogging(app);

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  // IP-based floor rate limit. Applies globally; per-route `config.rateLimit`
  // overrides allow stricter limits (e.g. POST /guest-session is 10/min).
  //
  // The errorResponseBuilder returns the same shape as `reply.fail('RATE_LIMITED', …)`
  // — emitted directly here because @fastify/rate-limit throws via the error path,
  // and the global error handler set by infra-sentry rewrites unhandled errors to 500.
  await app.register(fastifyRateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    skip: (req) =>
      req.method === 'OPTIONS' ||
      req.method === 'HEAD' ||
      req.url.startsWith('/health'),
    errorResponseBuilder: (request, context) => {
      const error = new Error(
        `Rate limit exceeded, retry in ${context.after}`
      ) as Error & { statusCode?: number; code?: string };
      error.statusCode = context.statusCode;
      error.code = 'RATE_LIMITED';
      return error;
    },
  });

  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  setupSentryErrorHandler(app as unknown as FastifyInstance);

  // The Sentry error handler returns 500 for any error it doesn't specifically
  // recognize, which would otherwise mask 429 responses thrown by
  // @fastify/rate-limit. Wrap the previously-installed handler so rate-limit
  // errors short-circuit to a proper RATE_LIMITED response and everything else
  // continues through the Sentry path.
  const upstreamErrorHandler = app.errorHandler;
  app.setErrorHandler(async (error, request, reply) => {
    const errorWithStatus = error as Error & { statusCode?: number };
    if (errorWithStatus.statusCode === 429) {
      return await reply.fail(
        'RATE_LIMITED',
        errorWithStatus.message.length > 0
          ? errorWithStatus.message
          : 'Rate limit exceeded'
      );
    }
    return await upstreamErrorHandler(error, request, reply);
  });

  registerCoreSchemas(app);

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Register chat routes
  await app.register(chatRoutes);
  await app.register(guestSessionRoutes);

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
