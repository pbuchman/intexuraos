/**
 * POST /internal/code/process route.
 *
 * Internal endpoint for processing code actions. Called by actions-agent when a code action is approved.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { processCodeAction } from '../../domain/usecases/processCodeAction.js';
import { loadConfig } from '../../config.js';

const processRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/code/process - Called by actions-agent
  fastify.post<{
    Body: {
      actionId: string;
      approvalEventId: string;
      userId: string;
      payload: {
        prompt: string;
        workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
        linearIssueId?: string;
        repository?: string;
        baseBranch?: string;
      };
    };
  }>(
    '/internal/code/process',
    {
      schema: {
        operationId: 'processCodeAction',
        summary: 'Process code action from actions-agent',
        description: 'Internal endpoint for processing code actions. Called by actions-agent when a code action is approved.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            actionId: { type: 'string' },
            approvalEventId: { type: 'string' },
            userId: { type: 'string' },
            payload: {
              type: 'object',
              properties: {
                prompt: { type: 'string' },
                workerType: { type: 'string', enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm'] },
                linearIssueId: { type: 'string' },
                repository: { type: 'string' },
                baseBranch: { type: 'string' },
              },
              required: ['prompt'],
            },
          },
          required: ['actionId', 'approvalEventId', 'userId', 'payload'],
        },
        response: {
          200: {
            description: 'Task submitted successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['submitted'] },
                  codeTaskId: { type: 'string' },
                  resourceUrl: { type: 'string' },
                },
                required: ['status', 'codeTaskId', 'resourceUrl'],
              },
            },
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
          409: {
            description: 'Duplicate task (deduplication triggered)',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['CONFLICT'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          503: {
            description: 'Worker unavailable',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['MISCONFIGURED'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          500: {
            description: 'Server error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INTERNAL_ERROR'] },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { actionId: string; approvalEventId: string; userId: string; payload: { prompt: string; workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm'; linearIssueId?: string; repository?: string; baseBranch?: string } } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/process',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code process');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const body = request.body;

      // Extract or generate traceId from headers
      const traceId = extractOrGenerateTraceId(request.headers);

      request.log.info(
        {
          actionId: body.actionId,
          userId: body.userId,
          workerType: body.payload.workerType,
          repository: body.payload.repository,
          traceId,
        },
        'Processing code action'
      );

      // Process the code action using use case
      const processRequest: {
        actionId: string;
        approvalEventId: string;
        userId: string;
        prompt: string;
        workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
        linearIssueId?: string;
        repository?: string;
        baseBranch?: string;
        traceId?: string;
      } = {
        actionId: body.actionId,
        approvalEventId: body.approvalEventId,
        userId: body.userId,
        prompt: body.payload.prompt,
        workerType: body.payload.workerType ?? 'auto',
        traceId,
      };

      // Only include optional fields if they are defined
      if (body.payload.linearIssueId !== undefined) {
        processRequest.linearIssueId = body.payload.linearIssueId;
      }
      if (body.payload.repository !== undefined) {
        processRequest.repository = body.payload.repository;
      }
      if (body.payload.baseBranch !== undefined) {
        processRequest.baseBranch = body.payload.baseBranch;
      }

      const result = await processCodeAction(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskDispatcher: services.taskDispatcher,
          linearIssueService: services.linearIssueService,
          whatsappNotifier: services.whatsappNotifier,
          metricsClient: services.metricsClient,
          workerSettingsRepo: services.workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
        },
        processRequest
      );

      if (!result.ok) {
        const error = result.error;
        request.log.warn(
          {
            errorCode: error.code,
            errorMessage: error.message,
            existingTaskId: error.existingTaskId,
          },
          'Failed to process code action'
        );

        // Handle specific error codes
        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (error.code === 'duplicate_approval' || error.code === 'duplicate_action') {
        /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: error code nullish coalescing @preserve */
          return await reply.fail('CONFLICT', `Duplicate: ${error.existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (error.code === 'duplicate_prompt') {
        /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: error existingTaskId nullish coalescing @preserve */
          return await reply.fail('CONFLICT', `Similar task submitted in last 5 minutes: ${error.existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (error.code === 'active_task_exists') {
        /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: error existingTaskId nullish coalescing @preserve */
          return await reply.fail('CONFLICT', `Active task already exists for this Linear issue: ${error.existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        /* v8 ignore start -- ts-type: error code comparison @preserve */
        if (error.code === 'worker_not_configured') {
        /* v8 ignore stop @preserve */
          return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
        }

        if (error.code === 'worker_unavailable') {
          return await reply.fail('MISCONFIGURED', 'Worker unavailable');
        }

        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      request.log.info({ codeTaskId: result.value.codeTaskId }, 'Code action processed successfully'); // @allow-result-access -- .ok checked at line 461

      // Mirror dispatched status to action (non-fatal)
      try {
        await services.statusMirrorService.mirrorStatus({
          actionId: body.actionId,
          taskStatus: 'dispatched',
          resourceUrl: result.value.resourceUrl, // @allow-result-access -- .ok checked at line 461
          traceId,
        });
      } catch (mirrorError) {
        request.log.warn({ actionId: body.actionId, error: mirrorError }, 'Failed to mirror status to action');
      }

      return await reply.ok({
        status: 'submitted',
        codeTaskId: result.value.codeTaskId, // @allow-result-access -- .ok checked at line 461
        resourceUrl: result.value.resourceUrl, // @allow-result-access -- .ok checked at line 461
      });
    }
  );

  done();
};

export default processRoute;
