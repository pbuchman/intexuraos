import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { handleTick } from '../domain/use-cases/handle-tick.js';

const tickResultSchema = {
  type: 'object',
  properties: {
    executed: { type: 'number' },
    skipped: { type: 'number' },
    errors: { type: 'number' },
  },
} as const;

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/cron/tick',
    {
      schema: {
        operationId: 'cronTick',
        summary: 'Process cron tick',
        description:
          'Internal endpoint called by Cloud Scheduler to process due cron schedules.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Tick result',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: tickResultSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/cron/tick',
      });

      // Auth strategy: Cloud Scheduler sends OIDC tokens; direct service calls use x-internal-auth.
      //
      // SECURITY NOTE: The OIDC token is NOT validated at the application layer. In production,
      // Cloud Run validates the OIDC token at the infrastructure level before the request reaches
      // this handler. In the current Terraform config, cron-agent uses allow_unauthenticated=true
      // (required for external webhooks), so this OIDC trust relies on Cloud Run's ingress settings
      // and IAM invoker configuration — NOT on the Bearer header alone. If Cloud Run ingress is
      // changed to allow all traffic, this endpoint would need application-level OIDC validation.
      //
      // For defense in depth, internal callers should prefer the x-internal-auth header path.
      const authHeader = request.headers.authorization;
      // Cloud Scheduler sends OIDC JWTs which always have 3 dot-separated segments.
      // Reject bare "Bearer <garbage>" to prevent trivial auth bypass when Cloud Run
      // ingress settings change.
      const JWT_STRUCTURE = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
      const isOidcAuth =
        typeof authHeader === 'string' && JWT_STRUCTURE.test(authHeader);

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn({ reason: authResult.reason }, 'Internal auth failed for cron tick');
          return await reply.fail('UNAUTHORIZED', 'Internal auth failed for cron tick');
        }
      }

      const services = getServices();
      const tickResult = await handleTick({
        logger: services.logger,
        scheduleRepo: services.scheduleRepo,
        executionRepo: services.executionRepo,
        executeDeps: {
          logger: services.logger,
          executionRepo: services.executionRepo,
          scheduleRepo: services.scheduleRepo,
          actionDeps: {
            logger: services.logger,
            toolRegistry: services.toolRegistry,
            toolCallingClient: services.toolCallingClient,
          },
        },
      });

      return await reply.ok(tickResult);
    },
  );

  done();
};
