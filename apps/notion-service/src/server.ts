import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  intexuraFastifyPlugin,
  fastifyAuthPlugin,
  getErrorMessage,
  getFirestore,
  registerQuietHealthCheckLogging,
  type NotionLogger,
} from '@intexuraos/common';
import { notionRoutes } from './routes/routes.js';
import { getServices } from './services.js';

const SERVICE_NAME = 'notion-service';
const SERVICE_VERSION = '0.0.1';

type HealthStatus = 'ok' | 'degraded' | 'down';

interface HealthCheck {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

interface HealthResponse {
  status: HealthStatus;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheck[];
}

function checkSecrets(): HealthCheck {
  const start = Date.now();
  const required = ['AUTH_JWKS_URL', 'AUTH_ISSUER', 'AUTH_AUDIENCE'];
  const missing = required.filter((k) => process.env[k] === undefined || process.env[k] === '');

  return {
    name: 'secrets',
    status: missing.length === 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: missing.length > 0 ? { missing } : null,
  };
}

async function checkFirestore(): Promise<HealthCheck> {
  const start = Date.now();

  // Skip actual Firestore check in test environment
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] !== undefined) {
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: { note: 'Skipped in test environment' },
    };
  }

  try {
    const db = getFirestore();
    // Simple connectivity check with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Firestore health check timed out'));
      }, 3000);
    });

    await Promise.race([db.listCollections(), timeoutPromise]);
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: null,
    };
  } catch (error) {
    return {
      name: 'firestore',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: getErrorMessage(error) },
    };
  }
}

function checkNotionSdk(): HealthCheck {
  // Notion health check is passive - we cannot call Notion API without user credentials.
  // Notion connections are per-user, not service-level.
  // We verify that the SDK is available (would fail at import if not).
  const start = Date.now();
  try {
    // Verify @notionhq/client is available by checking our adapter module loaded
    // This is a compile-time guarantee, but we include it for completeness
    return {
      name: 'notion-sdk',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: {
        mode: 'passive',
        reason: 'Notion credentials are per-user; API validated per-request',
      },
    };
  } catch {
    return {
      name: 'notion-sdk',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: 'Notion SDK not available' },
    };
  }
}

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

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
    logger: true,
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
  app.setErrorHandler(async (error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      Array.isArray((error as { validation?: unknown }).validation)
    ) {
      const validation = (
        error as {
          validation: {
            instancePath?: string;
            params?: { missingProperty?: string };
            message?: string;
          }[];
          message?: string;
        }
      ).validation;

      const errors = validation.map((v) => {
        const rawPath = (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
        // When a required top-level property is missing, instancePath="" and missingProperty has the field name
        const path = rawPath === '' ? (v.params?.missingProperty ?? 'body') : rawPath;

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

  // Register shared schemas for $ref usage in routes
  app.addSchema({
    $id: 'Diagnostics',
    type: 'object',
    properties: {
      requestId: { type: 'string' },
      durationMs: { type: 'number' },
      downstreamStatus: { type: 'integer' },
      downstreamRequestId: { type: 'string' },
      endpointCalled: { type: 'string' },
    },
  });

  app.addSchema({
    $id: 'ErrorCode',
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
  });

  app.addSchema({
    $id: 'ErrorBody',
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: { $ref: 'ErrorCode#' },
      message: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    },
  });

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
      const checks: HealthCheck[] = [checkSecrets(), checkNotionSdk(), firestoreCheck];
      const status = computeOverallStatus(checks);

      const response: HealthResponse = {
        status,
        serviceName: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString(),
        checks: checks.map((c) => c),
      };

      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
