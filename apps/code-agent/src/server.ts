/**
 * Fastify server setup for code-agent service.
 */

import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { registerHealthCheck } from '@intexuraos/http-server';
import { firestoreHealthCheck } from '@intexuraos/infra-firestore';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { registerRoutes } from './routes/index.js';
import { loadConfig } from './config.js';
import { getServices } from './services.js';
import { createJwtValidator } from './infra/auth/jwtValidator.js';

const SERVICE_NAME = 'code-agent';
const SERVICE_VERSION = '0.0.1';

export async function buildServer(loggerStream?: NodeJS.WritableStream): Promise<FastifyInstance> {
  const app = fastify({
    logger: loggerStream !== undefined
      ? { level: 'error', stream: loggerStream }
      : process.env['NODE_ENV'] === 'test'
        ? false
        : { level: process.env['LOG_LEVEL'] ?? 'info', stream: createLogStream() },
    disableRequestLogging: true,
    requestTimeout: 120000, // 120s — safety net above client's 90s timeout
  });

  // Global error handler - logs to Pino, sends to Sentry, returns structured response
  setupSentryErrorHandler(app);

  await app.register(cors, {
    origin: true,
  });

  await app.register(intexuraFastifyPlugin);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: `${SERVICE_NAME} API`,
        version: SERVICE_VERSION,
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Load config and create JWT validator for public routes
  const config = loadConfig();
  const { logger } = getServices();
  const jwtValidator = createJwtValidator(
    {
      audience: config.auth0Audience,
      issuer: config.auth0Issuer,
      jwksUri: config.auth0JwksUri,
    },
    logger
  );

  await registerRoutes(app, { jwtValidator });

  // Required endpoints for CI verification
  app.get('/openapi.json', async (_req, reply) => {
    const spec = app.swagger();
    return await reply.type('application/json').send(spec);
  });

  // Standard /health envelope (NOT wrapped in apiOk per api-contracts.md)
  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: [firestoreHealthCheck()],
  });

  return await app;
}
