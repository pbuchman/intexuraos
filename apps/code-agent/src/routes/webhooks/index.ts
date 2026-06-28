/**
 * Webhook routes aggregator.
 */

import type { FastifyPluginCallback } from 'fastify';
import { githubWebhookRoute } from './github.js';
import { taskEventRoute } from './taskEvent.js';
import { complianceReportRoute } from './complianceReport.js';
import { prTriagePubsubRoute } from './prTriagePubsubRoute.js';
import { sentryWebhookRoute } from './sentry.js';

export const webhooksRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(githubWebhookRoute);
  fastify.register(sentryWebhookRoute);
  fastify.register(taskEventRoute);
  fastify.register(complianceReportRoute);
  fastify.register(prTriagePubsubRoute);
  done();
};
