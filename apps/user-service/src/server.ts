import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import { fastifyAuthPlugin, intexuraFastifyPlugin, registerQuietHealthCheckLogging, } from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { buildHealthResponse, checkFirestore, checkSecrets, type HealthCheck, } from '@intexuraos/http-server';
import { authRoutes } from './routes/routes.js';

const SERVICE_NAME = 'user-service';
const SERVICE_VERSION = '0.0.1';

// Required secrets for this service
const REQUIRED_SECRETS = [
  'AUTH0_DOMAIN',
  'AUTH0_CLIENT_ID',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  // Exactly two servers: Cloud Run deployment and local development
  const servers = [
    {
      url: 'https://intexuraos-user-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8080', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Authentication Service - Device Authorization Flow helpers',
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
        { name: 'auth', description: 'Device Authorization Flow helpers' },
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
    disableRequestLogging: true, // We'll handle logging ourselves to skip health checks
  });

  // Register quiet health check logging (skips /health endpoint logs)
  registerQuietHealthCheckLogging(app);

  // CORS for cross-origin API access from web app
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  // Support application/x-www-form-urlencoded (OAuth2 standard)
  await app.register(fastifyFormbody);

  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  // Ensure Fastify validation errors are returned in IntexuraOS envelope
  app.setErrorHandler(async (error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      Array.isArray((error as { validation?: unknown }).validation)
    ) {
      const validation = (
        error as {
          validation: { instancePath?: string; message?: string }[];
          message?: string;
        }
      ).validation;

      const errors = validation.map((v) => {
        // When instancePath is empty, extract field name from error message if possible
        // Example: "must have required property 'device_code'" -> "device_code"
        let path = (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
        if (path === '') {
          const requiredMatch = /must have required property '([^']+)'/.exec(v.message ?? '');
          path = requiredMatch?.[1] ?? '<root>';
        }

        return {
          path,
          message: v.message ?? 'Invalid value',
        };
      });

      reply.status(400);
      return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(500);
    return await reply.fail('INTERNAL_ERROR', 'Internal error');
  });

  // Register shared schemas for $ref usage in routes (Diagnostics, ErrorCode, ErrorBody)
  registerCoreSchemas(app);

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Register auth routes
  await app.register(authRoutes);

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

      // include request duration as a header-level concern handled by logger;
      // health body stays contract-shaped
      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
