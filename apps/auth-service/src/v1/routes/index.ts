/**
 * V1 Auth Routes Plugin Aggregator
 * See ../routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { deviceRoutes } from './deviceRoutes.js';
import { tokenRoutes } from './tokenRoutes.js';
import { configRoutes } from './configRoutes.js';
import { oauthRoutes } from './oauthRoutes.js';

export const v1AuthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(deviceRoutes);
  fastify.register(tokenRoutes);
  fastify.register(configRoutes);
  fastify.register(oauthRoutes);
  done();
};
