/**
 * Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Config } from '../config.js';
import { createWebhookRoutes } from './webhookRoutes.js';
import { mappingRoutes } from './mappingRoutes.js';
import { messageRoutes } from './messageRoutes.js';
import { createPubsubRoutes } from './pubsubRoutes.js';

/**
 * Creates routes plugin with config.
 * Webhook routes require config for signature validation.
 * Pubsub routes require config for webhook processing.
 */
export function createWhatsappRoutes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.register(createWebhookRoutes(config));
    fastify.register(mappingRoutes);
    fastify.register(messageRoutes);
    fastify.register(createPubsubRoutes(config));
    done();
  };
}
