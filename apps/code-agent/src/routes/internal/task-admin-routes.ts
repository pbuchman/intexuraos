import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';
import { buildTaskCompleteWebhookUrl } from '../../domain/services/codeTaskCallbackUrls.js';
import { GET_TASK_DISPATCH_METADATA_SCHEMA } from './schemas.js';

/**
 * Task admin routes:
 * - GET /internal/tasks/:taskId/dispatch-metadata (INT-1130)
 *
 * Uses `validateInternalAuth` (x-internal-auth header only) per the original
 * handler in `internalRoutes.ts`. Auth logging behavior is preserved verbatim.
 */
export const taskAdminRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Params: { taskId: string } }>(
    '/internal/tasks/:taskId/dispatch-metadata',
    { schema: GET_TASK_DISPATCH_METADATA_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/tasks/:taskId/dispatch-metadata',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { taskId } = request.params;
      const { codeTaskRepo, codeTaskCallbackBaseUrl } = getServices();

      const findResult = await codeTaskRepo.findById(taskId);
      if (!findResult.ok) {
        return await reply.fail('NOT_FOUND', `Task ${taskId} not found`);
      }

      const task = findResult.value;

      // @allow-raw-send: internal endpoint returns structured dispatch metadata directly
      return await reply.send({
        taskId: task.id,
        prompt: task.prompt,
        repository: task.repository,
        baseBranch: task.baseBranch,
        agentType: task.agentType ?? null,
        workerType: task.workerType,
        linearIssueId: task.linearIssueId ?? null,
        webhookSecret: task.webhookSecret ?? null,
        prNumber: task.prNumber ?? null,
        webhookUrl: buildTaskCompleteWebhookUrl(codeTaskCallbackBaseUrl ?? loadConfig().codeTaskCallbackBaseUrl),
        continuationPrBranch: task.prBranch ?? null,
        trackingCommentId: task.trackingCommentId ?? null,
      });
    }
  );

  done();
};
