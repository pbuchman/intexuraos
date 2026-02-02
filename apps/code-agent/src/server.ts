/**
 * Fastify server setup for code-agent service.
 */

import fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { registerRoutes } from './routes/index.js';
import { loadConfig } from './config.js';
import { getServices } from './services.js';
import { createJwtValidator } from './infra/auth/jwtValidator.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
  });

  // Global error handler - must be set early to catch validation errors
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // For validation errors, return 400 with structured response
    if (error.validation !== undefined) {
      // @allow-raw-send: Global error handler runs before route-level reply decorators are available
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    // For other errors, return 500
    // @allow-raw-send: Global error handler runs before route-level reply decorators are available
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(intexuraFastifyPlugin);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'code-agent API',
        version: '0.0.1',
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

  app.get('/health', () => {
    return { status: 'ok', service: 'code-agent' };
  });

  return await app;
}
