import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { intexuraFastifyPlugin, registerQuietHealthCheckLogging } from '@intexuraos/common-http';
import { type HealthCheck, registerHealthCheck } from '@intexuraos/http-server';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import type { Config } from './config.js';

const SERVICE_NAME = 'api-docs-hub';
const SERVICE_VERSION = '0.0.5';

/**
 * Probe service configuration: `config.openApiSources` must be non-empty
 * for the API docs hub to serve anything useful.
 */
function configHealthCheck(config: Config): HealthCheck {
  return {
    name: 'config',
    check: (): Promise<{ ok: true } | { ok: false; detail?: string }> => {
      const sourceCount = config.openApiSources.length;
      if (sourceCount > 0) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, detail: 'no OpenAPI sources configured' });
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
             
            stream: createLogStream(),
             
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
  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: [configHealthCheck(config)],
  });

  return await Promise.resolve(app);
}
