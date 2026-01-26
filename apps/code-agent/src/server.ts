/**
 * Fastify server setup for code-agent service.
 */

import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { registerRoutes } from './routes/index.js';
import { loadConfig } from './config.js';
import { getServices } from './services.js';
import { createJwtValidator } from './infra/auth/jwtValidator.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
  });

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
