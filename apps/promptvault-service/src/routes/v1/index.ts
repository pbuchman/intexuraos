/**
 * V1 Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { promptRoutes } from './promptRoutes.js';

export const v1Routes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(promptRoutes);
  done();
};
