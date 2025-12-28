/**
 * Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { integrationRoutes } from './integrationRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';

export const notionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(integrationRoutes);
  fastify.register(webhookRoutes);
  done();
};
