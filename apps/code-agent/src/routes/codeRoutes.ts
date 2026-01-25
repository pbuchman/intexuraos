/* eslint-disable */
import { Timestamp } from '@google-cloud/firestore';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processCodeAction } from '../domain/usecases/processCodeAction.js';
import type { TaskStatus } from '../domain/models/codeTask.js';

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

export const codeRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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
              error: { type: 'string', enum: ['unauthorized'] },
            },
            required: ['error'],
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
        return { error: 'unauthorized' };
      }

      const services = getServices();
      const body = request.body;

      request.log.info(
        {
          actionId: body.actionId,
          userId: body.userId,
          workerType: body.payload.workerType,
          repository: body.payload.repository,
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
      } = {
        actionId: body.actionId,
        approvalEventId: body.approvalEventId,
        userId: body.userId,
        prompt: body.payload.prompt,
        workerType: body.payload.workerType ?? 'auto',
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

      const { codeTaskRepo } = getServices();
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
    };
  }>(
    '/code/submit',
    {
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
                  code: { type: 'string', enum: ['RATE_LIMIT_EXCEEDED'] },
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

      // TODO: Replace with Auth0 JWT validation in INT-254
      // For now, using internal auth temporarily
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Auth failed for code task submission');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo, taskDispatcher } = getServices();
      const body = request.body;
      // TODO: Extract userId from Auth0 JWT in INT-254
      const userId = 'unknown-user';

      request.log.info({ userId, promptLength: body.prompt.length }, 'Submitting code task from UI');

      // Apply rate limiting: 10 tasks per day per user
      const countResult = await codeTaskRepo.countByUserToday(userId);
      if (!countResult.ok) {
        request.log.error({ error: countResult.error }, 'Failed to check rate limit');
        reply.status(500);
        return {
          success: false,
          error: {
            code: 'RATE_LIMIT_CHECK_FAILED',
            message: 'Failed to check rate limit',
          },
        };
      }

      const DAILY_LIMIT = 10;
      if (countResult.value >= DAILY_LIMIT) {
        request.log.warn({ userId, count: countResult.value }, 'Rate limit exceeded for code task submission');
        reply.status(429);
        return {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Maximum ${DAILY_LIMIT} tasks per day`,
          },
        };
      }

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

      if (body.linearIssueId !== undefined) {
        createInput.linearIssueId = body.linearIssueId;
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

      // TODO: Replace with Auth0 JWT validation in INT-254
      // For now, using internal auth temporarily
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Auth failed for code task list');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      // TODO: Extract userId from Auth0 JWT in INT-254
      const userId = 'unknown-user';

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

      // TODO: Replace with Auth0 JWT validation in INT-254
      // For now, using internal auth temporarily
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Auth failed for code task get');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      // TODO: Extract userId from Auth0 JWT in INT-254
      const userId = 'unknown-user';

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
              error: { type: 'string', enum: ['unauthorized'] },
            },
            required: ['error'],
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

      // TODO: Replace with Auth0 JWT validation in INT-254
      // For now, using internal auth temporarily
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Auth failed for code task cancellation');
        reply.status(401);
        return { error: 'unauthorized' };
      }

      const { codeTaskRepo, taskDispatcher } = getServices();
      const { taskId } = request.body;
      // TODO: Extract userId from Auth0 JWT in INT-254
      const userId = 'unknown-user';

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

      // Step 5: Notify worker to stop (best effort)
      try {
        await taskDispatcher.cancelOnWorker(taskId, task.workerLocation);
      } catch (error) {
        // Log but don't fail - task is already marked cancelled in Firestore
        request.log.warn({ taskId, error }, 'Failed to notify worker of cancellation');
      }

      request.log.info({ taskId }, 'Code task cancelled successfully');

      return reply.status(200).send({ status: 'cancelled' });
    }
  );

  done();
};
