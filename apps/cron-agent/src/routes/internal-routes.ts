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

      // Cloud Scheduler uses OIDC tokens validated by Cloud Run at infrastructure level.
      // Direct service calls use x-internal-auth header.
      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

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
