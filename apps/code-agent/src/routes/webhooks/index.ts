/**
 * Webhook routes aggregator.
 */

import type { FastifyPluginCallback } from 'fastify';
import { githubWebhookRoute } from './github.js';

export const webhooksRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(githubWebhookRoute);
  done();
};
