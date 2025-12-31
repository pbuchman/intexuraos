/**
 * Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { integrationRoutes } from './integrationRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { internalRoutes } from './internalRoutes.js';

export const notionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(integrationRoutes);
  fastify.register(webhookRoutes);
  fastify.register(internalRoutes);
  done();
};

// Export individual route modules for testing
export { internalRoutes };
