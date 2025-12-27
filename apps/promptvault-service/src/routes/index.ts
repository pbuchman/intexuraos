/**
 * Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { promptRoutes } from './promptRoutes.js';

export const promptVaultRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(promptRoutes);
  done();
};
