import fastifyCors from '@fastify/cors';
import fastifySwagger, { type FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { registerHealthCheck, secretsHealthCheck, type HealthCheck } from '@intexuraos/http-server';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { messageDigestRoutes } from './routes/messageDigestRoutes.js';
import { internalMessageDigestRoutes } from './routes/internalMessageDigestRoutes.js';
import { internalLegacyDigestRoutes } from './routes/internalLegacyDigestRoutes.js';
import { legacyAliasRoutes } from './routes/legacyAliasRoutes.js';

const SERVICE_NAME = 'message-digest-service';
const SERVICE_VERSION = '3.8.0';

export const MESSAGE_DIGEST_REQUIRED_SECRETS = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
] as const;

export interface BuildServerOptions {
  healthChecks?: HealthCheck[] | undefined;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env['NODE_ENV'] === 'test'
        ? false
        : {
            level: process.env['LOG_LEVEL'] ?? 'info',
            stream: createLogStream(),
          },
    disableRequestLogging: true,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  registerQuietHealthCheckLogging(app);
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  });
  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);
  setupSentryErrorHandler(app as unknown as FastifyInstance);
  registerCoreSchemas(app);

  await app.register(fastifySwagger, openApiOptions());
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await app.register(messageDigestRoutes);
  await app.register(legacyAliasRoutes);
  await app.register(internalMessageDigestRoutes);
  await app.register(internalLegacyDigestRoutes);

  app.get(
    '/openapi.json',
    {
      schema: {
        description: 'OpenAPI specification',
        tags: ['system'],
        hide: true,
      },
    },
    async (_request, reply) => await reply.type('application/json').send(app.swagger())
  );

  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: options.healthChecks ?? [secretsHealthCheck([...MESSAGE_DIGEST_REQUIRED_SECRETS])],
  });

  return await Promise.resolve(app);
}

function openApiOptions(): FastifyDynamicSwaggerOptions {
  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS WhatsApp Message Digest Service',
        version: SERVICE_VERSION,
      },
      servers: [{ url: 'http://localhost:8135', description: 'Local development' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          internalAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Internal-Auth',
          },
        },
      },
      tags: [
        { name: 'system', description: 'System endpoints' },
        { name: 'message-digests', description: 'WhatsApp Message Digest endpoints' },
        { name: 'internal', description: 'Internal scheduler and Pub/Sub endpoints' },
      ],
    },
  };
}
