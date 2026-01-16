/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processLinearAction } from '../domain/index.js';

interface ProcessActionBody {
  action: {
    id: string;
    userId: string;
    text: string;
    summary?: string;
  };
}

async function handleLinearError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ProcessActionBody }>(
    '/internal/linear/process-action',
    async (request: FastifyRequest<{ Body: ProcessActionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { action } = request.body;

      request.log.info(
        { actionId: action.id, userId: action.userId, textLength: action.text.length, hasSummary: action.summary !== undefined },
        'internal/processLinearAction: processing action'
      );

      const result = await processLinearAction(
        {
          actionId: action.id,
          userId: action.userId,
          text: action.text,
          ...(action.summary !== undefined && { summary: action.summary }),
        },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          failedIssueRepository: services.failedIssueRepository,
          extractionService: services.extractionService,
          logger: request.log,
        }
      );

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      request.log.info(
        { actionId: action.id, status: result.value.status },
        'internal/processLinearAction: complete'
      );

      return await reply.send({
        status: result.value.status,
        resource_url: result.value.resourceUrl,
        issue_identifier: result.value.issueIdentifier,
        error: result.value.error,
      });
    }
  );

  done();
};
