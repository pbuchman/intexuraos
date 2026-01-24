/**
 * Fastify server setup for code-agent service.
 */

import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerRoutes } from './routes/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'code-agent API',
        version: '0.0.1',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await registerRoutes(app);

  return await app;
}
