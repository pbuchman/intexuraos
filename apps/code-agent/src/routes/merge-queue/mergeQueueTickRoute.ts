import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { authenticateInternalScheduler } from '../helpers/internalAuth.js';
import { createMergeQueueTick } from '../../domain/usecases/mergeQueueTick.js';
import { ALLOWED_BOTS } from '../webhooks/github.js';

export const mergeQueueTickRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/merge-queue/tick',
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-queue/tick',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for merge-queue tick');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const tick = createMergeQueueTick({
        mergeQueueWatchRepo: services.mergeQueueWatchRepo,
        gitHubPRClient: services.gitHubPRClient,
        gitHubPRSummaryRepo: services.gitHubPRSummaryRepo,
        userServiceClient: services.userServiceClient,
        allowedBots: ALLOWED_BOTS,
        logger: request.log,
      });

      const result = await tick();

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Merge queue tick failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ results: result.value });
    }
  );

  done();
};
