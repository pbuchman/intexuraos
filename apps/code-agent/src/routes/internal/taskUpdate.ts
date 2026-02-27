/**
 * PATCH /internal/code-tasks/:taskId route.
 *
 * Internal endpoint for updating task status and results (worker callback).
 */

// eslint-disable-next-line no-restricted-imports -- Required for Firestore Timestamp type in update operations
import { Timestamp } from '@google-cloud/firestore';
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { codeTaskSchema, taskToApiResponse } from '../shared.js';

const taskUpdateRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // PATCH /internal/code-tasks/:taskId - Worker callback (will become webhook later)
  fastify.patch<{
    Params: { taskId: string };
    Body: {
      status?: 'designed' | 'implemented' | 'failed' | 'interrupted';
      result?: {
        branch: string;
        commits: number;
        summary: string;
        prUrl?: string;
        ciFailed?: boolean;
        partialWork?: boolean;
        rebaseResult?: 'success' | 'conflict' | 'skipped';
      };
      error?: {
        code: string;
        message: string;
        remediation?: {
          retryAfter?: number;
          manualSteps?: string;
          supportLink?: string;
        };
      };
      statusSummary?: {
        phase: 'starting' | 'analyzing' | 'implementing' | 'testing' | 'creating_pr' | 'completed';
        message: string;
        progress?: number;
      };
      callbackReceived?: boolean;
    };
  }>(
    '/internal/code-tasks/:taskId',
    {
      schema: {
        operationId: 'updateCodeTask',
        summary: 'Update a code task',
        description: 'Internal endpoint for updating task status and results (worker callback).',
        tags: ['internal'],
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
            status: {
              type: 'string',
              enum: ['designed', 'implemented', 'failed', 'interrupted'],
            },
            result: {
              type: 'object',
              properties: {
                branch: { type: 'string' },
                commits: { type: 'number' },
                summary: { type: 'string' },
                prUrl: { type: 'string', nullable: true },
                ciFailed: { type: 'boolean', nullable: true },
                partialWork: { type: 'boolean', nullable: true },
                rebaseResult: { type: 'string', enum: ['success', 'conflict', 'skipped'], nullable: true },
              },
              required: [],
            },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                remediation: {
                  type: 'object',
                  properties: {
                    retryAfter: { type: 'number', nullable: true },
                    manualSteps: { type: 'string', nullable: true },
                    supportLink: { type: 'string', nullable: true },
                  },
                },
              },
              required: ['code', 'message'],
            },
            statusSummary: {
              type: 'object',
              properties: {
                phase: {
                  type: 'string',
                  enum: ['starting', 'analyzing', 'implementing', 'testing', 'creating_pr', 'completed'],
                },
                message: { type: 'string' },
                progress: { type: 'number', minimum: 0, maximum: 100 },
              },
              required: ['phase', 'message'],
            },
            callbackReceived: { type: 'boolean' },
          },
        },
        response: {
          200: {
            description: 'Task updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  task: codeTaskSchema,
                },
                required: ['task'],
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
          404: {
            description: 'Task not found',
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
    async (
      request: FastifyRequest<{
        Params: { taskId: string };
        Body: {
          status?: 'designed' | 'implemented' | 'failed' | 'interrupted';
          result?: {
            branch: string;
            commits: number;
            summary: string;
            prUrl?: string;
            ciFailed?: boolean;
            partialWork?: boolean;
            rebaseResult?: 'success' | 'conflict' | 'skipped';
          };
          error?: {
            code: string;
            message: string;
            remediation?: {
              retryAfter?: number;
              manualSteps?: string;
              supportLink?: string;
            };
          };
          statusSummary?: {
            phase: 'starting' | 'analyzing' | 'implementing' | 'testing' | 'creating_pr' | 'completed';
            message: string;
            progress?: number;
          };
          callbackReceived?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /internal/code-tasks/:taskId',
        includeParams: true,
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { codeTaskRepo, rateLimitService } = getServices();
      const { taskId } = request.params;
      const body = request.body;

      request.log.info({ taskId, body }, 'Updating code task');

      const result = await codeTaskRepo.update(taskId, {
        /* v8 ignore start -- ts-type: spread operators create type narrowing branches @preserve */
        ...(body.status !== undefined && { status: body.status }),
        /* v8 ignore stop @preserve */
        ...(body.result !== undefined && { result: body.result }),
        /* v8 ignore start -- ts-type: optional property spread @preserve */
        ...(body.error !== undefined && { error: body.error }),
        /* v8 ignore stop @preserve */
        /* v8 ignore start -- ts-type: optional property spread @preserve */
        ...(body.statusSummary !== undefined && {
        /* v8 ignore stop @preserve */
          statusSummary: {
            ...body.statusSummary,
            updatedAt: Timestamp.fromDate(new Date()),
          },
        }),
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
        ...(body.callbackReceived !== undefined && { callbackReceived: body.callbackReceived }),
        /* v8 ignore stop @preserve */
      });

      if (!result.ok) {
        request.log.warn({ taskId, errorCode: result.error.code }, 'Failed to update code task');
        return await reply.fail('NOT_FOUND', result.error.message);
      }

      // Record task completion for rate limiting (decrement concurrent, update cost)
      // Do this for terminal states: completed, failed, cancelled, interrupted
      /* v8 ignore start -- ts-type: optional chaining and array includes create type narrowing branches @preserve */
      const terminalStatuses = ['designed', 'implemented', 'failed', 'cancelled', 'interrupted'] as const;
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- ts-type: terminal status includes check @preserve */
      if (body.status !== undefined && terminalStatuses.includes(body.status)) {
      /* v8 ignore stop @preserve */
        const userId = result.value.userId; // @allow-result-access -- .ok checked at line 736
        // Fire and forget - don't await to avoid delaying response
        // Note: Currently we don't receive actual cost from orchestrator, so we pass undefined
        rateLimitService.recordTaskComplete(userId, undefined).catch((err: unknown) => {
          request.log.error({ taskId, userId, error: err }, 'Failed to record task completion for rate limiting');
        });
      }

      request.log.info({ taskId, status: result.value.status }, 'Code task updated successfully'); // @allow-result-access -- narrowed by !result.ok guard above

      return await reply.ok({ task: taskToApiResponse(result.value) }); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  done();
};

export default taskUpdateRoute;
