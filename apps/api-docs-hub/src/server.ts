import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { intexuraFastifyPlugin, registerQuietHealthCheckLogging } from '@intexuraos/common-http';
import { buildHealthResponse, type HealthCheck } from '@intexuraos/http-server';
import { createSentryStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import type { Config } from './config.js';

const SERVICE_NAME = 'api-docs-hub';
const SERVICE_VERSION = '0.0.4';

/**
 * Check service configuration (config.openApiSources must be non-empty).
 */
function checkConfig(config: Config): HealthCheck {
  const start = Date.now();
  return {
    name: 'config',
    status: config.openApiSources.length > 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: {
      sourceCount: config.openApiSources.length,
    },
  };
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description:
          'IntexuraOS API Documentation Hub - Aggregated OpenAPI documentation for all IntexuraOS services',
        version: SERVICE_VERSION,
      },
      components: {},
      tags: [{ name: 'system', description: 'System endpoints' }],
    },
  };
}

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env['NODE_ENV'] === 'test'
        ? false
        : {
            level: process.env['LOG_LEVEL'] ?? 'info',
            /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Pino multistream types are incompatible */
            stream: createSentryStream(
              pino.multistream([
                pino.destination({ dest: 1, sync: false }),
              ])
            ),
            /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
          },
    disableRequestLogging: true, // We'll handle logging ourselves to skip health checks
  });

  // Register quiet health check logging (skips /health endpoint logs)
  registerQuietHealthCheckLogging(app);

  await app.register(intexuraFastifyPlugin);

  setupSentryErrorHandler(app as unknown as FastifyInstance);

  await app.register(fastifySwagger, buildOpenApiOptions());

  // Configure Swagger UI with multiple specs using the "urls" configuration
  const urls = config.openApiSources.map((source) => ({
    name: source.name,
    url: source.url,
  }));

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      urls,
    },
  });

  // Health endpoint
  app.get('/health', async (_req, reply) => {
    const started = Date.now();
    const checks: HealthCheck[] = [checkConfig(config)];

    const response = buildHealthResponse(SERVICE_NAME, SERVICE_VERSION, checks);

    void reply.header('x-health-duration-ms', String(Date.now() - started));
    return await reply.type('application/json').send(response);
  });

  return await Promise.resolve(app);
}
