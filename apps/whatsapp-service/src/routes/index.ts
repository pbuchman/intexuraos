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
import { conversationAssistantRoutes } from './conversationAssistantRoutes.js';
import { privateMatrixOutboundRoutes } from './privateMatrixOutboundRoutes.js';
import { privateErasureRoutes } from './privateErasureRoutes.js';
import { createMatrixCorpusRoutes } from './matrixCorpusRoutes.js';
import { getServices } from '../services.js';

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
    fastify.register(conversationAssistantRoutes);
    fastify.register(createPubsubRoutes());
    fastify.register(internalRoutes);
    fastify.register(privateSyncRoutes);
    fastify.register(privateMediaRoutes);
    fastify.register(privateMatrixOutboundRoutes);
    fastify.register(privateErasureRoutes);
    if (config.matrixCorpus.enabled) {
      const matrixCorpus = getServices().matrixCorpus;
      if (matrixCorpus === undefined) {
        done(new Error('Matrix corpus service composition is unavailable'));
        return;
      }
      fastify.register(createMatrixCorpusRoutes(matrixCorpus.routes));
    }
    done();
  };
}
