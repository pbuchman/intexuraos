/**
 * Shared Fastify bootstrap for IntexuraOS services.
 *
 * Replaces ~200 lines of per-service `server.ts` boilerplate (Fastify init +
 * cors + formbody + intexura plugin + auth plugin + Sentry error handler +
 * swagger + swagger-ui + quiet health logging + `/health` + `/openapi.json`)
 * with a single typed factory whose only required arguments are the service
 * identity, OpenAPI metadata, required secrets, and a `registerRoutes`
 * callback.
 *
 * Behavior is intentionally identical to the bespoke bootstrap in
 * `apps/user-service/src/server.ts` (the pilot reference): logger
 * configuration, plugin registration order, Sentry handler installation,
 * `/health` payload shape, and `/openapi.json` content-type are preserved.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifySwagger, { type FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { buildHealthResponse, checkSecrets, type HealthCheck } from './health.js';

/** OpenAPI server entry — `{ url, description }` from `@fastify/swagger`. */
export interface OpenApiServer {
  url: string;
  description: string;
}

/** OpenAPI tag entry — `{ name, description }` from `@fastify/swagger`. */
export interface OpenApiTag {
  name: string;
  description: string;
}

/** OpenAPI info — title/description/version surfaced on `/openapi.json`. */
export interface OpenApiInfo {
  title: string;
  description: string;
  version: string;
}

/** Function or value supplying a {@link HealthCheck}; resolved at /health time. */
export type HealthCheckProducer = () => HealthCheck | Promise<HealthCheck>;

export interface CreateFastifyAppOptions {
  /** Logical service name, surfaced via `/health.serviceName`. */
  serviceName: string;
  /** Service version string, surfaced via `/health.version`. */
  serviceVersion: string;
  /** OpenAPI `info` block. */
  openapiInfo: OpenApiInfo;
  /** OpenAPI `servers` list (Cloud Run + local typically). */
  openapiServers: readonly OpenApiServer[];
  /** OpenAPI `tags` list. */
  openapiTags: readonly OpenApiTag[];
  /**
   * Required environment variables for this service. Surfaced as a `secrets`
   * health check so `/health` reports `down` until they are configured.
   */
  requiredSecrets: readonly string[];
  /** Optional additional health checks (e.g. Firestore connectivity). */
  extraHealthChecks?: readonly HealthCheckProducer[];
  /** Service-specific route registration. */
  registerRoutes: (app: FastifyInstance) => Promise<void>;
  /**
   * Optional OpenAPI `components.schemas` overrides/additions. Typed loosely
   * via `Record<string, object>` so callers can supply schema objects in the
   * shape consumed by `@fastify/swagger` without importing
   * `openapi-types` directly.
   */
  additionalOpenapiSchemas?: Record<string, object>;
}

/**
 * Build a Fastify app pre-wired with the IntexuraOS plugin stack and standard
 * `/health` + `/openapi.json` routes. Callers register their own routes via
 * the `registerRoutes` callback.
 */
export async function createFastifyApp(opts: CreateFastifyAppOptions): Promise<FastifyInstance> {
  const isTestEnv = process.env['NODE_ENV'] === 'test';
  const app = Fastify({
    logger: isTestEnv
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
  await app.register(fastifyFormbody);
  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);

  setupSentryErrorHandler(app);
  registerCoreSchemas(app);

  const swaggerOptions: FastifyDynamicSwaggerOptions = {
    openapi: {
      openapi: '3.1.1',
      info: opts.openapiInfo,
      servers: [...opts.openapiServers],
      tags: [...opts.openapiTags],
      ...(opts.additionalOpenapiSchemas !== undefined
        ? // Cast through unknown to satisfy openapi-types' nominal SchemaObject
          // shape. Callers supply schema objects in the JSON-Schema dialect
          // already accepted by @fastify/swagger; we don't validate further.
          {
            components: {
              schemas: opts.additionalOpenapiSchemas as unknown as Record<string, never>,
            },
          }
        : {}),
    },
  };
  await app.register(fastifySwagger, swaggerOptions);
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await opts.registerRoutes(app);

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
      const checks: HealthCheck[] = [checkSecrets([...opts.requiredSecrets])];
      for (const producer of opts.extraHealthChecks ?? []) {
        checks.push(await Promise.resolve(producer()));
      }
      const response = buildHealthResponse(opts.serviceName, opts.serviceVersion, checks);
      void reply.header('x-health-duration-ms', String(Date.now() - started));
      return await reply.type('application/json').send(response);
    }
  );

  return await Promise.resolve(app);
}
