import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { getLinearIssueContext } from '../../domain/usecases/getLinearIssueContext.js';
import { GET_LINEAR_ISSUE_CONTEXT_SCHEMA } from './schemas.js';

/**
 * Diagnostic routes:
 * - GET /internal/linear/issue-context/:identifier (INT-1040)
 *
 * Uses `validateInternalAuth` (x-internal-auth header only).
 */
export const diagnosticRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Params: { identifier: string } }>(
    '/internal/linear/issue-context/:identifier',
    { schema: GET_LINEAR_ISSUE_CONTEXT_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/linear/issue-context/:identifier',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { identifier } = request.params;
      const { linearAgentClient, logger } = getServices();

      const result = await getLinearIssueContext(identifier, {
        linearAgentClient,
        logger,
      });

      if (result.status === 'not_found') {
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      if (result.status === 'error') {
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', `linear-agent error: ${result.code}`);
      }

      // @allow-raw-send: internal endpoint returns structured context directly
      return await reply.send(result.data);
    }
  );

  done();
};
