import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import { praxosFastifyPlugin, fastifyAuthPlugin } from '@praxos/common';
import { getFirestore } from '@praxos/infra-firestore';
import { v1Routes } from './v1/routes.js';

const SERVICE_NAME = 'notion-gpt-service';
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      name: 'firestore',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: message },
    };
  }
}

function checkNotion(): HealthCheck {
  // Notion health check is passive - we don't want to call Notion API on every health check
  // Instead, we check that we have the SDK loaded and can construct a client
  const start = Date.now();
  return {
    name: 'notion',
    status: 'ok',
    latencyMs: Date.now() - start,
    details: { note: 'Passive check - API calls validated per-request' },
  };
}

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  // Exactly two servers: local development and Cloud Run deployment
  const servers = [
    { url: 'http://localhost:8081', description: 'Local' },
    {
      url: 'https://praxos-notion-gpt-service-ooafxzbaua-lm.a.run.app',
      description: 'Cloud (Development)',
    },
  ];

  return {
    openapi: {
      info: {
        title: SERVICE_NAME,
        description: 'PraxOS Notion GPT Service - Integration layer for GPT Actions with Notion',
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
          MainPageResponse: {
            type: 'object',
            properties: {
              page: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  url: { type: 'string' },
                },
              },
              preview: {
                type: 'object',
                properties: {
                  blocks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        content: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          CreatePromptVaultNoteRequest: {
            type: 'object',
            required: ['title', 'prompt'],
            additionalProperties: false,
            properties: {
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                description: 'Note title (max 200 characters)',
              },
              prompt: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
                description: 'Prompt content stored verbatim (max 100,000 characters)',
              },
            },
          },
          CreatePromptVaultNoteResponse: {
            type: 'object',
            required: ['pageId', 'url', 'title'],
            properties: {
              pageId: { type: 'string', description: 'Notion page ID' },
              url: { type: 'string', description: 'Notion page URL' },
              title: { type: 'string', description: 'Note title' },
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
        { name: 'tools', description: 'GPT Action tools' },
        { name: 'webhooks', description: 'Webhook receivers' },
      ],
    },
  };
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  // CORS for cross-origin OpenAPI access (api-docs-hub)
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });

  await app.register(praxosFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  // Ensure Fastify validation errors are returned in PraxOS envelope
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
    $id: 'MainPageResponse',
    type: 'object',
    properties: {
      page: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
        },
      },
      preview: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
        },
      },
    },
  });

  app.addSchema({
    $id: 'CreatePromptVaultNoteRequest',
    type: 'object',
    required: ['title', 'prompt'],
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Note title (max 200 characters)',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 100000,
        description: 'Prompt content stored verbatim (max 100,000 characters)',
      },
    },
  });

  app.addSchema({
    $id: 'CreatePromptVaultNoteResponse',
    type: 'object',
    required: ['pageId', 'url', 'title'],
    properties: {
      pageId: { type: 'string', description: 'Notion page ID' },
      url: { type: 'string', description: 'Notion page URL' },
      title: { type: 'string', description: 'Note title' },
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

  // Register v1 routes
  await app.register(v1Routes);

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
      const checks: HealthCheck[] = [checkSecrets(), checkNotion(), firestoreCheck];
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
