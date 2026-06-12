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
import { registerHealthCheck, secretsHealthCheck } from '@intexuraos/http-server';
import { firestoreHealthCheck } from '@intexuraos/infra-firestore';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { fishingAssistantRoutes } from './routes/index.js';

const SERVICE_NAME = 'fishing-assistant-service';
const SERVICE_VERSION = '0.0.4';

const REQUIRED_SECRETS = ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENAI_APP_API_KEY'];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Fishing Assistant Service - user-scoped RAG over fishing knowledge',
        version: SERVICE_VERSION,
      },
      servers: [
        {
          url: 'https://intexuraos-fishing-assistant-service-cj44trunra-lm.a.run.app',
          description: 'Cloud (Development)',
        },
        { url: 'http://localhost:8119', description: 'Development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          internalAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Internal-Auth',
          },
        },
      },
      tags: [
        { name: 'system', description: 'System endpoints' },
        { name: 'fishing-assistant', description: 'Fishing Assistant endpoints' },
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

  registerQuietHealthCheckLogging(app);

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  setupSentryErrorHandler(app as unknown as FastifyInstance);

  registerCoreSchemas(app);

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(fishingAssistantRoutes);

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

  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: [secretsHealthCheck(REQUIRED_SECRETS), firestoreHealthCheck()],
  });

  return await Promise.resolve(app);
}
