/**
 * Task feedback, messages, heartbeat and group-summary status-mirror endpoints.
 *
 * Extracted from `codeRoutes.ts` as part of INT-1430 so that route handlers
 * live in resource-specific files and `codeRoutes.ts` can act as a thin
 * Fastify plugin.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  type ErrorCode,
} from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { submitTaskFeedback } from '../../domain/usecases/submitTaskFeedback.js';
import { sendTaskMessage } from '../../domain/usecases/sendTaskMessage.js';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import { loadConfig } from '../../config.js';
import type { CodeRoutesOptions } from './types.js';

export const feedbackRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;

  // ==== Internal routes (X-Internal-Auth / scheduler) ====

  // POST /internal/code/group-summary/recompute - Called by linear-agent after label changes
  fastify.post<{
    Body: {
      userId: string;
      linearIssueId: string;
      labels: { id: string; name: string }[];
      sourceTimestamp: string;
    };
  }>(
    '/internal/code/group-summary/recompute',
    {
      schema: {
        operationId: 'recomputeGroupSummary',
        summary: 'Recompute group summary aggregateStatus using Linear labels',
        description: 'Internal endpoint called by linear-agent after label changes to recompute needs-action status accurately.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            linearIssueId: { type: 'string' },
            labels: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['id', 'name'],
              },
            },
            sourceTimestamp: { type: 'string', format: 'date-time' },
          },
          required: ['userId', 'linearIssueId', 'labels', 'sourceTimestamp'],
        },
        response: {
          200: {
            description: 'Recomputed successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['recomputed'] },
                },
                required: ['status'],
              },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'No group summary found for the given userId/linearIssueId',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['NOT_FOUND'] },
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
    async (request: FastifyRequest<{ Body: { userId: string; linearIssueId: string; labels: { id: string; name: string }[]; sourceTimestamp: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/group-summary/recompute',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for group-summary recompute');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const body = request.body;

      /* v8 ignore start -- test-infra: groupSummaryRepo is always set in production services.ts; FakeFirestore test setup cannot produce undefined here @preserve */
      if (services.groupSummaryRepo === undefined) {
        request.log.warn({ userId: body.userId, linearIssueId: body.linearIssueId }, 'groupSummaryRepo not available');
        return await reply.fail('INTERNAL_ERROR', 'Group summary repository not configured');
      }
      /* v8 ignore stop @preserve */

      const result = await services.groupSummaryRepo.recomputeWithLabels(
        body.userId,
        body.linearIssueId,
        body.labels,
        body.sourceTimestamp,
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        request.log.warn({ error: result.error.message }, 'Failed to recompute group summary');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ status: 'recomputed' });
    }
  );

  // POST /internal/code/heartbeat - Process heartbeats from orchestrator (INT-372)
  fastify.post(
    '/internal/code/heartbeat',
    {
      schema: {
        description: 'Process heartbeats from orchestrator to keep tasks fresh for zombie detection',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            taskIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 100,
            },
          },
          required: ['taskIds'],
        },
        response: {
          200: {
            description: 'Heartbeat processed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  processed: { type: 'number' },
                  notFound: { type: 'array', items: { type: 'string' } },
                },
                required: ['processed', 'notFound'],
              },
            },
            required: ['success', 'data'],
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { taskIds: string[] };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/heartbeat',
      });

      // Validate orchestrator HMAC signature
      const signatureResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Orchestrator signature validation failed for heartbeat');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { processHeartbeat } = getServices();
      const { taskIds } = request.body;

      request.log.info({ taskCount: taskIds.length }, 'Processing heartbeat for tasks');

      const result = await processHeartbeat(taskIds);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Heartbeat processing failed');
        return await reply.fail('INTERNAL_ERROR', 'Failed to process heartbeat');
      }

      return await reply.ok(result.value); // @allow-result-access -- .ok checked at line 2523
    }
  );

  // ==== Public routes (Auth0 JWT) ====
  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    // POST /code/tasks/:taskId/feedback - Submit feedback on completed task (INT-465 Phase 4)
    fastify.post(
      '/code/tasks/:taskId/feedback',
      {
        schema: {
          operationId: 'submitTaskFeedback',
          summary: 'Submit feedback on a completed task',
          description: 'Creates a follow-up task based on user feedback for a completed task. Requires Auth0 JWT.',
          tags: ['public'],
          params: {
            type: 'object',
            required: ['taskId'],
            properties: {
              taskId: {
                type: 'string',
                description: 'The ID of the completed task to provide feedback on',
              },
            },
          },
          body: {
            type: 'object',
            required: ['feedback'],
            properties: {
              feedback: {
                type: 'string',
                description: 'Feedback text from the user',
                minLength: 1,
                maxLength: 5000,
              },
            },
          },
          response: {
            200: {
              description: 'Follow-up task created successfully',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  required: ['codeTaskId', 'resourceUrl', 'workerLocation', 'followUpFor'],
                  properties: {
                    codeTaskId: { type: 'string' },
                    resourceUrl: { type: 'string' },
                    workerLocation: { type: 'string' },
                    followUpFor: { type: 'string' },
                  },
                },
              },
            },
            400: {
              description: 'Bad request - task cannot receive feedback',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  properties: {
                    code: {
                      type: 'string',
                      enum: ['invalid_status', 'worker_not_configured'],
                    },
                    message: { type: 'string' },
                  },
                  required: ['code', 'message'],
                },
              },
              required: ['success', 'error'],
            },
            404: {
              description: 'Task not found',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', enum: ['NOT_FOUND'] },
                    message: { type: 'string' },
                  },
                  required: ['code', 'message'],
                },
              },
              required: ['success', 'error'],
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
            500: {
              description: 'Internal server error',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', enum: ['INTERNAL_ERROR'] },
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
          message: 'Received request to POST /code/tasks/:taskId/feedback',
        });

        const {
          codeTaskRepo,
          linearAgentClient,
          taskEnqueueService,
          metricsClient,
          workerSettingsRepo,
          gitHubPRClient,
          userServiceClient,
          automationLog: feedbackAutomationLog,
        } =
          getServices();
        const userId = request.user?.userId;

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        if (userId === undefined) {
          return await reply.fail('UNAUTHORIZED', 'Authentication required');
        }
        /* v8 ignore stop @preserve */

        const { taskId } = request.params as { taskId: string };
        const { feedback } = request.body as { feedback: string };

        request.log.info({ taskId, userId, feedbackLength: feedback.length }, 'Processing task feedback');

        const result = await submitTaskFeedback(
          {
            logger: request.log,
            codeTaskRepo,
            linearAgentClient,
            taskEnqueueService,
            metricsClient,
            workerSettingsRepo,
            gitHubPRClient,
            userServiceClient,
            orchestratorSecret: loadConfig().orchestratorSecret,
            serviceUrl: loadConfig().serviceUrl,
            automationLog: feedbackAutomationLog,
          },
          {
            originalTaskId: taskId,
            userId,
            feedback,
          }
        );

        if (!result.ok) {
          const error = result.error;

          // Map error codes to response codes
          if (error.code === 'task_not_found') {
            return await reply.fail('NOT_FOUND', error.message);
          }
          if (error.code === 'invalid_status' || error.code === 'worker_not_configured') {
            // Use BAD_REQUEST for client-side errors
            // @allow-raw-send: Returning application-specific error codes not supported by reply.fail()
            return await reply.status(400).send({
              success: false,
              error: {
                code: error.code,
                message: error.message,
              },
            });
          }

          // Internal error
          request.log.error({ error }, 'Task feedback submission failed');
          return await reply.fail('INTERNAL_ERROR', 'Failed to submit task feedback');
        }

        request.log.info(
          { originalTaskId: taskId, followUpTaskId: result.value.codeTaskId }, // @allow-result-access -- narrowed by !result.ok guard above
          'Follow-up task created from feedback'
        );

        return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
      }
    );

    // POST /code/tasks/:taskId/messages - Send message to task
    // ============================================================
    fastify.post<{
      Params: { taskId: string };
      Body: { message: string };
    }>(
      '/code/tasks/:taskId/messages',
      {
        schema: {
          operationId: 'sendTaskMessage',
          summary: 'Send a message to a running or completed task',
          tags: ['code-tasks'],
          params: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
            },
            required: ['taskId'],
          },
          body: {
            type: 'object',
            properties: {
              message: { type: 'string', minLength: 1, maxLength: 10000 },
            },
            required: ['message'],
          },
          response: {
            200: {
              description: 'Message sent or queued',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', enum: ['queued', 'resumed'] },
                  },
                  required: ['action'],
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        logIncomingRequest(request, { message: 'Received request to POST /code/tasks/:taskId/messages' });

        const userId = request.user?.userId;
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        if (userId === undefined) {
          return await reply.fail('UNAUTHORIZED' as ErrorCode, 'Missing user identity');
        }
        /* v8 ignore stop @preserve */

        const { taskId } = request.params;
        const { message } = request.body;

        const services = getServices();

        const result = await sendTaskMessage(
          {
            logger: services.logger,
            codeTaskRepo: services.codeTaskRepo,
            logLineRepo: services.logLineRepo,
            taskDispatcher: services.taskDispatcher,
            workerSettingsRepo: services.workerSettingsRepo,
            statusMirrorService: services.statusMirrorService,
            whatsappNotifier: services.whatsappNotifier,
          },
          { taskId, userId, message }
        );

        if (!result.ok) {
          const { error } = result;
          if (error.code === 'task_not_found') {
            return await reply.fail('NOT_FOUND' as ErrorCode, error.message);
          }
          if (error.code === 'invalid_agent_type') {
            return await reply.fail('FORBIDDEN' as ErrorCode, error.message);
          }
          if (error.code === 'invalid_status') {
            return await reply.fail('INVALID_STATUS' as ErrorCode, error.message);
          }
          if (error.code === 'worker_not_configured') {
            return await reply.fail('MISCONFIGURED' as ErrorCode, error.message);
          }
          if (error.code === 'session_expired') {
            return await reply.fail('SESSION_EXPIRED', error.message);
          }
          if (error.code === 'worker_unavailable') {
            return await reply.fail('WORKER_UNAVAILABLE', error.message);
          }
          return await reply.fail('INTERNAL_ERROR' as ErrorCode, error.message);
        }

        return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
      }
    );
  });

  done();
};
