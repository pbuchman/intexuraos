import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { authenticateInternalScheduler } from './helpers/internalAuth.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/merge-conflicts/reconcile - triggered by Cloud Scheduler (INT-1023)
  fastify.post(
    '/internal/merge-conflicts/reconcile',
    {
      schema: {
        operationId: 'reconcileMergeConflicts',
        summary: 'Sync Firestore PR state from GitHub',
        description:
          'Called by Cloud Scheduler every minute. Syncs open/closed state from GitHub into Firestore — no mergeability checking.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Reconcile completed',
            type: 'object',
            additionalProperties: false,
            properties: {
              processed: { type: 'number' },
              closed: { type: 'number' },
              reopened: { type: 'number' },
              skipped: { type: 'number' },
              error: { type: 'number' },
            },
            required: ['processed', 'closed', 'reopened', 'skipped', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-conflicts/reconcile',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for merge-conflicts reconcile');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for merge-conflicts reconcile');

      const { mergeConflictDetector, logger } = getServices();
      const result = await mergeConflictDetector.reconcile(logger);
      logger.info(result, 'PR state reconciliation completed');

      // @allow-raw-send: cron endpoint returns reconcile stats directly
      return await reply.send(result);
    }
  );

  done();
};
