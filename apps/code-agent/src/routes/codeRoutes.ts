/* eslint-disable */
import { Timestamp } from '@google-cloud/firestore';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { processCodeAction } from '../domain/usecases/processCodeAction.js';
import { cancelTaskWithNonce } from '../domain/usecases/cancelTaskWithNonce.js';
import type { TaskStatus } from '../domain/models/codeTask.js';

export type JwtValidator = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

// Response schema for created task
const codeTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    prompt: { type: 'string' },
    sanitizedPrompt: { type: 'string' },
    systemPromptHash: { type: 'string' },
    workerType: { type: 'string', enum: ['opus', 'auto', 'glm'] },
    workerLocation: { type: 'string', enum: ['mac', 'vm'] },
    repository: { type: 'string' },
    baseBranch: { type: 'string' },
    traceId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['dispatched', 'running', 'completed', 'failed', 'interrupted', 'cancelled'],
    },
    dedupKey: { type: 'string' },
    callbackReceived: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    actionId: { type: 'string', nullable: true },
    approvalEventId: { type: 'string', nullable: true },
    linearIssueId: { type: 'string', nullable: true },
    linearIssueTitle: { type: 'string', nullable: true },
    linearFallback: { type: 'boolean', nullable: true },
    result: {
      type: 'object',
      nullable: true,
      properties: {
        prUrl: { type: 'string', nullable: true },
        branch: { type: 'string' },
        commits: { type: 'number' },
        summary: { type: 'string' },
        ciFailed: { type: 'boolean', nullable: true },
        partialWork: { type: 'boolean', nullable: true },
        rebaseResult: { type: 'string', enum: ['success', 'conflict', 'skipped'], nullable: true },
      },
    },
    error: {
      type: 'object',
      nullable: true,
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        remediation: {
          type: 'object',
          nullable: true,
          properties: {
            retryAfter: { type: 'number', nullable: true },
            manualSteps: { type: 'string', nullable: true },
            supportLink: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  required: [
    'id',
    'userId',
    'prompt',
    'sanitizedPrompt',
    'systemPromptHash',
    'workerType',
    'workerLocation',
    'repository',
    'baseBranch',
    'traceId',
    'status',
    'dedupKey',
    'callbackReceived',
    'createdAt',
    'updatedAt',
  ],
} as const;

/**
 * Convert Firestore Timestamp to ISO string for JSON serialization
 */
function timestampToIso(
  timestamp: { toDate: () => Date } | string | undefined
): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return undefined;
}

/**
 * Convert CodeTask domain model to API response format
 */
function taskToApiResponse(task: {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearFallback?: boolean;
  result?: {
    prUrl?: string;
    branch: string;
    commits: number;
    summary: string;
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
  completedAt?: unknown;
  dispatchedAt?: unknown;
  logChunksDropped?: number;
  statusSummary?: unknown;
  retriedFrom?: string;
}): {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearFallback?: boolean;
  result?: {
    prUrl?: string;
    branch: string;
    commits: number;
    summary: string;
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
} {
  return {
    id: task.id,
    userId: task.userId,
    prompt: task.prompt,
    sanitizedPrompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    workerType: task.workerType,
    workerLocation: task.workerLocation,
    repository: task.repository,
    baseBranch: task.baseBranch,
    traceId: task.traceId,
    status: task.status,
    dedupKey: task.dedupKey,
    callbackReceived: task.callbackReceived,
    createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
    updatedAt: timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '',
    ...(task.actionId !== undefined && { actionId: task.actionId }),
    ...(task.approvalEventId !== undefined && { approvalEventId: task.approvalEventId }),
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    ...(task.linearIssueTitle !== undefined && { linearIssueTitle: task.linearIssueTitle }),
    ...(task.linearFallback !== undefined && { linearFallback: task.linearFallback }),
    ...(task.result !== undefined && { result: task.result }),
    ...(task.error !== undefined && { error: task.error }),
  };
}

export const codeRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;
  // ============================================================
  // INTERNAL ROUTES (X-Internal-Auth)
  // ============================================================

  // POST /internal/code/process - Called by actions-agent
  fastify.post<{
    Body: {
      actionId: string;
      approvalEventId: string;
      userId: string;
      payload: {
        prompt: string;
        workerType?: 'opus' | 'auto' | 'glm';
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
                workerType: { type: 'string', enum: ['opus', 'auto', 'glm'] },
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
            properties: {
              status: { type: 'string', enum: ['submitted'] },
              codeTaskId: { type: 'string' },
              resourceUrl: { type: 'string' },
            },
            required: ['status', 'codeTaskId', 'resourceUrl'],
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
            properties: {
              status: { type: 'string', enum: ['duplicate'] },
              existingTaskId: { type: 'string' },
            },
            required: ['status', 'existingTaskId'],
          },
          503: {
            description: 'Worker unavailable',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['failed'] },
              error: { type: 'string', enum: ['worker_unavailable'] },
            },
            required: ['status', 'error'],
          },
          500: {
            description: 'Server error',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
            required: ['error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { actionId: string; approvalEventId: string; userId: string; payload: { prompt: string; workerType?: 'opus' | 'auto' | 'glm'; linearIssueId?: string; repository?: string; baseBranch?: string } } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/process',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code process');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
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
        workerType: 'opus' | 'auto' | 'glm';
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
          whatsappNotifier: services.whatsappNotifier,
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
        if (error.code === 'duplicate_approval' || error.code === 'duplicate_action') {
          reply.status(409);
          return {
            status: 'duplicate',
            existingTaskId: error.existingTaskId ?? '',
          };
        }

        if (error.code === 'worker_unavailable') {
          reply.status(503);
          return {
            status: 'failed',
            error: 'worker_unavailable',
          };
        }

        reply.status(500);
        return { error: error.message };
      }

      request.log.info({ codeTaskId: result.value.codeTaskId }, 'Code action processed successfully');

      // Mirror dispatched status to action (non-fatal)
      await services.statusMirrorService.mirrorStatus({
        actionId: body.actionId,
        taskStatus: 'dispatched',
        resourceUrl: result.value.resourceUrl,
        traceId,
      });

      return await reply.send({
        status: 'submitted',
        codeTaskId: result.value.codeTaskId,
        resourceUrl: result.value.resourceUrl,
      });
    }
  );

  // PATCH /internal/code-tasks/:taskId - Worker callback (will become webhook later)
  fastify.patch<{
    Params: { taskId: string };
    Body: {
      status?: 'completed' | 'failed' | 'interrupted';
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
              enum: ['completed', 'failed', 'interrupted'],
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
              required: ['branch', 'commits', 'summary'],
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
          status?: 'completed' | 'failed' | 'interrupted';
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
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo, linearIssueService, rateLimitService } = getServices();
      const { taskId } = request.params;
      const body = request.body;

      request.log.info({ taskId, body }, 'Updating code task');

      const result = await codeTaskRepo.update(taskId, {
        ...(body.status !== undefined && { status: body.status }),
        ...(body.result !== undefined && { result: body.result }),
        ...(body.error !== undefined && { error: body.error }),
        ...(body.statusSummary !== undefined && {
          statusSummary: {
            ...body.statusSummary,
            updatedAt: Timestamp.fromDate(new Date()),
          },
        }),
        ...(body.callbackReceived !== undefined && { callbackReceived: body.callbackReceived }),
      });

      if (!result.ok) {
        request.log.warn({ taskId, errorCode: result.error.code }, 'Failed to update code task');
        reply.status(404);
        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      // Record task completion for rate limiting (decrement concurrent, update cost)
      // Do this for terminal states: completed, failed, cancelled, interrupted
      const terminalStatuses = ['completed', 'failed', 'cancelled', 'interrupted'] as const;
      if (body.status !== undefined && terminalStatuses.includes(body.status)) {
        const userId = result.value.userId;
        // Fire and forget - don't await to avoid delaying response
        // Note: Currently we don't receive actual cost from orchestrator, so we pass undefined
        rateLimitService.recordTaskComplete(userId, undefined).catch((err) => {
          request.log.error({ taskId, userId, error: err }, 'Failed to record task completion for rate limiting');
        });
      }

      // If PR was created and task has a Linear issue, transition to In Review
      if (body.result?.prUrl !== undefined && result.value.linearIssueId !== undefined) {
        await linearIssueService.markInReview(result.value.linearIssueId);
      }

      request.log.info({ taskId, status: result.value.status }, 'Code task updated successfully');

      return await reply.send({ success: true, data: { task: taskToApiResponse(result.value) } });
    }
  );

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
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      const { linearIssueId } = request.params;

      request.log.info({ linearIssueId }, 'Checking for active code task');

      const result = await codeTaskRepo.hasActiveTaskForLinearIssue(linearIssueId);

      if (!result.ok) {
        request.log.error({ linearIssueId, error: result.error }, 'Failed to check active code task');
        reply.status(500);
        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      request.log.info({ linearIssueId, hasActive: result.value.hasActive }, 'Active code task check complete');

      return await reply.send({ success: true, data: result.value });
    }
  );

  // GET /internal/code-tasks/zombies - Find zombie tasks
  fastify.get<{
    Querystring: { staleThresholdMinutes: number };
  }>(
    '/internal/code-tasks/zombies',
    {
      schema: {
        operationId: 'findZombieCodeTasks',
        summary: 'Find zombie tasks',
        description: 'Internal endpoint for finding stale tasks that may have died (zombie detection).',
        tags: ['internal'],
        querystring: {
          type: 'object',
          properties: {
            staleThresholdMinutes: {
              type: 'number',
              minimum: 1,
              description: 'Tasks updated more than this many minutes ago are considered stale',
            },
          },
          required: ['staleThresholdMinutes'],
        },
        response: {
          200: {
            description: 'List of zombie tasks',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  tasks: {
                    type: 'array',
                    items: codeTaskSchema,
                  },
                },
                required: ['tasks'],
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
    async (
      request: FastifyRequest<{ Querystring: { staleThresholdMinutes: number } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/code-tasks/zombies',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      const { staleThresholdMinutes } = request.query;

      const staleThreshold = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

      request.log.info({ staleThresholdMinutes, staleThreshold }, 'Finding zombie code tasks');

      const result = await codeTaskRepo.findZombieTasks(staleThreshold);

      if (!result.ok) {
        request.log.error({ staleThreshold, error: result.error }, 'Failed to find zombie code tasks');
        reply.status(500);
        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      request.log.info({ count: result.value.length }, 'Zombie code tasks found');

      return await reply.send({
        success: true,
        data: {
          tasks: result.value.map(taskToApiResponse),
        },
      });
    }
  );

  // ============================================================
  // PUBLIC ROUTES (Auth0 JWT - TODO: Add proper Auth0 auth in later issues)
  // For now, using internal auth temporarily
  // ============================================================

  // POST /code/submit - Submit task from UI (public, Auth0 JWT)
  fastify.post<{
    Body: {
      prompt: string;
      workerType?: 'opus' | 'auto' | 'glm';
      linearIssueId?: string;
      linearIssueTitle?: string;
    };
  }>(
    '/code/submit',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'submitCodeTask',
        summary: 'Submit a code task from the UI',
        description: 'Public endpoint for submitting code tasks directly from the web UI. Requires Auth0 JWT.',
        tags: ['public'],
        body: {
          type: 'object',
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 100000 },
            workerType: { type: 'string', enum: ['opus', 'auto', 'glm'] },
            linearIssueId: { type: 'string' },
            linearIssueTitle: { type: 'string' },
          },
          required: ['prompt'],
        },
        response: {
          200: {
            description: 'Task submitted successfully',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['submitted'] },
              codeTaskId: { type: 'string' },
            },
            required: ['status', 'codeTaskId'],
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
          409: {
            description: 'Duplicate task (similar prompt within 5 minutes)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['DUPLICATE_PROMPT'] },
                  message: { type: 'string' },
                  existingTaskId: { type: 'string' },
                },
                required: ['code', 'message', 'existingTaskId'],
              },
            },
            required: ['success', 'error'],
          },
          429: {
            description: 'Rate limit exceeded',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    enum: ['concurrent_limit', 'hourly_limit', 'daily_cost_limit', 'monthly_cost_limit', 'prompt_too_long'],
                  },
                  message: { type: 'string' },
                  retryAfter: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Service unavailable',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['service_unavailable'] },
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
    async (request: FastifyRequest<{ Body: { prompt: string; workerType?: 'opus' | 'auto' | 'glm'; linearIssueId?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/submit',
        includeParams: true,
      });

      const { codeTaskRepo, taskDispatcher, rateLimitService, linearIssueService } = getServices();
      const body = request.body as {
        prompt: string;
        workerType?: 'opus' | 'auto' | 'glm';
        linearIssueId?: string;
        linearIssueTitle?: string;
      };
      const userId = request.user?.userId ?? 'unknown-user';

      request.log.info({ userId, promptLength: body.prompt.length }, 'Submitting code task from UI');

      // Check rate limits (concurrent, hourly, daily/monthly cost, prompt length)
      const limitCheck = await rateLimitService.checkLimits(userId, body.prompt.length);
      if (!limitCheck.ok) {
        const { error } = limitCheck;
        request.log.warn({ userId, error }, 'Rate limit exceeded');

        // service_unavailable returns 503, other rate limits return 429
        const statusCode = error.code === 'service_unavailable' ? 503 : 429;
        reply.status(statusCode);

        const errorResponse: {
          success: false;
          error: {
            code: string;
            message: string;
            retryAfter?: string;
          };
        } = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        };

        // Only include retryAfter if it's defined
        if (error.retryAfter !== undefined) {
          errorResponse.error.retryAfter = error.retryAfter;
        }

        return errorResponse;
      }

      // Ensure Linear issue exists (create if not provided)
      const ensureParams: {
        linearIssueId?: string;
        linearIssueTitle?: string;
        taskPrompt: string;
      } = { taskPrompt: body.prompt };
      if ('linearIssueId' in body && body.linearIssueId !== undefined) {
        ensureParams.linearIssueId = body.linearIssueId;
      }
      if ('linearIssueTitle' in body && body.linearIssueTitle !== undefined) {
        ensureParams.linearIssueTitle = body.linearIssueTitle;
      }
      const issueResult = await linearIssueService.ensureIssueExists(ensureParams);

      // Create task with prompt deduplication (Layer 2 only - no actionId/approvalEventId)
      const createInput: {
        userId: string;
        prompt: string;
        sanitizedPrompt: string;
        systemPromptHash: string;
        workerType: 'opus' | 'auto' | 'glm';
        workerLocation: 'mac' | 'vm';
        repository: string;
        baseBranch: string;
        traceId: string;
        linearIssueId?: string;
        linearIssueTitle?: string;
        linearFallback?: boolean;
      } = {
        userId,
        prompt: body.prompt,
        sanitizedPrompt: body.prompt.trim().replace(/\s+/g, ' '),
        systemPromptHash: 'default', // TODO: Use actual system prompt hash
        workerType: body.workerType ?? 'auto',
        workerLocation: 'mac', // Will be overridden by dispatcher
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: `trace_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      };

      if (issueResult.linearIssueId !== '') {
        createInput.linearIssueId = issueResult.linearIssueId;
        createInput.linearIssueTitle = issueResult.linearIssueTitle;
      }
      if (issueResult.linearFallback) {
        createInput.linearFallback = true;
      }

      const createResult = await codeTaskRepo.create(createInput);

      if (!createResult.ok) {
        request.log.warn({ error: createResult.error }, 'Failed to create code task');

        if (createResult.error.code === 'DUPLICATE_PROMPT') {
          reply.status(409);
          return {
            success: false,
            error: {
              code: 'DUPLICATE_PROMPT',
              message: 'Similar task submitted in last 5 minutes',
              existingTaskId: createResult.error.existingTaskId,
            },
          };
        }

        if (createResult.error.code === 'ACTIVE_TASK_EXISTS') {
          reply.status(409);
          return {
            success: false,
            error: {
              code: 'ACTIVE_TASK_EXISTS',
              message: 'Active task already exists for this Linear issue',
              existingTaskId: createResult.error.existingTaskId,
            },
          };
        }

        reply.status(500);
        return {
          success: false,
          error: {
            code: createResult.error.code,
            message: createResult.error.message,
          },
        };
      }

      const task = createResult.value;

      // Dispatch to worker
      const dispatchInput: {
        taskId: string;
        linearIssueId?: string;
        prompt: string;
        systemPromptHash: string;
        repository: string;
        baseBranch: string;
        workerType: 'opus' | 'auto' | 'glm';
        webhookUrl: string;
        webhookSecret: string;
      } = {
        taskId: task.id,
        prompt: task.sanitizedPrompt,
        systemPromptHash: task.systemPromptHash,
        repository: task.repository,
        baseBranch: task.baseBranch,
        workerType: task.workerType,
        webhookUrl: `${process.env['INTEXURAOS_SERVICE_URL']}/internal/webhooks/task-complete`,
        webhookSecret: process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] ?? '',
      };

      if (task.linearIssueId !== undefined) {
        dispatchInput.linearIssueId = task.linearIssueId;
      }

      const dispatchResult = await taskDispatcher.dispatch(dispatchInput);

      if (!dispatchResult.ok) {
        request.log.error({ error: dispatchResult.error, taskId: task.id }, 'Failed to dispatch code task');

        // Update task with error
        await codeTaskRepo.update(task.id, {
          error: {
            code: dispatchResult.error.code,
            message: dispatchResult.error.message,
          },
        });

        reply.status(503);
        return {
          success: false,
          error: {
            code: 'DISPATCH_FAILED',
            message: 'Failed to dispatch task to worker',
          },
        };
      }

      // Record task start for rate limiting
      await rateLimitService.recordTaskStart(userId);

      // Mark Linear issue as In Progress after successful dispatch
      if (issueResult.linearIssueId !== '') {
        await linearIssueService.markInProgress(issueResult.linearIssueId);
      }

      request.log.info({ taskId: task.id, workerLocation: dispatchResult.value.workerLocation }, 'Code task submitted successfully');

      return reply.status(200).send({
        status: 'submitted',
        codeTaskId: task.id,
      });
    }
  );

  // GET /code/tasks - List user's tasks (public, Auth0 JWT)
  fastify.get<{
    Querystring: {
      status?: TaskStatus;
      limit?: number;
      cursor?: string;
    };
  }>(
    '/code/tasks',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'listCodeTasks',
        summary: 'List user code tasks',
        description: 'Public endpoint for listing user code tasks. Requires Auth0 JWT.',
        tags: ['public'],
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['dispatched', 'running', 'completed', 'failed', 'interrupted', 'cancelled'],
              description: 'Filter by task status',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
              description: 'Maximum number of tasks to return',
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous request',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: codeTaskSchema,
              },
              nextCursor: { type: 'string', nullable: true },
            },
          },
          401: {
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
    async (request: FastifyRequest<{ Querystring: { status?: TaskStatus; limit?: number; cursor?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/tasks',
        includeParams: true,
      });

      const { codeTaskRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';

      request.log.info({ userId, status: request.query.status }, 'Listing code tasks');

      const listInput: {
        userId: string;
        status?: TaskStatus;
        limit: number;
        cursor?: string;
      } = {
        userId,
        limit: request.query.limit ?? 20,
      };

      if (request.query.status !== undefined) {
        listInput.status = request.query.status;
      }

      if (request.query.cursor !== undefined) {
        listInput.cursor = request.query.cursor;
      }

      const listResult = await codeTaskRepo.list(listInput);

      if (!listResult.ok) {
        request.log.error({ error: listResult.error }, 'Failed to list code tasks');
        reply.status(500);
        return {
          success: false,
          error: {
            code: listResult.error.code,
            message: listResult.error.message,
          },
        };
      }

      return reply.status(200).send({
        tasks: listResult.value.tasks.map(taskToApiResponse),
        ...(listResult.value.nextCursor !== undefined && { nextCursor: listResult.value.nextCursor }),
      });
    }
  );

  // GET /code/tasks/:taskId - Get single task (public, Auth0 JWT)
  fastify.get<{
    Params: { taskId: string };
  }>(
    '/code/tasks/:taskId',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'getCodeTask',
        summary: 'Get code task details',
        description: 'Public endpoint for getting a single code task. Requires Auth0 JWT.',
        tags: ['public'],
        params: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID' },
          },
          required: ['taskId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              userId: { type: 'string' },
              prompt: { type: 'string' },
              sanitizedPrompt: { type: 'string' },
              systemPromptHash: { type: 'string' },
              workerType: { type: 'string' },
              workerLocation: { type: 'string' },
              repository: { type: 'string' },
              baseBranch: { type: 'string' },
              traceId: { type: 'string' },
              status: { type: 'string' },
              dedupKey: { type: 'string' },
              callbackReceived: { type: 'boolean' },
              linearIssueId: { type: 'string' },
              linearIssueTitle: { type: 'string' },
              linearFallback: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              dispatchedAt: { type: 'string', format: 'date-time', nullable: true },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
              result: { type: 'object', nullable: true },
              error: { type: 'object', nullable: true },
              statusSummary: { type: 'object', nullable: true },
            },
          },
          401: {
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
          403: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['FORBIDDEN'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          404: {
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
          500: {
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
    async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/tasks/:taskId',
        includeParams: true,
      });

      const { codeTaskRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';

      request.log.info({ userId, taskId: request.params.taskId }, 'Getting code task');

      const getResult = await codeTaskRepo.findByIdForUser(request.params.taskId, userId);

      if (!getResult.ok) {
        if (getResult.error.code === 'NOT_FOUND') {
          request.log.warn({ taskId: request.params.taskId, userId }, 'Code task not found');
          reply.status(404);
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Task ${request.params.taskId} not found`,
            },
          };
        }

        request.log.error({ error: getResult.error }, 'Failed to get code task');
        reply.status(500);
        return {
          success: false,
          error: {
            code: getResult.error.code,
            message: getResult.error.message,
          },
        };
      }

      return reply.status(200).send(taskToApiResponse(getResult.value));
    }
  );

  // POST /code/cancel - Cancel running task (public, Auth0 JWT)
  fastify.post<{
    Body: { taskId: string };
  }>(
    '/code/cancel',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'cancelCodeTask',
        summary: 'Cancel a running code task',
        description: 'Public endpoint for canceling a running task. Requires Auth0 JWT.',
        tags: ['public'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
          },
          required: ['taskId'],
        },
        response: {
          200: {
            description: 'Task cancelled successfully',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['cancelled'] },
            },
            required: ['status'],
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
          404: {
            description: 'Task not found',
            type: 'object',
            properties: {
              error: { type: 'string', enum: ['task_not_found'] },
            },
            required: ['error'],
          },
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              error: { type: 'string', enum: ['forbidden'] },
            },
            required: ['error'],
          },
          409: {
            description: 'Task not running',
            type: 'object',
            properties: {
              error: { type: 'string', enum: ['task_not_running'] },
            },
            required: ['error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { taskId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/cancel',
        includeParams: true,
      });

      const { codeTaskRepo, taskDispatcher, rateLimitService, statusMirrorService } = getServices();
      const { taskId } = request.body;
      const userId = request.user?.userId ?? 'unknown-user';

      request.log.info({ userId, taskId }, 'Cancelling code task');

      // Step 1: Fetch and validate task
      const taskResult = await codeTaskRepo.findById(taskId);

      if (!taskResult.ok) {
        request.log.warn({ taskId, errorCode: taskResult.error.code }, 'Task not found for cancellation');
        reply.status(404);
        return { error: 'task_not_found' };
      }

      const task = taskResult.value;

      // Step 2: Verify ownership
      if (task.userId !== userId) {
        request.log.warn({ taskId, taskUserId: task.userId, requestUserId: userId }, 'Cancellation forbidden - not task owner');
        reply.status(403);
        return { error: 'forbidden' };
      }

      // Step 3: Check task is cancellable
      if (!['dispatched', 'running'].includes(task.status)) {
        request.log.info({ taskId, status: task.status }, 'Cannot cancel task - not in running state');
        reply.status(409);
        return { error: 'task_not_running' };
      }

      // Step 4: Update Firestore status to cancelled (source of truth)
      const updateResult = await codeTaskRepo.update(taskId, { status: 'cancelled' });

      if (!updateResult.ok) {
        request.log.error({ taskId, error: updateResult.error }, 'Failed to update task status to cancelled');
        reply.status(500);
        return { error: 'failed_to_cancel' };
      }

      // Step 5: Record task completion for rate limiting
      rateLimitService.recordTaskComplete(userId).catch((err) => {
        request.log.error({ taskId, userId, error: err }, 'Failed to record task completion for rate limiting');
      });

      // Step 6: Notify worker to stop (best effort)
      try {
        await taskDispatcher.cancelOnWorker(taskId, task.workerLocation);
      } catch (error) {
        // Log but don't fail - task is already marked cancelled in Firestore
        request.log.warn({ taskId, error }, 'Failed to notify worker of cancellation');
      }

      // Step 6: Mirror cancelled status to action (non-fatal)
      await statusMirrorService.mirrorStatus({
        actionId: task.actionId,
        taskStatus: 'cancelled',
        traceId: extractOrGenerateTraceId(request.headers),
      });

      request.log.info({ taskId }, 'Code task cancelled successfully');

      return reply.status(200).send({ status: 'cancelled' });
    }
  );

  // GET /code/workers/status - Get worker health status (public, Auth0 JWT)
  fastify.get(
    '/code/workers/status',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'getWorkersStatus',
        summary: 'Get worker health status',
        description: 'Public endpoint for checking Mac and VM worker health. Requires Auth0 JWT.',
        tags: ['public'],
        response: {
          200: {
            description: 'Worker status',
            type: 'object',
            properties: {
              mac: {
                type: 'object',
                properties: {
                  healthy: { type: 'boolean' },
                  capacity: { type: 'number' },
                  checkedAt: { type: 'string', format: 'date-time' },
                },
                required: ['healthy', 'capacity', 'checkedAt'],
              },
              vm: {
                type: 'object',
                properties: {
                  healthy: { type: 'boolean' },
                  capacity: { type: 'number' },
                  checkedAt: { type: 'string', format: 'date-time' },
                },
                required: ['healthy', 'capacity', 'checkedAt'],
              },
            },
            required: ['mac', 'vm'],
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/workers/status',
      });

      const { workerDiscovery } = getServices();

      const [macResult, vmResult] = await Promise.all([
        workerDiscovery.checkHealth('mac'),
        workerDiscovery.checkHealth('vm'),
      ]);

      const macStatus = macResult.ok
        ? {
            healthy: macResult.value.healthy,
            capacity: macResult.value.capacity,
            checkedAt: macResult.value.checkedAt.toISOString(),
          }
        : { healthy: false, capacity: 0, checkedAt: new Date().toISOString() };

      const vmStatus = vmResult.ok
        ? {
            healthy: vmResult.value.healthy,
            capacity: vmResult.value.capacity,
            checkedAt: vmResult.value.checkedAt.toISOString(),
          }
        : { healthy: false, capacity: 0, checkedAt: new Date().toISOString() };

      return reply.status(200).send({ mac: macStatus, vm: vmStatus });
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

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for heartbeat');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { processHeartbeat } = getServices();
      const { taskIds } = request.body;

      request.log.info({ taskCount: taskIds.length }, 'Processing heartbeat for tasks');

      const result = await processHeartbeat(taskIds);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Heartbeat processing failed');
        reply.status(500);
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to process heartbeat' },
        };
      }

      return reply.status(200).send({ success: true, data: result.value });
    }
  );

  // POST /internal/code/detect-zombies - Cron endpoint for zombie detection (INT-371)
  fastify.post(
    '/internal/code/detect-zombies',
    {
      schema: {
        description: 'Detect and interrupt zombie tasks (cron endpoint)',
        tags: ['internal'],
        response: {
          200: {
            description: 'Zombie detection completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  detected: { type: 'number' },
                  interrupted: { type: 'number' },
                  errors: { type: 'array', items: { type: 'string' } },
                },
                required: ['detected', 'interrupted', 'errors'],
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
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
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
        message: 'Received request to POST /internal/code/detect-zombies',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for zombie detection');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { detectZombieTasks } = getServices();

      request.log.info('Starting zombie task detection');

      const result = await detectZombieTasks();

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Zombie detection failed');
        reply.status(500);
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to detect zombie tasks' },
        };
      }

      return reply.status(200).send({ success: true, data: result.value });
    }
  );

  // POST /internal/code/cancel-with-nonce - Cancel task via WhatsApp button (INT-379)
  fastify.post<{
    Body: {
      taskId: string;
      nonce: string;
      userId: string;
    };
  }>(
    '/internal/code/cancel-with-nonce',
    {
      schema: {
        operationId: 'cancelCodeTaskWithNonce',
        summary: 'Cancel a task using nonce validation',
        description: 'Internal endpoint for canceling tasks via WhatsApp button callback. Validates nonce, ownership, and expiration.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            nonce: { type: 'string' },
            userId: { type: 'string' },
          },
          required: ['taskId', 'nonce', 'userId'],
        },
        response: {
          200: {
            description: 'Task cancelled successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  cancelled: { type: 'boolean', enum: [true] },
                },
                required: ['cancelled'],
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
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          400: {
            description: 'Bad request (invalid nonce, expired, or task not cancellable)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    enum: ['invalid_nonce', 'nonce_expired', 'not_owner', 'task_not_cancellable'],
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
                  code: { type: 'string', enum: ['task_not_found'] },
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
                  code: { type: 'string', enum: ['internal_error'] },
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
        Body: { taskId: string; nonce: string; userId: string };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/cancel-with-nonce',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for cancel-with-nonce');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const services = getServices();
      const { taskId, nonce, userId } = request.body;

      request.log.info({ taskId, userId }, 'Processing cancel-with-nonce request');

      const result = await cancelTaskWithNonce(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskDispatcher: services.taskDispatcher,
        },
        { taskId, nonce, userId }
      );

      if (!result.ok) {
        const error = result.error;
        request.log.warn({ taskId, errorCode: error.code, errorMessage: error.message }, 'Cancel-with-nonce failed');

        if (error.code === 'task_not_found') {
          reply.status(404);
        } else if (error.code === 'internal_error') {
          reply.status(500);
        } else {
          reply.status(400);
        }

        return { success: false, error: { code: error.code, message: error.message } };
      }

      request.log.info({ taskId }, 'Task cancelled via nonce successfully');
      return reply.status(200).send({ success: true, data: { cancelled: true } });
    }
  );

  done();
};
