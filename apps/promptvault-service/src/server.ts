import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  praxosFastifyPlugin,
  fastifyAuthPlugin,
  getErrorMessage,
  getFirestore,
  type NotionLogger,
} from '@praxos/common';
import { v1Routes } from './routes/v1/routes.js';
import { getServices } from './services.js';

const SERVICE_NAME = 'promptvault-service';
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
      // LEGACY URL: This URL will be updated when the service is redeployed with the new name.
      // The Cloud Run service name change requires a manual redeployment.
      url: 'https://praxos-promptvault-service-ooafxzbaua-lm.a.run.app',
      description: 'Cloud (Development) - Legacy URL',
    },
    { url: 'http://localhost:8081', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: 'PromptVaultService',
        description:
          'PraxOS PromptVault Service - CRUD operations for PromptVault prompts backed by Notion',
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
          // Prompt API schemas
          Prompt: {
            type: 'object',
            required: ['id', 'title', 'prompt'],
            properties: {
              id: { type: 'string', description: 'Unique prompt identifier' },
              title: { type: 'string', description: 'Prompt title' },
              prompt: { type: 'string', description: 'Prompt content' },
              createdAt: {
                type: 'string',
                format: 'date-time',
                description: 'Creation timestamp (ISO 8601)',
              },
              updatedAt: {
                type: 'string',
                format: 'date-time',
                description: 'Last update timestamp (ISO 8601)',
              },
            },
          },
          CreatePromptRequest: {
            type: 'object',
            required: ['title', 'prompt'],
            additionalProperties: false,
            properties: {
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                description: 'Prompt title (max 200 characters)',
              },
              prompt: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
                description: 'Prompt content (max 100,000 characters)',
              },
            },
          },
          UpdatePromptRequest: {
            type: 'object',
            additionalProperties: false,
            description: 'At least one of title or prompt must be provided',
            properties: {
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                description: 'New prompt title (max 200 characters)',
              },
              prompt: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
                description: 'New prompt content (max 100,000 characters)',
              },
            },
          },
          PromptResponse: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { $ref: '#/components/schemas/Prompt' },
            },
          },
          PromptsListResponse: {
            type: 'object',
            required: ['prompts'],
            properties: {
              prompts: {
                type: 'array',
                items: { $ref: '#/components/schemas/Prompt' },
              },
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
        { name: 'tools', description: 'GPT Action tools for prompt CRUD' },
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

  // Prompt API schemas
  app.addSchema({
    $id: 'Prompt',
    type: 'object',
    required: ['id', 'title', 'prompt'],
    properties: {
      id: { type: 'string', description: 'Unique prompt identifier' },
      title: { type: 'string', description: 'Prompt title' },
      prompt: { type: 'string', description: 'Prompt content' },
      url: { type: 'string', format: 'uri', description: 'URL to view the prompt in Notion' },
      createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
      updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
    },
  });

  app.addSchema({
    $id: 'CreatePromptRequest',
    type: 'object',
    required: ['title', 'prompt'],
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Prompt title (max 200 characters)',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 100000,
        description: 'Prompt content (max 100,000 characters)',
      },
    },
  });

  app.addSchema({
    $id: 'UpdatePromptRequest',
    type: 'object',
    additionalProperties: false,
    description: 'At least one of title or prompt must be provided',
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'New prompt title (max 200 characters)',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 100000,
        description: 'New prompt content (max 100,000 characters)',
      },
    },
  });

  app.addSchema({
    $id: 'PromptResponse',
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { $ref: 'Prompt#' },
    },
  });

  app.addSchema({
    $id: 'PromptsListResponse',
    type: 'object',
    required: ['prompts'],
    properties: {
      prompts: {
        type: 'array',
        items: { $ref: 'Prompt#' },
      },
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
