/**
 * V1 Routes Plugin Aggregator
 * See ../routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Config } from '../../config.js';
import { createWebhookRoutes } from './webhookRoutes.js';
import { mappingRoutes } from './mappingRoutes.js';

/**
 * Creates V1 routes plugin with config.
 * Webhook routes require config for signature validation.
 */
export function createV1Routes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.register(createWebhookRoutes(config));
    fastify.register(mappingRoutes);
    done();
  };
}
