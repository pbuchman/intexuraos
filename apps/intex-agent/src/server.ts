import fastifyCors from '@fastify/cors';
import fastifySwagger, { type FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { registerHealthCheck, secretsHealthCheck } from '@intexuraos/http-server';
import { firestoreHealthCheck } from '@intexuraos/infra-firestore';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import Fastify, { type FastifyInstance } from 'fastify';
import { createInternalRoutes } from './routes/internalRoutes.js';
import { createMatrixCorpusRoutes } from './routes/matrixCorpusRoutes.js';
import { preferencesRoutes } from './routes/preferencesRoutes.js';
import { promptPreferencesRoutes } from './routes/promptPreferencesRoutes.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { testConversationRoutes } from './routes/testConversationRoutes.js';
import { createTestRunRoutes } from './routes/testRunRoutes.js';
import { getServices } from './services.js';

const SERVICE_NAME = 'intex-agent';
const SERVICE_VERSION = '0.0.1';

const REQUIRED_SECRETS = ['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const serviceUrl = process.env['INTEXURAOS_SERVICE_URL'] ?? 'http://localhost:8080';

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Intex Agent - WhatsApp Assistant sessions and tools',
        version: SERVICE_VERSION,
      },
      servers: [
        { url: serviceUrl, description: serviceUrl.includes('localhost') ? 'Local' : 'Cloud' },
      ],
      components: {
        schemas: {
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
        { name: 'system', description: 'System endpoints' },
        { name: 'intex-agent', description: 'WhatsApp Assistant session endpoints' },
      ],
    },
  };
}

export async function buildServer(testLoggerStream?: NodeJS.WritableStream): Promise<FastifyInstance> {
  const app = Fastify({
    logger: testLoggerStream
      ? {
          level: process.env['LOG_LEVEL'] ?? 'info',
          stream: testLoggerStream,
        }
      : process.env['NODE_ENV'] === 'test'
        ? false
        : {
            level: process.env['LOG_LEVEL'] ?? 'info',
            stream: createLogStream(),
          },
    disableRequestLogging: true,
  });

  const privateRequestPathPrefixes = [
    '/internal/intex-agent/messages',
    '/internal/matrix-corpus/',
    '/internal/test-runs/',
    '/test-runs',
  ] as const;
  registerQuietHealthCheckLogging(app, { privatePathPrefixes: privateRequestPathPrefixes });

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  setupSentryErrorHandler(app as unknown as FastifyInstance, {
    privatePathPrefixes: privateRequestPathPrefixes,
  });

  registerCoreSchemas(app);

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(sessionRoutes);
  await app.register(promptPreferencesRoutes);
  await app.register(preferencesRoutes);
  const services = getServices();
  await app.register(
    createInternalRoutes({
      handleOrdinary: async (input) => await services.incomingMessageHandler.handle(input),
      matrixCorpus: services.matrixCorpus ?? null,
    })
  );
  if (services.matrixCorpus !== undefined)
    await app.register(createMatrixCorpusRoutes(services.matrixCorpus));
  if (services.testRuns !== undefined) {
    await app.register(createTestRunRoutes(services.testRuns));
    services.testRuns.sweepScheduler.start();
    app.addHook('onClose', async () => {
      await services.testRuns?.sweepScheduler.stop();
    });
  }
  await app.register(testConversationRoutes);

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
