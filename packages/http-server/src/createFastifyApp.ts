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

/**
 * Accepted shape of an entry in `components.schemas`. Mirrors the structural
 * type that `@fastify/swagger` accepts at registration time without naming
 * the (overly strict) `openapi-types` `SchemaObject` directly — that type
 * forbids `ReferenceObject` in some positions and is incompatible with
 * `as const` literal schemas (`required: readonly [...]`).
 */
export type OpenApiSchemaEntry = Record<string, unknown>;
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
   * Optional OpenAPI `components.schemas` overrides/additions. Each entry is
   * a JSON-Schema-shaped object (or `$ref` reference) accepted by
   * `@fastify/swagger`. We type entries as `Record<string, unknown>` rather
   * than `openapi-types`' nominal `SchemaObject` because the latter forbids
   * `ReferenceObject` in some positions and is incompatible with the
   * literal-readonly schemas common in app `server.ts` files
   * (`required: readonly [...]`). `@fastify/swagger` accepts any shape that
   * matches the OpenAPI 3.x JSON-Schema dialect at registration time.
   */
  additionalOpenapiSchemas?: Record<string, OpenApiSchemaEntry>;
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

  // The openapi options shape transitively pulls in
  // `OpenAPIV3.ComponentsObject | OpenAPIV3_1.ComponentsObject`. With
  // `exactOptionalPropertyTypes: true` the union is non-assignable to either
  // side because v3.0 and v3.1 disagree on `ServerVariableObject.enum` shape
  // (tuple vs array) and several response/link/server sub-fields. Callers
  // supply schema literals in the JSON-Schema dialect that
  // `@fastify/swagger` actually validates at register-time. We pin the
  // `openapi` field to v3.1 and fall through `unknown` once for the
  // schemas — see `additionalOpenapiSchemas` JSDoc for why this is safer
  // than naming `openapi-types` directly.
  const swaggerOptions: FastifyDynamicSwaggerOptions = {
    openapi: {
      openapi: '3.1.1',
      info: opts.openapiInfo,
      servers: [...opts.openapiServers],
      tags: [...opts.openapiTags],
      ...(opts.additionalOpenapiSchemas !== undefined
        ? {
            components: {
              schemas: opts.additionalOpenapiSchemas as unknown as never,
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
