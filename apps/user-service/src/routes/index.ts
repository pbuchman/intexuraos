/**
 * Auth Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import { deviceRoutes } from './deviceRoutes.js';
import { tokenRoutes } from './tokenRoutes.js';
import { configRoutes } from './configRoutes.js';
import { oauthRoutes } from './oauthRoutes.js';
import { oauthConnectionRoutes } from './oauthConnectionRoutes.js';
import { frontendRoutes } from './frontendRoutes.js';
import { settingsRoutes } from './settingsRoutes.js';
import { llmKeysRoutes } from './llmKeysRoutes.js';
import { internalRoutes } from './internalRoutes.js';
import { firebaseRoutes } from './firebaseRoutes.js';

export const authRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(deviceRoutes);
  fastify.register(tokenRoutes);
  fastify.register(configRoutes);
  fastify.register(oauthRoutes);
  fastify.register(oauthConnectionRoutes);
  fastify.register(frontendRoutes);
  fastify.register(settingsRoutes);
  fastify.register(llmKeysRoutes);
  fastify.register(internalRoutes);
  fastify.register(firebaseRoutes);
  done();
};
