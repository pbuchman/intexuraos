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
} from '@intexuraos/common';
import { validateConfigEnv, type Config } from './config.js';
import { initServices } from './services.js';
import { v1Routes } from './routes/v1/index.js';

const SERVICE_NAME = 'srt-service';
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
  const missing = validateConfigEnv();

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

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const servers = [
    {
      url: 'https://intexuraos-srt-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8085', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description:
          'Speech Recognition/Transcription Service API. Internal service for transcribing audio via Speechmatics.',
        version: SERVICE_VERSION,
      },
      servers,
      tags: [
        {
          name: 'transcription',
          description: 'Transcription job management endpoints',
        },
        { name: 'health', description: 'Health check endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Google-signed ID token for service-to-service auth',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  };
}

/**
 * Creates and configures the Fastify server instance.
 */
export async function createServer(config: Config): Promise<FastifyInstance> {
  // Initialize service container with config
  initServices({
    speechmaticsApiKey: config.speechmaticsApiKey,
    gcpProjectId: config.gcpProjectId,
    audioStoredSubscription: config.audioStoredSubscription,
    transcriptionCompletedTopic: config.transcriptionCompletedTopic,
  });

  const app = Fastify({
    logger: true,
    disableRequestLogging: true,
  });

  // Register quiet health check logging
  registerQuietHealthCheckLogging(app);

  // Register core plugins
  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  // OpenAPI documentation
  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // CORS
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  // Health check endpoint
  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        operationId: 'healthCheck',
        summary: 'Health check',
        description: 'Returns the health status of the service and its dependencies.',
        tags: ['health'],
        response: {
          200: {
            description: 'Service health status',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              serviceName: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'array',
                items: {
                  type: 'object',
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
    async (_request, reply) => {
      const checks = [checkSecrets(), await checkFirestore()];
      const status = computeOverallStatus(checks);

      return await reply.code(status === 'ok' ? 200 : 503).send({
        status,
        serviceName: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString(),
        checks,
      });
    }
  );

  // OpenAPI JSON endpoint
  app.get(
    '/openapi.json',
    {
      schema: {
        description: 'OpenAPI specification',
        tags: ['health'],
        hide: true,
      },
    },
    async (_req, reply) => {
      const spec = app.swagger();
      return await reply.type('application/json').send(spec);
    }
  );

  // Register v1 routes
  await app.register(v1Routes);

  return await app;
}
