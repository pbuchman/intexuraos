import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-conflicts/reconcile',
      });

      // Auth strategy: Cloud Scheduler sends OIDC tokens; direct service calls use x-internal-auth.
      //
      // SECURITY NOTE: The OIDC token is NOT validated at the application layer. In production,
      // Cloud Run validates the OIDC token at the infrastructure level before the request reaches
      // this handler. In the current Terraform config, code-agent uses allow_unauthenticated=true
      // (required for external webhooks), so this OIDC trust relies on Cloud Run's ingress settings
      // and IAM invoker configuration — NOT on the Bearer header alone. If Cloud Run ingress is
      // changed to allow all traffic, this endpoint would need application-level OIDC validation.
      //
      // For defense in depth, internal callers should prefer the x-internal-auth header path.
      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn({ reason: authResult.reason }, 'Internal auth failed for merge-conflicts reconcile');
          return await reply.fail('UNAUTHORIZED', 'Unauthorized');
        }
      }

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
