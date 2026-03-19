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
        summary: 'Reconcile merge conflict status for all open PRs',
        description:
          'Called by Cloud Scheduler every minute to check mergeability of all open PRs and dispatch conflict resolution tasks.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Reconcile accepted',
            type: 'object',
            properties: {
              accepted: { type: 'boolean', enum: [true] },
            },
            required: ['accepted'],
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

      // Fire-and-forget: Cloud Scheduler expects a fast 200 response.
      // The reconciliation runs asynchronously in the background.
      void mergeConflictDetector.reconcile(logger).then((result) => {
        logger.info({ checked: result.checked }, 'Merge-conflict reconciliation completed');
      }).catch((err: unknown) => {
        logger.error({ error: err }, 'Unhandled error in merge-conflict reconciliation');
      });

      // @allow-raw-send: cron endpoint - Cloud Scheduler expects immediate acknowledgment
      return await reply.send({ accepted: true });
    }
  );

  done();
};
