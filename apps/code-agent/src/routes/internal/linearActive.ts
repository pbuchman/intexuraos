/**
 * GET /internal/code-tasks/linear/:linearIssueId/active route.
 *
 * Internal endpoint for checking if a Linear issue has an active (non-completed) task.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';

const linearActiveRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /internal/code-tasks/linear/:linearIssueId/active - Check for active task
  fastify.get<{ Params: { linearIssueId: string } }>(
    '/internal/code-tasks/linear/:linearIssueId/active',
    {
      schema: {
        operationId: 'hasActiveCodeTaskForLinearIssue',
        summary: 'Check if active task exists for Linear issue',
        description: 'Internal endpoint for checking if a Linear issue has an active (non-completed) task.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            linearIssueId: { type: 'string' },
          },
          required: ['linearIssueId'],
        },
        response: {
          200: {
            description: 'Active task status',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  hasActive: { type: 'boolean' },
                  taskId: { type: 'string', nullable: true },
                },
                required: ['hasActive'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
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
    async (request: FastifyRequest<{ Params: { linearIssueId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/code-tasks/linear/:linearIssueId/active',
        includeParams: true,
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { codeTaskRepo } = getServices();
      const { linearIssueId } = request.params;

      request.log.info({ linearIssueId }, 'Checking for active code task');

      const result = await codeTaskRepo.hasActiveTaskForLinearIssue(linearIssueId);

      if (!result.ok) {
        request.log.error({ linearIssueId, error: result.error }, 'Failed to check active code task');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ linearIssueId, hasActive: result.value.hasActive }, 'Active code task check complete');

      return await reply.ok(result.value);
    }
  );

  done();
};

export default linearActiveRoute;
