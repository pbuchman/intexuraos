import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { praxosFastifyPlugin } from '@praxos/common';
import type { Config } from './config.js';

const SERVICE_NAME = 'api-docs-hub';
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

function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

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
      info: {
        title: SERVICE_NAME,
        description:
          'PraxOS API Documentation Hub - Aggregated OpenAPI documentation for all PraxOS services',
        version: SERVICE_VERSION,
      },
      components: {},
      tags: [{ name: 'system', description: 'System endpoints' }],
    },
  };
}

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(praxosFastifyPlugin);

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
  });

  return await Promise.resolve(app);
}
