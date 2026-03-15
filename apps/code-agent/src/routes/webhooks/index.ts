/**
 * Webhook routes aggregator.
 */

import type { FastifyPluginCallback } from 'fastify';
import { githubWebhookRoute } from './github.js';
import { taskEventRoute } from './taskEvent.js';

export const webhooksRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(githubWebhookRoute);
  fastify.register(taskEventRoute);
  done();
};
