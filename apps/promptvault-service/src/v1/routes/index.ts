/**
 * V1 Routes Plugin Aggregator
 * See ../routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { integrationRoutes } from './integrationRoutes.js';
import { promptRoutes } from './promptRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';

export const v1Routes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(integrationRoutes);
  fastify.register(promptRoutes);
  fastify.register(webhookRoutes);
  done();
};
