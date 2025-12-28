import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  intexuraFastifyPlugin,
  fastifyAuthPlugin,
  registerQuietHealthCheckLogging,
  type NotionLogger,
} from '@intexuraos/common';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import {
  checkSecrets,
  checkFirestore,
  checkNotionSdk,
  buildHealthResponse,
  createValidationErrorHandler,
  type HealthCheck,
} from '@intexuraos/http-server';
import { notionRoutes } from './routes/routes.js';
import { getServices } from './services.js';

const SERVICE_NAME = 'notion-service';
const SERVICE_VERSION = '0.0.1';

// Required secrets for this service
const REQUIRED_SECRETS = ['AUTH_JWKS_URL', 'AUTH_ISSUER', 'AUTH_AUDIENCE'];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  // Exactly two servers: Cloud Run deployment and local development
  const servers = [
    {
      url: 'https://intexuraos-notion-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8082', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: 'NotionService',
        description:
          'IntexuraOS Notion Service - Notion integration management (connect/disconnect/status) and webhooks',
        version: SERVICE_VERSION,
      },
      servers,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'JWT token validated via JWKS. Token must include valid iss (issuer), aud (audience), and sub (user ID) claims.',
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
              code: { $ref: '#/components/schemas/ErrorCode' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
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
          ConnectRequest: {
            type: 'object',
            required: ['notionToken', 'promptVaultPageId'],
            properties: {
              notionToken: {
                type: 'string',
                minLength: 1,
                description: 'Notion integration token (never returned in responses)',
              },
              promptVaultPageId: {
                type: 'string',
                minLength: 1,
                description: 'Notion page ID for the Prompt Vault',
              },
            },
          },
          ConnectResponse: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              promptVaultPageId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          StatusResponse: {
            type: 'object',
            properties: {
              configured: { type: 'boolean' },
              connected: { type: 'boolean' },
              promptVaultPageId: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time', nullable: true },
              updatedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
          DisconnectResponse: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              promptVaultPageId: { type: 'string' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          WebhookResponse: {
            type: 'object',
            properties: {
              received: { type: 'boolean' },
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
        { name: 'integrations', description: 'Notion integration management' },
        { name: 'webhooks', description: 'Webhook receivers' },
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
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  // Register quiet health check logging (skips /health endpoint logs)
  registerQuietHealthCheckLogging(app);

  // Create NotionLogger adapter from Fastify logger
  const notionLogger: NotionLogger = {
    info: (msg, data) => {
      app.log.info({ notionApi: true, ...data }, msg);
    },
    warn: (msg, data) => {
      app.log.warn({ notionApi: true, ...data }, msg);
    },
    error: (msg, data) => {
      app.log.error({ notionApi: true, ...data }, msg);
    },
  };

  // Initialize services with the logger (must be done early, before routes use them)
  getServices(notionLogger);

  // CORS for cross-origin API access (api-docs-hub, Swagger UI)
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  // Ensure Fastify validation errors are returned in IntexuraOS envelope
  app.setErrorHandler(createValidationErrorHandler());

  // Register core schemas for $ref usage in routes (Diagnostics, ErrorCode, ErrorBody)
  registerCoreSchemas(app);

  // Register service-specific schemas
  app.addSchema({
    $id: 'ConnectRequest',
    type: 'object',
    required: ['notionToken', 'promptVaultPageId'],
    properties: {
      notionToken: {
        type: 'string',
        minLength: 1,
        description: 'Notion integration token (never returned in responses)',
      },
      promptVaultPageId: {
        type: 'string',
        minLength: 1,
        description: 'Notion page ID for the Prompt Vault',
      },
    },
  });

  app.addSchema({
    $id: 'ConnectResponse',
    type: 'object',
    properties: {
      connected: { type: 'boolean' },
      promptVaultPageId: { type: 'string' },
      pageTitle: { type: 'string', description: 'Title of the validated Notion page' },
      pageUrl: { type: 'string', description: 'URL of the validated Notion page' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  });

  app.addSchema({
    $id: 'StatusResponse',
    type: 'object',
    properties: {
      configured: { type: 'boolean' },
      connected: { type: 'boolean' },
      promptVaultPageId: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time', nullable: true },
      updatedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  });

  app.addSchema({
    $id: 'DisconnectResponse',
    type: 'object',
    properties: {
      connected: { type: 'boolean' },
      promptVaultPageId: { type: 'string' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  });

  app.addSchema({
    $id: 'WebhookResponse',
    type: 'object',
    properties: {
      received: { type: 'boolean' },
    },
  });

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Register notion routes
  await app.register(notionRoutes);

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

  // Health endpoint (NOT wrapped in envelope per api-contracts.md)
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
      const checks: HealthCheck[] = [
        checkSecrets(REQUIRED_SECRETS),
        checkNotionSdk(),
        firestoreCheck,
      ];

      const response = buildHealthResponse(SERVICE_NAME, SERVICE_VERSION, checks);

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
