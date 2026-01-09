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
import type { NotionLogger } from '@intexuraos/infra-notion';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import {
  buildHealthResponse,
  checkFirestore,
  checkNotionSdk,
  checkSecrets,
  createValidationErrorHandler,
  type HealthCheck,
} from '@intexuraos/http-server';
import { promptVaultRoutes } from './routes/routes.js';
import { getServices } from './services.js';

const SERVICE_NAME = 'promptvault-service';
const SERVICE_VERSION = '0.0.4';

// Required secrets for this service
const REQUIRED_SECRETS = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  // Exactly two servers: Cloud Run deployment and local development
  const servers = [
    {
      url: 'https://intexuraos-promptvault-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8111', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: 'PromptVaultService',
        description:
          'IntexuraOS PromptVault Service - CRUD operations for PromptVault prompts backed by Notion',
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

  // Register prompt vault routes
  await app.register(promptVaultRoutes);

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
