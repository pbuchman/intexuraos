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

  done();
};
