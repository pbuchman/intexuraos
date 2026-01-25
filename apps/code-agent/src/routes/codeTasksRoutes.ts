/* eslint-disable */
import { Timestamp } from '@google-cloud/firestore';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { CreateTaskInput } from '../domain/repositories/codeTaskRepository.js';

// Request schema for creating a code task
const createCodeTaskBodySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    prompt: { type: 'string', minLength: 1 },
    sanitizedPrompt: { type: 'string', minLength: 1 },
    systemPromptHash: { type: 'string' },
    workerType: { type: 'string', enum: ['opus', 'auto', 'glm'] },
    workerLocation: { type: 'string', enum: ['mac', 'vm'] },
    repository: { type: 'string', minLength: 1 },
    baseBranch: { type: 'string', minLength: 1 },
    traceId: { type: 'string' },
    actionId: { type: 'string', nullable: true },
    approvalEventId: { type: 'string', nullable: true },
    linearIssueId: { type: 'string', nullable: true },
    linearIssueTitle: { type: 'string', nullable: true },
    linearFallback: { type: 'boolean', nullable: true },
  },
  required: [
    'userId',
    'prompt',
    'sanitizedPrompt',
    'systemPromptHash',
    'workerType',
    'workerLocation',
    'repository',
    'baseBranch',
    'traceId',
  ],
} as const;

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

interface CreateCodeTaskBody {
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  repository: string;
  baseBranch: string;
  traceId: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearFallback?: boolean;
}

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

/**
 * Map repository error to HTTP status code
 */
function getErrorStatus(error: { code: string; message: string }): number {
  switch (error.code) {
    case 'DUPLICATE_APPROVAL':
    case 'DUPLICATE_ACTION':
    case 'DUPLICATE_PROMPT':
    case 'ACTIVE_TASK_EXISTS':
      return 409; // Conflict
    case 'NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

export const codeTasksRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateCodeTaskBody }>(
    '/internal/code-tasks',
    {
      schema: {
        operationId: 'createCodeTask',
        summary: 'Create a new code task',
        description: 'Internal endpoint for creating code execution tasks. Returns task ID on success.',
        tags: ['internal'],
        body: createCodeTaskBodySchema,
        response: {
          201: {
            description: 'Task created successfully',
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
          409: {
            description: 'Duplicate task (deduplication triggered)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  existingTaskId: { type: 'string' },
                },
                required: ['code', 'message', 'existingTaskId'],
              },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Server error',
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
    async (request: FastifyRequest<{ Body: CreateCodeTaskBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code-tasks',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      const body = request.body;

      request.log.info(
        {
          userId: body.userId,
          workerType: body.workerType,
          workerLocation: body.workerLocation,
          repository: body.repository,
        },
        'Creating code task'
      );

      const input: CreateTaskInput = {
        userId: body.userId,
        prompt: body.prompt,
        sanitizedPrompt: body.sanitizedPrompt,
        systemPromptHash: body.systemPromptHash,
        workerType: body.workerType,
        workerLocation: body.workerLocation,
        repository: body.repository,
        baseBranch: body.baseBranch,
        traceId: body.traceId,
        ...(body.actionId !== undefined && { actionId: body.actionId }),
        ...(body.approvalEventId !== undefined && { approvalEventId: body.approvalEventId }),
        ...(body.linearIssueId !== undefined && { linearIssueId: body.linearIssueId }),
        ...(body.linearIssueTitle !== undefined && { linearIssueTitle: body.linearIssueTitle }),
        ...(body.linearFallback !== undefined && { linearFallback: body.linearFallback }),
      };

      const result = await codeTaskRepo.create(input);

      if (!result.ok) {
        const statusCode = getErrorStatus(result.error);
        request.log.warn(
          {
            errorCode: result.error.code,
            errorMessage: result.error.message,
            existingTaskId: 'existingTaskId' in result.error ? result.error.existingTaskId : undefined,
          },
          'Failed to create code task'
        );
        reply.status(statusCode);

        if (statusCode === 409 && 'existingTaskId' in result.error) {
          return {
            success: false,
            error: {
              code: result.error.code,
              message: result.error.message,
              existingTaskId: result.error.existingTaskId,
            },
          };
        }

        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      request.log.info({ taskId: result.value.id }, 'Code task created successfully');

      return await reply
        .status(201)
        .send({ success: true, data: { task: taskToApiResponse(result.value) } });
    }
  );

  fastify.get<{ Params: { taskId: string } }>(
    '/internal/code-tasks/:taskId',
    {
      schema: {
        operationId: 'getCodeTask',
        summary: 'Get a code task by ID',
        description: 'Internal endpoint for fetching a code task. Includes user ownership check.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
          },
          required: ['taskId'],
        },
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        response: {
          200: {
            description: 'Task found',
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
            description: 'Task not found or access denied',
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
        message: 'Received request to GET /internal/code-tasks/:taskId',
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
      const { userId } = request.query as { userId: string };

      request.log.info({ taskId, userId }, 'Fetching code task');

      const result = await codeTaskRepo.findByIdForUser(taskId, userId);

      if (!result.ok) {
        request.log.warn({ taskId, userId, errorCode: result.error.code }, 'Task not found or access denied');
        reply.status(404);
        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      request.log.info({ taskId, userId }, 'Code task retrieved successfully');

      return await reply.send({ success: true, data: { task: taskToApiResponse(result.value) } });
    }
  );

  fastify.get<{
    Querystring: {
      userId: string;
      status?: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
      limit?: number;
      cursor?: string;
    };
  }>(
    '/internal/code-tasks',
    {
      schema: {
        operationId: 'listCodeTasks',
        summary: 'List code tasks',
        description: 'Internal endpoint for listing code tasks with optional status filter and pagination.',
        tags: ['internal'],
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['dispatched', 'running', 'completed', 'failed', 'interrupted', 'cancelled'],
            },
            limit: { type: 'number', minimum: 1, maximum: 100 },
            cursor: { type: 'string' },
          },
          required: ['userId'],
        },
        response: {
          200: {
            description: 'List of tasks',
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
                  nextCursor: { type: 'string', nullable: true },
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
    async (request: FastifyRequest<{ Querystring: { userId: string; status?: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'; limit?: number; cursor?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/code-tasks',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        reply.status(401);
        return { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
      }

      const { codeTaskRepo } = getServices();
      const { userId, status, limit, cursor } = request.query;

      request.log.info({ userId, status, limit, cursor }, 'Listing code tasks');

      const result = await codeTaskRepo.list({
        userId,
        ...(status !== undefined && { status }),
        ...(limit !== undefined && { limit }),
        ...(cursor !== undefined && { cursor }),
      });

      if (!result.ok) {
        request.log.error({ userId, error: result.error }, 'Failed to list code tasks');
        reply.status(500);
        return {
          success: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }

      request.log.info({ userId, count: result.value.tasks.length }, 'Code tasks listed successfully');

      return await reply.send({
        success: true,
        data: {
          tasks: result.value.tasks.map(taskToApiResponse),
          ...(result.value.nextCursor !== undefined && { nextCursor: result.value.nextCursor }),
        },
      });
    }
  );

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

  done();
};
