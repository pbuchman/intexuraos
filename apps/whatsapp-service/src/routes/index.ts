/**
 * Routes Plugin Aggregator
 * See ./routes.ts for route URL → file mapping.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Config } from '../config.js';
import { createWebhookRoutes } from './webhookRoutes.js';
import { mappingRoutes } from './mappingRoutes.js';
import { messageRoutes } from './messageRoutes.js';
import { messageMediaRoutes } from './messageMediaRoutes.js';
import { preferencesRoutes } from './preferencesRoutes.js';
import { createPubsubRoutes } from './pubsubRoutes.js';
import { verificationRoutes } from './verificationRoutes.js';
import { internalRoutes } from './internalRoutes.js';
import { privateSyncRoutes } from './privateSyncRoutes.js';
import { createPrivateReadRoutes } from './privateReadRoutes.js';
import { privateMediaRoutes } from './privateMediaRoutes.js';

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
    fastify.register(messageMediaRoutes);
    fastify.register(preferencesRoutes);
    fastify.register(verificationRoutes);
    fastify.register(createPrivateReadRoutes());
    fastify.register(createPubsubRoutes());
    fastify.register(internalRoutes);
    fastify.register(privateSyncRoutes);
    fastify.register(privateMediaRoutes);
    done();
  };
}
