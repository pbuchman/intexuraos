import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { praxosFastifyPlugin, fastifyAuthPlugin } from '@praxos/common';
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
  return {
    name: 'secrets',
    status: 'ok',
    latencyMs: Date.now() - start,
    details: null,
  };
}

function checkNotion(): HealthCheck {
  const start = Date.now();
  return {
    name: 'notion',
    status: 'ok',
    latencyMs: Date.now() - start,
    details: null,
  };
}

function checkFirestore(): HealthCheck {
  const start = Date.now();
  return {
    name: 'firestore',
    status: 'ok',
    latencyMs: Date.now() - start,
    details: null,
  };
}

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  return {
    openapi: {
      info: {
        title: SERVICE_NAME,
        description: 'PraxOS Notion GPT Service - Integration layer for GPT Actions with Notion',
        version: SERVICE_VERSION,
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Step 5 stub auth: any token accepted, userId derived from first 12 chars. Step 6 will replace with JWT validation.',
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
          CreateNoteRequest: {
            type: 'object',
            required: ['title', 'content', 'idempotencyKey'],
            properties: {
              title: { type: 'string', minLength: 1 },
              content: { type: 'string', minLength: 1 },
              idempotencyKey: {
                type: 'string',
                minLength: 1,
                description: 'Unique key for idempotent note creation',
              },
            },
          },
          CreateNoteResponse: {
            type: 'object',
            properties: {
              created: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['id', 'url', 'title'],
              },
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
  const app = Fastify({ logger: true });

  await app.register(praxosFastifyPlugin);
  await app.register(fastifyAuthPlugin);

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
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
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
      const checks: HealthCheck[] = [checkSecrets(), checkNotion(), checkFirestore()];
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
