/**
 * V1 Routes Plugin
 * See ./index.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { transcribeRoutes } from './transcribeRoutes.js';

/**
 * V1 routes plugin.
 */
export const v1Routes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(transcribeRoutes);
  done();
};
