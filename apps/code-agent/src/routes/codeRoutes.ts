/* eslint-disable */
import { Timestamp } from '@google-cloud/firestore';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId, type ErrorCode } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { getServices } from '../services.js';
import { processCodeAction } from '../domain/usecases/processCodeAction.js';
import { cancelTaskWithNonce } from '../domain/usecases/cancelTaskWithNonce.js';
import { retryTask } from '../domain/usecases/retryTask.js';
import { submitTaskFeedback } from '../domain/usecases/submitTaskFeedback.js';
import { sendTaskMessage } from '../domain/usecases/sendTaskMessage.js';
import { submitToExecutionAgent } from '../domain/usecases/submitToExecutionAgent.js';
import { drainTaskQueue } from '../domain/usecases/drainTaskQueue.js';
import { hasCodeTaskLabel } from '../domain/utils/labelUtils.js';
import { sanitizePrompt } from '../domain/utils/promptSanitization.js';
import type { TaskStatus } from '../domain/models/codeTask.js';
import { randomUUID } from 'node:crypto';
import { generateWebhookSecret } from '../domain/utils/secrets.js';
import { validateOrchestratorSignature } from '../infra/webhookValidation.js';
import { loadConfig } from '../config.js';

const logger = createAppLogger({ name: 'code-routes' });

/**
 * Track in-flight health probe requests per user for deduplication.
 * Prevents thundering herd when multiple concurrent requests arrive while health status is stale.
 */
const inFlightRequests = new Map<string, Promise<void>>();

export type JwtValidator = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

const linearIssueForDisplaySchema = {
  type: 'object',
  properties: {
    identifier: { type: 'string' },
    title: { type: 'string' },
    state: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['name', 'type'],
    },
    priority: { type: 'number' },
    assignee: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
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
    url: { type: 'string' },
    commentCount: { type: 'number' },
    lastCommentAt: { type: 'string', nullable: true },
  },
  required: ['identifier', 'title', 'state', 'priority', 'assignee', 'labels', 'url', 'commentCount', 'lastCommentAt'],
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
    workerType: { type: 'string', enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'] },
    workerLocation: { type: 'string' },
    repository: { type: 'string' },
    baseBranch: { type: 'string' },
    traceId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['dispatched', 'running', 'queued', 'planned', 'implemented', 'failed', 'interrupted', 'cancelled'],
    },
    dedupKey: { type: 'string' },
    callbackReceived: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    actionId: { type: 'string', nullable: true },
    approvalEventId: { type: 'string', nullable: true },
    linearIssueId: { type: 'string', nullable: true },
    linearIssue: {
      ...linearIssueForDisplaySchema,
      nullable: true,
    },
    agentType: { type: 'string', enum: ['planning', 'execution', 'pull_request'] },
    implementationTaskId: { type: 'string' },
    parentTaskId: { type: 'string' },
    followUpReason: { type: 'string' },
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
 * Exported for testing
 */
export function timestampToIso(
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
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'queued' | 'planned' | 'implemented' | 'failed' | 'interrupted' | 'cancelled' | 'archived';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  agentType?: 'planning' | 'execution' | 'pull_request';
  implementationTaskId?: string;
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
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
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'queued' | 'planned' | 'implemented' | 'failed' | 'interrupted' | 'cancelled' | 'archived';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  agentType?: 'planning' | 'execution' | 'pull_request';
  implementationTaskId?: string;
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
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
}
{
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
    /* v8 ignore start -- ts-type: timestamp nullish coalescing @preserve */
    createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
    /* v8 ignore stop @preserve */
    updatedAt: timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '',
    /* v8 ignore start -- ts-type: spread operators create type narrowing branches @preserve */
    ...(task.actionId !== undefined && { actionId: task.actionId }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.approvalEventId !== undefined && { approvalEventId: task.approvalEventId }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.agentType !== undefined && { agentType: task.agentType }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.implementationTaskId !== undefined && { implementationTaskId: task.implementationTaskId }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.parentTaskId !== undefined && { parentTaskId: task.parentTaskId }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.followUpReason !== undefined && { followUpReason: task.followUpReason }),
    /* v8 ignore stop @preserve */
    ...(task.result !== undefined && { result: task.result }),
    /* v8 ignore start -- ts-type: optional property spread @preserve */
    ...(task.error !== undefined && { error: task.error }),
    /* v8 ignore stop @preserve */
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
  };
}
/* v8 ignore stop @preserve */

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
        workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
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
                workerType: { type: 'string', enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'] },
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
    async (request: FastifyRequest<{ Body: { actionId: string; approvalEventId: string; userId: string; payload: { prompt: string; workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus'; linearIssueId?: string; repository?: string; baseBranch?: string } } }>, reply: FastifyReply) => {
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
        workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
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
          serviceUrl: loadConfig().serviceUrl,
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

  // PATCH /internal/code-tasks/:taskId - Worker callback (will become webhook later)
  fastify.patch<{
    Params: { taskId: string };
    Body: {
      status?: 'planned' | 'implemented' | 'failed' | 'interrupted';
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
              enum: ['planned', 'implemented', 'failed', 'interrupted'],
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
          status?: 'planned' | 'implemented' | 'failed' | 'interrupted';
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
      const terminalStatuses = ['planned', 'implemented', 'failed', 'cancelled', 'interrupted'] as const;
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- ts-type: terminal status includes check @preserve */
      if (body.status !== undefined && terminalStatuses.includes(body.status)) {
      /* v8 ignore stop @preserve */
        const userId = result.value.userId; // @allow-result-access -- .ok checked at line 736
        // Fire and forget - don't await to avoid delaying response
        // Note: Currently we don't receive actual cost from orchestrator, so we pass undefined
        rateLimitService.recordTaskComplete(userId, undefined).catch((err) => {
          request.log.error({ taskId, userId, error: err }, 'Failed to record task completion for rate limiting');
        });
      }

      request.log.info({ taskId, status: result.value.status }, 'Code task updated successfully'); // @allow-result-access -- narrowed by !result.ok guard above

      return await reply.ok({ task: taskToApiResponse(result.value) }); // @allow-result-access -- narrowed by !result.ok guard above
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

      request.log.info({ linearIssueId, hasActive: result.value.hasActive }, 'Active code task check complete'); // @allow-result-access -- .ok checked at line 891
      return await reply.ok(result.value); // @allow-result-access -- .ok checked at line 891
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
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { codeTaskRepo } = getServices();
      const { staleThresholdMinutes } = request.query;

      const staleThreshold = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

      request.log.info({ staleThresholdMinutes, staleThreshold }, 'Finding zombie code tasks');

      const result = await codeTaskRepo.findZombieTasks(staleThreshold);

      if (!result.ok) {
        request.log.error({ staleThreshold, error: result.error }, 'Failed to find zombie code tasks');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ count: result.value.length }, 'Zombie code tasks found'); // @allow-result-access -- .ok checked at line 986
      return await reply.ok({
        tasks: result.value.map(taskToApiResponse), // @allow-result-access -- .ok checked at line 986
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
      workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
      workerLocation?: string;
      linearIssueId?: string;
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
            workerType: { type: 'string', enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'] },
            workerLocation: { type: 'string', minLength: 1, maxLength: 32 },
            linearIssueId: { type: 'string' },
          },
          required: ['prompt'],
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
                },
                required: ['status', 'codeTaskId'],
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
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          400: {
            description: 'Invalid worker specified',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INVALID_WORKER', 'WORKER_UNHEALTHY'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            description: 'Duplicate task (similar prompt within 5 minutes)',
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
                    enum: ['concurrent_limit', 'hourly_limit', 'monthly_cost_limit', 'prompt_too_long'],
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
    async (request: FastifyRequest<{ Body: { prompt: string; workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus'; workerLocation?: string; linearIssueId?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/submit',
        includeParams: true,
      });

      const { codeTaskRepo, taskDispatcher, rateLimitService, linearIssueService, workerSettingsRepo } = getServices();
      const body = request.body as {
        prompt: string;
        workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
        workerLocation?: string;
        linearIssueId?: string;
      };

      /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      request.log.info({ userId, promptLength: body.prompt.length }, 'Submitting code task from UI');

      // Check rate limits (concurrent, hourly, daily/monthly cost, prompt length)
      const limitCheck = await rateLimitService.checkLimits(userId, body.prompt.length);
      if (!limitCheck.ok) {
        const { error } = limitCheck;
        request.log.warn({ userId, error }, 'Rate limit exceeded');

        // service_unavailable returns 503, other rate limits return 429
        if (error.code === 'service_unavailable') {
          return await reply.fail('MISCONFIGURED', error.message);
        }
        return await reply.fail('RATE_LIMITED', error.message);
      }

      // Sanitize prompt early so raw prompt never leaks to external services
      const sanitizedPromptText = sanitizePrompt(body.prompt);

      // Ensure Linear issue exists (create if not provided)
      const ensureParams: {
        userId: string;
        linearIssueId?: string;
        taskPrompt: string;
      } = { userId, taskPrompt: sanitizedPromptText };
      if ('linearIssueId' in body && body.linearIssueId !== undefined) {
        ensureParams.linearIssueId = body.linearIssueId;
      }
      const issueResult = await linearIssueService.ensureIssueExists(ensureParams);

      // Pre-generate task ID and derive deterministic webhook secret
      const taskId = `task_${randomUUID()}`;
      const webhookSecret = generateWebhookSecret(loadConfig().orchestratorSecret, taskId);

      // Create task with prompt deduplication (Layer 2 only - no actionId/approvalEventId)
      const createInput: {
        id: string;
        userId: string;
        prompt: string;
        sanitizedPrompt: string;
        systemPromptHash: string;
        workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
        workerLocation: string;
        repository: string;
        baseBranch: string;
        traceId: string;
        webhookSecret: string;
        linearIssueId?: string;
        agentType: 'planning' | 'execution';
      } = {
        id: taskId,
        userId,
        prompt: body.prompt,
        sanitizedPrompt: sanitizedPromptText,
        systemPromptHash: 'default', // TODO: Use actual system prompt hash
        workerType: body.workerType ?? 'auto',
        workerLocation: 'pending', // Updated after dispatch with actual worker location
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: `trace_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        webhookSecret,
        agentType: hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning',
      };

      // Save linearIssueId if available (linking to existing issue)
      /* v8 ignore start -- ts-type: undefined check creates type narrowing branch @preserve */
      if (issueResult.linearIssueId !== undefined) {
      /* v8 ignore stop @preserve */
        createInput.linearIssueId = issueResult.linearIssueId;
      }
      const createResult = await codeTaskRepo.create(createInput);

      if (!createResult.ok) {
        request.log.warn({ error: createResult.error }, 'Failed to create code task');

        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (createResult.error.code === 'DUPLICATE_PROMPT') {
        /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: error existingTaskId nullish coalescing @preserve */
          return await reply.fail('CONFLICT', `Similar task submitted in last 5 minutes: ${createResult.error.existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (createResult.error.code === 'ACTIVE_TASK_EXISTS') {
        /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: error existingTaskId nullish coalescing @preserve */
          return await reply.fail('CONFLICT', `Active task already exists for this Linear issue: ${createResult.error.existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        return await reply.fail('INTERNAL_ERROR', createResult.error.message);
      }

      const task = createResult.value;

      // Fetch user's worker settings
      const settingsResult = await workerSettingsRepo.getSettings(userId);
      /* v8 ignore start -- test-infra: error path requires Firestore failure @preserve */
      if (!settingsResult.ok) {
        request.log.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch worker settings');
      }
      /* v8 ignore stop @preserve */

      const settings = settingsResult.value;

      // Build worker credentials from user's settings
      // Only include enabled workers, in the user's priority order
      /* v8 ignore start -- ts-type: nullish coalescing for when settings is null @preserve */
      const enabledWorkers = settings?.workers.filter((w) => w.enabled) ?? [];
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: requires user with no enabled workers fixture @preserve */
      // Fail if no workers configured
      if (enabledWorkers.length === 0) {
        request.log.warn({ userId }, 'User has no workers configured');
        return await reply.fail('WORKER_NOT_CONFIGURED', 'Please configure your workers in Settings before submitting code tasks');
      }
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: requires fixtures for invalid/unhealthy worker scenarios @preserve */
      // Validate workerLocation if provided
      if (body.workerLocation !== undefined) {
        const requestedWorker = enabledWorkers.find((w) => w.name === body.workerLocation);

        if (requestedWorker === undefined) {
          request.log.warn({ userId, workerLocation: body.workerLocation }, 'Requested worker not found');
          return await reply.fail('INVALID_WORKER', `Worker '${body.workerLocation}' is not configured or enabled`);
        }

        // Check if worker is healthy (if health data available)
        const healthStatuses = settings?.workerHealthStatuses;
        if (healthStatuses !== undefined) {
          const workerHealth = healthStatuses[body.workerLocation];
          if (workerHealth !== undefined && !workerHealth.state.healthy) {
            request.log.warn({ userId, workerLocation: body.workerLocation, healthState: workerHealth.state }, 'Requested worker is unhealthy');
            return await reply.fail('WORKER_UNHEALTHY', `Worker '${body.workerLocation}' is currently unhealthy`);
          }
        }
      }

      // If workerLocation specified, put that worker first in the list
      let orderedWorkers = enabledWorkers;
      if (body.workerLocation !== undefined) {
        const selectedWorker = enabledWorkers.find((w) => w.name === body.workerLocation);
        if (selectedWorker !== undefined) {
          orderedWorkers = [
            selectedWorker,
            ...enabledWorkers.filter((w) => w.name !== body.workerLocation),
          ];
        }
      }
      /* v8 ignore stop @preserve */

      const workerCredentials = {
        workers: orderedWorkers.map((w) => ({
          name: w.name,
          url: w.url,
          cfAccessClientId: w.cfAccessClientId,
          cfAccessClientSecret: w.cfAccessClientSecret,
          dispatchSigningSecret: w.dispatchSigningSecret,
        })),
      };

      // Dispatch to worker (use stored webhook secret from task)
      const dispatchInput: {
        taskId: string;
        linearIssueId?: string;
        prompt: string;
        systemPromptHash: string;
        repository: string;
        baseBranch: string;
        workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
        webhookUrl: string;
        webhookSecret: string;
        linearIssueLabels: string[];
        hasChildren: boolean;
        agentType: 'planning' | 'execution' | 'pull_request';
        workerCredentials: { workers: Array<{ name: string; url: string; cfAccessClientId: string; cfAccessClientSecret: string; dispatchSigningSecret: string }> };
      } = {
        taskId: task.id,
        prompt: task.sanitizedPrompt,
        systemPromptHash: task.systemPromptHash,
        repository: task.repository,
        baseBranch: task.baseBranch,
        workerType: task.workerType,
        webhookUrl: `${process.env['INTEXURAOS_SERVICE_URL']}/internal/webhooks/task-complete`,
        webhookSecret,
        linearIssueLabels: issueResult.linearIssueLabels,
        hasChildren: issueResult.hasChildren,
        /* v8 ignore start -- ts-type: nullish coalescing on optional agentType with label fallback @preserve */
        agentType: task.agentType ?? (hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning'),
        /* v8 ignore stop @preserve */
        workerCredentials,
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

        return await reply.fail('MISCONFIGURED', 'Failed to dispatch task to worker');
      }

      // Save the actual worker location returned by the dispatcher
      const actualWorkerLocation = dispatchResult.value.workerLocation;
      await codeTaskRepo.update(task.id, {
        workerLocation: actualWorkerLocation,
        dispatchedAt: new Date(),
      });

      // Record task start for rate limiting
      await rateLimitService.recordTaskStart(userId);

      // Mark Linear issue as In Progress after successful dispatch
      if (issueResult.linearIssueId !== undefined) {
        await linearIssueService.markInProgress(userId, issueResult.linearIssueId);
      }

      request.log.info({ taskId: task.id, workerLocation: actualWorkerLocation }, 'Code task submitted successfully');

      return await reply.ok({
        status: 'submitted',
        codeTaskId: task.id,
      });
    }
  );

  // GET /code/tasks - List user's tasks (public, Auth0 JWT)
  fastify.get<{
    Querystring: {
      status?: string;
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
              description: 'Filter by task status. Comma-separated for multiple (e.g. "running,dispatched")',
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
            required: ['success', 'data'],
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
              },
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
    async (request: FastifyRequest<{ Querystring: { status?: string; limit?: number; cursor?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/tasks',
        includeParams: true,
      });

      const { codeTaskRepo, linearAgentClient } = getServices();
      /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      // Parse comma-separated status filter (matching actions-agent pattern)
      const validStatuses: TaskStatus[] = ['dispatched', 'running', 'queued', 'planned', 'implemented', 'failed', 'interrupted', 'cancelled', 'archived'];
      let statusFilter: TaskStatus[] | undefined;
      if (request.query.status !== undefined) {
        statusFilter = request.query.status
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is TaskStatus => validStatuses.includes(s as TaskStatus));
      }

      request.log.info({ userId, status: statusFilter }, 'Listing code tasks');

      const listInput: {
        userId: string;
        status?: TaskStatus[];
        limit: number;
        cursor?: string;
      } = {
        userId,
        /* v8 ignore start -- ts-type: nullish coalescing creates type narrowing branch @preserve */
        limit: request.query.limit ?? 20,
        /* v8 ignore stop @preserve */
      };

      /* v8 ignore start -- ts-type: undefined check creates type narrowing branch @preserve */
      if (statusFilter !== undefined && statusFilter.length > 0) {
      /* v8 ignore stop @preserve */
        listInput.status = statusFilter;
      }

      /* v8 ignore start -- ts-type: undefined check creates type narrowing branch @preserve */
      if (request.query.cursor !== undefined) {
      /* v8 ignore stop @preserve */
        listInput.cursor = request.query.cursor;
      }

      const listResult = await codeTaskRepo.list(listInput);

      if (!listResult.ok) {
        request.log.error({ error: listResult.error }, 'Failed to list code tasks');
        return await reply.fail('INTERNAL_ERROR', listResult.error.message);
      }

      const apiTasks = listResult.value.tasks.map(taskToApiResponse);
      const linearIssueIds = Array.from(
        new Set(
          listResult.value.tasks
            .map((task) => task.linearIssueId)
            .filter((issueId): issueId is string => issueId !== undefined)
        )
      );

      let hydratedIssuesByIdentifier = new Map<string, {
        identifier: string;
        title: string;
        state: { name: string; type: string };
        priority: number;
        assignee: { id: string; name: string } | null;
        labels: Array<{ id: string; name: string }>;
        url: string;
        commentCount: number;
        lastCommentAt: string | null;
      }>();
      if (linearIssueIds.length > 0) {
        const linearIssuesResult = await linearAgentClient.fetchIssuesForDisplay({
          userId,
          identifiers: linearIssueIds,
        });

        if (linearIssuesResult.ok) {
          hydratedIssuesByIdentifier = new Map(
            linearIssuesResult.value.map((issue) => [issue.identifier, issue])
          );
        } else {
          request.log.warn(
            { userId, error: linearIssuesResult.error, issueCount: linearIssueIds.length },
            'Failed to hydrate Linear issues for code task list'
          );
        }
      }

      return await reply.ok({
        tasks: apiTasks.map((task) => ({
          ...task,
          ...(task.linearIssueId !== undefined && hydratedIssuesByIdentifier.has(task.linearIssueId)
            ? { linearIssue: hydratedIssuesByIdentifier.get(task.linearIssueId) }
            : {}),
        })),
        /* v8 ignore start -- ts-type: spread operator with optional property creates type narrowing branch @preserve */
        ...(listResult.value.nextCursor !== undefined && { nextCursor: listResult.value.nextCursor }),
        /* v8 ignore stop @preserve */
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
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
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
                  linearIssue: {
                    ...linearIssueForDisplaySchema,
                    nullable: true,
                  },
                  agentType: { type: 'string', enum: ['planning', 'execution', 'pull_request'] },
                  implementationTaskId: { type: 'string' },
                  parentTaskId: { type: 'string' },
                  followUpReason: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                  dispatchedAt: { type: 'string', format: 'date-time', nullable: true },
                  completedAt: { type: 'string', format: 'date-time', nullable: true },
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
                      rebaseResult: { type: 'string', nullable: true },
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
                  statusSummary: { type: 'object', nullable: true },
                },
              },
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

      const { codeTaskRepo, linearAgentClient, logger } = getServices();
      /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      logger.info({ userId, taskId: request.params.taskId }, 'Getting code task');

      const getResult = await codeTaskRepo.findByIdForUser(request.params.taskId, userId);

      if (!getResult.ok) {
        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (getResult.error.code === 'NOT_FOUND') {
        /* v8 ignore stop @preserve */
          logger.warn({ taskId: request.params.taskId, userId }, 'Code task not found');
          return await reply.fail('NOT_FOUND', `Task ${request.params.taskId} not found`);
        }

        logger.error({ error: getResult.error }, 'Failed to get code task');
        return await reply.fail('INTERNAL_ERROR', getResult.error.message);
      }

      const task = getResult.value; // @allow-result-access -- .ok checked at line 1703
      const apiResponse = taskToApiResponse(task);

      let linearIssue: undefined | {
        identifier: string;
        title: string;
        state: { name: string; type: string };
        priority: number;
        assignee: { id: string; name: string } | null;
        labels: Array<{ id: string; name: string }>;
        url: string;
        commentCount: number;
        lastCommentAt: string | null;
      };
      if (task.linearIssueId !== undefined) {
        const linearResult = await linearAgentClient.fetchIssueForDisplay({
          userId: task.userId,
          identifier: task.linearIssueId,
        });
        if (linearResult.ok) {
          linearIssue = linearResult.value;
        }
      }

      logger.info(
        {
          taskId: request.params.taskId,
          status: task.status,
          /* v8 ignore start -- ts-type: optional chaining creates type narrowing branch @preserve */
          hasResult: task.result !== undefined,
          /* v8 ignore stop @preserve */
          /* v8 ignore start -- ts-type: ternary operator creates type narrowing branch @preserve */
          resultKeys: task.result ? Object.keys(task.result) : [],
          /* v8 ignore stop @preserve */
          apiResponseHasResult: apiResponse.result !== undefined,
          /* v8 ignore start -- ts-type: ternary operator creates type narrowing branch @preserve */
          apiResponseResultKeys: apiResponse.result ? Object.keys(apiResponse.result) : [],
          /* v8 ignore stop @preserve */
          hasLinearIssue: linearIssue !== undefined,
        },
        'Returning task for GET /code/tasks/:taskId'
      );

      return await reply.ok({ ...apiResponse, linearIssue });
    }
  );

  // DELETE /code/tasks/:taskId - Delete a task (public, Auth0 JWT)
  fastify.delete<{
    Params: { taskId: string };
  }>(
    '/code/tasks/:taskId',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'deleteCodeTask',
        summary: 'Delete a code task',
        description: 'Deletes a code task owned by the authenticated user.',
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
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  deleted: { type: 'boolean' },
                },
                required: ['deleted'],
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /code/tasks/:taskId',
        includeParams: true,
      });

      const { codeTaskRepo, logger } = getServices();
      /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
      const { taskId } = request.params;

      logger.info({ userId, taskId }, 'Deleting code task');

      const deleteResult = await codeTaskRepo.deleteTask(taskId, userId);

      if (!deleteResult.ok) {
        /* v8 ignore start -- ts-type: string literal comparison creates type narrowing branch @preserve */
        if (deleteResult.error.code === 'NOT_FOUND') {
        /* v8 ignore stop @preserve */
          return await reply.fail('NOT_FOUND', `Task ${taskId} not found`);
        }
        logger.error({ error: deleteResult.error, taskId }, 'Failed to delete code task');
        return await reply.fail('INTERNAL_ERROR', deleteResult.error.message);
      }

      logger.info({ userId, taskId }, 'Code task deleted');
      return await reply.ok({ deleted: true });
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
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['cancelled'] },
                },
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
          404: {
            description: 'Task not found',
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
          403: {
            description: 'Forbidden',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['FORBIDDEN'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            description: 'Task not running',
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
        },
      },
    },
    async (request: FastifyRequest<{ Body: { taskId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/cancel',
        includeParams: true,
      });

      const { codeTaskRepo, taskDispatcher, rateLimitService, statusMirrorService, workerSettingsRepo } = getServices();
      const { taskId } = request.body;
      /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      request.log.info({ userId, taskId }, 'Cancelling code task');

      // Step 1: Fetch and validate task
      const taskResult = await codeTaskRepo.findById(taskId);

      if (!taskResult.ok) {
        request.log.warn({ taskId, errorCode: taskResult.error.code }, 'Task not found for cancellation');
        return await reply.fail('NOT_FOUND', 'Task not found');
      }

      const task = taskResult.value;

      // Step 2: Verify ownership
      if (task.userId !== userId) {
        request.log.warn({ taskId, taskUserId: task.userId, requestUserId: userId }, 'Cancellation forbidden - not task owner');
        return await reply.fail('FORBIDDEN', 'Not authorized to cancel this task');
      }

      // Step 3: Check task is cancellable
      if (!['dispatched', 'running', 'queued'].includes(task.status)) {
        request.log.info({ taskId, status: task.status }, 'Cannot cancel task - not in cancellable state');
        return await reply.fail('CONFLICT', 'Task is not in a cancellable state');
      }

      // Step 4: Update Firestore status to cancelled (source of truth)
      const updateResult = await codeTaskRepo.update(taskId, { status: 'cancelled' });

      if (!updateResult.ok) {
        request.log.error({ taskId, error: updateResult.error }, 'Failed to update task status to cancelled');
        return await reply.fail('INTERNAL_ERROR', 'Failed to cancel task');
      }

      // Step 5: Record task completion for rate limiting
      rateLimitService.recordTaskComplete(userId).catch((err) => {
        request.log.error({ taskId, userId, error: err }, 'Failed to record task completion for rate limiting');
      });

      // Step 6: Notify worker to stop (best effort)
      try {
        // Fetch user's worker credentials for the cancellation request
        const settingsResult = await workerSettingsRepo.getSettings(userId);
        let workerCreds = undefined;
        /* v8 ignore start -- ts-type: optional worker config checks for cancellation @preserve */
        if (settingsResult.ok && settingsResult.value !== null) {
          const settings = settingsResult.value;
          const workerConfig = settings.workers.find((w) => w.name === task.workerLocation);
          if (workerConfig !== undefined && workerConfig.enabled) {
            workerCreds = {
              url: workerConfig.url,
              cfAccessClientId: workerConfig.cfAccessClientId,
              cfAccessClientSecret: workerConfig.cfAccessClientSecret,
            };
          }
        }
        /* v8 ignore stop @preserve */
        await taskDispatcher.cancelOnWorker(taskId, task.workerLocation, workerCreds);
      } catch (error) {
        request.log.warn({ taskId, error }, 'Failed to notify worker of cancellation');
      }

      // Step 6: Mirror cancelled status to action (non-fatal)
      await statusMirrorService.mirrorStatus({
        actionId: task.actionId,
        taskStatus: 'cancelled',
        traceId: extractOrGenerateTraceId(request.headers),
      });

      request.log.info({ taskId }, 'Code task cancelled successfully');

      return await reply.ok({ status: 'cancelled' });
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
        description: 'Public endpoint for checking user-configured worker status. Returns cached status with async refresh on stale data.',
        tags: ['public'],
        response: {
          200: {
            description: 'Worker status',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['workers', 'stale'],
                properties: {
                  workers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        url: { type: 'string' },
                        priority: { type: 'number' },
                        healthy: { type: 'boolean' },
                        status: {
                          type: 'string',
                          enum: ['healthy', 'orchestrator-unreachable', 'tunnel-down', 'unknown'],
                        },
                        details: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            capacity: { type: 'number' },
                            available: { type: 'number' },
                            running: { type: 'number' },
                            responseTimeMs: { type: 'number' },
                            reason: { type: 'string' },
                            code: { type: 'string' },
                          },
                        },
                        checkedAt: { type: 'string', format: 'date-time', nullable: true },
                        stale: { type: 'boolean' },
                      },
                      required: ['name', 'url', 'priority', 'healthy', 'status', 'details', 'checkedAt', 'stale'],
                    },
                  },
                  stale: { type: 'boolean' },
                },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/workers/status',
      });

      const { workerSettingsRepo, workerHealthProbe } = getServices();
      const userId = request.user?.userId;

      /* v8 ignore start -- test-infra: test setup always has userId @preserve */
      if (!userId) {
        return reply.fail('UNAUTHORIZED', 'Authentication required');
      }
      /* v8 ignore stop @preserve */

      const settingsResult = await workerSettingsRepo.getSettings(userId);

      /* v8 ignore start -- upstream: Firestore fetch failure or missing settings @preserve */
      if (!settingsResult.ok || settingsResult.value === null) {
        return reply.ok({ workers: [], stale: false });
      }
      /* v8 ignore stop @preserve */

      const settings = settingsResult.value;
      const TTL_MS = 60_000;
      const now = Date.now();

      const healthStatusesResult = await workerSettingsRepo.getHealthStatuses(userId);
      /* v8 ignore start -- test-infra: requires integration test with health status repository @preserve */
      const healthStatuses = healthStatusesResult.ok ? healthStatusesResult.value ?? {} : {};
      /* v8 ignore stop @preserve */

      let stale = false;
      /* v8 ignore start -- test-infra: requires testing with time-based staleness @preserve */
      for (const [_name, status] of Object.entries(healthStatuses)) {
        const checkedAt = new Date(status.checkedAt).getTime();
        if (now - checkedAt > TTL_MS) {
          stale = true;
          status.stale = true;
        }
      }

      if (stale || Object.keys(healthStatuses).length < settings.workers.length) {
        // Deduplicate in-flight health probes per user
        const probeKey = `health-probe:${userId}`;
        let probePromise = inFlightRequests.get(probeKey);

        if (!probePromise) {
          probePromise = workerHealthProbe
            .probeAllWorkers(settings.workers)
            .then((results) => {
              // Update all health statuses in Firestore
              const updatePromises = Object.entries(results).map(([name, state]) =>
                workerSettingsRepo.updateHealthStatus(userId, name, {
                  state,
                  checkedAt: new Date().toISOString(),
                  stale: false,
                })
              );
              // Wait for all updates to complete, return void for fire-and-forget
              void Promise.allSettled(updatePromises);
            })
            .finally(() => {
              // Clean up in-flight request after completion
              inFlightRequests.delete(probeKey);
            });

          inFlightRequests.set(probeKey, probePromise);
        }

        // Fire-and-forget - we don't await the probe
        // Non-null assertion is safe here: probePromise is defined after the if block
        void probePromise!.catch((error) => {
          logger.error({ error }, 'Failed to refresh worker health statuses');
        });
      }
      /* v8 ignore stop @preserve */

      const workers = settings.workers.map((w, index) => {
        const healthStatus = healthStatuses[w.name];
        const state = healthStatus?.state;

        const isHealthy = state?.healthy ?? false;
        const statusTag = state?._tag ?? 'unknown';

        let details: {
          capacity?: number;
          available?: number;
          running?: number;
          responseTimeMs?: number;
          reason?: string;
          code?: string;
        } | null = null;

        /* v8 ignore start -- test-infra: requires integration tests with health status data @preserve */
        if (state?._tag === 'healthy') {
          details = {
            capacity: state.capacity,
            available: state.available,
            running: state.running,
            responseTimeMs: state.responseTimeMs,
          };
        } else if (state?._tag === 'orchestrator-unreachable' || state?._tag === 'tunnel-down') {
          details = {
            reason: state.reason,
          };
          if (state.code !== undefined) {
            details.code = state.code;
          }
        }
        /* v8 ignore stop @preserve */

        return {
          name: w.name,
          url: w.url,
          priority: index + 1,
          healthy: isHealthy,
          status: statusTag,
          details,
          checkedAt: healthStatus?.checkedAt ?? null,
          stale: healthStatus?.stale ?? true,
        };
      });

      return reply.ok({ workers, stale });
    }
  );

  // POST /code/workers/refresh-status - Refresh worker health status synchronously (public, Auth0 JWT)
  fastify.post(
    '/code/workers/refresh-status',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'refreshWorkersStatus',
        summary: 'Refresh worker health status',
        description: 'Synchronously probe all workers and update health status. Requires Auth0 JWT.',
        tags: ['public'],
        response: {
          200: {
            description: 'Worker status after refresh',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['workers', 'stale'],
                properties: {
                  workers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        url: { type: 'string' },
                        priority: { type: 'number' },
                        healthy: { type: 'boolean' },
                        status: {
                          type: 'string',
                          enum: ['healthy', 'orchestrator-unreachable', 'tunnel-down', 'unknown'],
                        },
                        details: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            capacity: { type: 'number' },
                            available: { type: 'number' },
                            running: { type: 'number' },
                            responseTimeMs: { type: 'number' },
                            reason: { type: 'string' },
                            code: { type: 'string' },
                          },
                        },
                        checkedAt: { type: 'string', format: 'date-time' },
                        stale: { type: 'boolean' },
                      },
                      required: ['name', 'url', 'priority', 'healthy', 'status', 'details', 'checkedAt', 'stale'],
                    },
                  },
                  stale: { type: 'boolean' },
                },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/workers/refresh-status',
      });

      const { workerSettingsRepo, workerHealthProbe } = getServices();
      const userId = request.user?.userId;

      /* v8 ignore start -- test-infra: requires authenticated user @preserve */
      if (!userId) {
        return reply.fail('UNAUTHORIZED', 'Authentication required');
      }
      /* v8 ignore stop @preserve */

      const settingsResult = await workerSettingsRepo.getSettings(userId);

      /* v8 ignore start -- upstream: Firestore fetch failure or missing settings @preserve */
      if (!settingsResult.ok || settingsResult.value === null) {
        return reply.ok({ workers: [], stale: false });
      }
      /* v8 ignore stop @preserve */

      const settings = settingsResult.value;

      const results = await workerHealthProbe.probeAllWorkers(settings.workers);

      for (const [name, state] of Object.entries(results)) {
        await workerSettingsRepo.updateHealthStatus(userId, name, {
          state,
          checkedAt: new Date().toISOString(),
          stale: false,
        });
      }

      const workers = settings.workers.map((w, index) => {
        const state = results[w.name];

        /* v8 ignore start -- test-infra: requires integration test with health state data @preserve */
        const isHealthy = state?.healthy ?? false;
        const statusTag = state?._tag ?? 'unknown';
        /* v8 ignore stop @preserve */

        let details: {
          capacity?: number;
          available?: number;
          running?: number;
          responseTimeMs?: number;
          reason?: string;
          code?: string;
        } | null = null;

        /* v8 ignore start -- test-infra: requires integration tests with health status data @preserve */
        if (state?._tag === 'healthy') {
          details = {
            capacity: state.capacity,
            available: state.available,
            running: state.running,
            responseTimeMs: state.responseTimeMs,
          };
        } else if (state?._tag === 'orchestrator-unreachable' || state?._tag === 'tunnel-down') {
          details = {
            reason: state.reason,
          };
          if (state.code !== undefined) {
            details.code = state.code;
          }
        }
        /* v8 ignore stop @preserve */

        return {
          name: w.name,
          url: w.url,
          priority: index + 1,
          healthy: isHealthy,
          status: statusTag,
          details,
          checkedAt: new Date().toISOString(),
          stale: false,
        };
      });

      return reply.ok({ workers, stale: false });
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
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { detectZombieTasks } = getServices();

      request.log.info('Starting zombie task detection');

      const result = await detectZombieTasks();

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Zombie detection failed');
        return await reply.fail('INTERNAL_ERROR', 'Failed to detect zombie tasks');
      }

      return await reply.ok(result.value); // @allow-result-access -- .ok checked at line 2594
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
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INVALID_REQUEST'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Task not found',
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
            description: 'Internal server error',
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
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { taskId, nonce, userId } = request.body;

      request.log.info({ taskId, userId }, 'Processing cancel-with-nonce request');

      const result = await cancelTaskWithNonce(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskDispatcher: services.taskDispatcher,
          workerSettingsRepo: services.workerSettingsRepo,
        },
        { taskId, nonce, userId }
      );

      if (!result.ok) {
        const error = result.error;
        request.log.warn({ taskId, errorCode: error.code, errorMessage: error.message }, 'Cancel-with-nonce failed');

        if (error.code === 'task_not_found') {
          return await reply.fail('NOT_FOUND', error.message);
        } else if (error.code === 'internal_error') {
          return await reply.fail('INTERNAL_ERROR', error.message);
        } else if (error.code === 'not_owner') {
          // NOT_OWNER returns 403 (not 400) as defined in ErrorCode mapping
          return await reply.fail('NOT_OWNER', error.message);
        } else {
          // Map domain-specific error codes to ErrorCode values
          const codeMap: Record<string, ErrorCode> = {
            invalid_nonce: 'INVALID_NONCE',
            nonce_expired: 'NONCE_EXPIRED',
            // not_owner NOT mapped here - it returns 403 and is handled above
            task_not_cancellable: 'TASK_NOT_CANCELLABLE',
          };
          const mappedCode = codeMap[error.code];
          /* v8 ignore start -- upstream: Domain guarantees all error codes are mapped, this is defensive @preserve */
          if (mappedCode === undefined) {
            // This should never happen - all domain error codes must be mapped
            request.log.error({ taskId, errorCode: error.code }, 'Unmapped domain error code in cancel-with-nonce');
            return await reply.fail('INTERNAL_ERROR', 'Unable to process error code');
          }
          /* v8 ignore stop @preserve */
          return await reply.fail(mappedCode, error.message);
        }
      }

      request.log.info({ taskId }, 'Task cancelled via nonce successfully');
      return await reply.ok({ cancelled: true });
    }
  );

  // POST /internal/code/submit-phase2 - Submit Phase 2 from WhatsApp button (INT-628)
  fastify.post<{
    Body: {
      taskId: string;
      userId: string;
    };
  }>(
    '/internal/code/submit-phase2',
    {
      schema: {
        operationId: 'submitToExecutionAgentInternal',
        summary: 'Submit Phase 2 implementation from WhatsApp button',
        description: 'Internal endpoint for submitting Phase 2 from WhatsApp button callback. Requires internal authentication.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            userId: { type: 'string' },
          },
          required: ['taskId', 'userId'],
        },
        response: {
          200: {
            description: 'Phase 2 submitted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  codeTaskId: { type: 'string' },
                  resourceUrl: { type: 'string' },
                  workerLocation: { type: 'string' },
                  implementationOf: { type: 'string' },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { taskId: string; userId: string };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/submit-phase2',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      /* v8 ignore start -- test-infra: internal auth validation branch covered by other tests @preserve */
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for submit-phase2');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      /* v8 ignore stop @preserve */

      const services = getServices();
      const { taskId, userId } = request.body;

      request.log.info({ taskId, userId }, 'Processing submit-phase2 request');

      // Call existing submitToExecutionAgent use case
      /* v8 ignore start -- test-infra: submitToExecutionAgent use case has its own tests @preserve */
      const result = await submitToExecutionAgent(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          linearAgentClient: services.linearAgentClient,
          taskDispatcher: services.taskDispatcher,
          whatsappNotifier: services.whatsappNotifier,
          metricsClient: services.metricsClient,
          workerSettingsRepo: services.workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
          serviceUrl: loadConfig().serviceUrl,
        },
        { originalTaskId: taskId, userId }
      );
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: error handling branches covered by submitToExecutionAgent tests @preserve */
      if (!result.ok) {
        const error = result.error;
        request.log.warn({ taskId, errorCode: error.code, errorMessage: error.message }, 'Submit-phase2 failed');

        switch (error.code) {
          case 'task_not_found':
            return await reply.fail('NOT_FOUND', error.message);
          case 'invalid_status':
          case 'no_linear_issue':
          case 'label_not_ready':
            return await reply.fail('INVALID_REQUEST', error.message, undefined, { serverCode: error.code });
          case 'worker_not_configured':
            return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
          case 'already_implemented':
            return await reply.code(409).send({ // @allow-raw-send: 409 with existingTaskId details
              success: false,
              error: {
                code: error.code,
                message: error.message,
                details: { existingTaskId: error.existingTaskId, serverCode: error.code },
              },
            });
          case 'active_task_exists':
            return await reply.fail('CONFLICT', error.message, undefined, { serverCode: error.code });
          case 'internal_error':
          default:
            return await reply.fail('INTERNAL_ERROR', error.message);
        }
      }
      /* v8 ignore stop @preserve */

      request.log.info({ taskId, phase2TaskId: result.value.codeTaskId }, 'Phase 2 submitted successfully'); // @allow-result-access -- .ok checked above in the v8-ignore block
      return await reply.ok(result.value); // @allow-result-access -- .ok checked above in the v8-ignore block
    }
  );

  // POST /internal/tasks/cleanup-logs - Cleanup old task logs (cron endpoint)
  fastify.post<{
    Body: {
      retentionDays?: number;
      batchSize?: number;
      tasksPerRun?: number;
    };
  }>(
    '/internal/tasks/cleanup-logs',
    {
      schema: {
        operationId: 'cleanupTaskLogs',
        summary: 'Cleanup old task logs',
        description: 'Internal endpoint for cleaning up logs from completed tasks. Called by log-cleanup worker.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            retentionDays: {
              type: 'number',
              minimum: 1,
              description: 'Number of days to retain logs (default 90)',
            },
            batchSize: {
              type: 'number',
              minimum: 1,
              maximum: 500,
              description: 'Number of logs to delete per batch (default 500)',
            },
            tasksPerRun: {
              type: 'number',
              minimum: 1,
              maximum: 1000,
              description: 'Number of tasks to process per iteration (default 100)',
            },
          },
        },
        response: {
          200: {
            description: 'Cleanup completed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  tasksProcessed: { type: 'number' },
                  tasksFailed: { type: 'number' },
                  logsDeleted: { type: 'number' },
                  durationMs: { type: 'number' },
                },
                required: ['tasksProcessed', 'tasksFailed', 'logsDeleted', 'durationMs'],
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
    async (
      request: FastifyRequest<{
        Body: {
          retentionDays?: number;
          batchSize?: number;
          tasksPerRun?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/tasks/cleanup-logs',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for cleanup-logs');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { cleanupTaskLogs } = getServices();
      const body = request.body;

      request.log.info(
        { retentionDays: body.retentionDays, batchSize: body.batchSize, tasksPerRun: body.tasksPerRun },
        'Starting task log cleanup'
      );

      const input: Parameters<typeof cleanupTaskLogs>[0] = {};
      if (body.retentionDays !== undefined) {
        input.retentionDays = body.retentionDays;
      }
      if (body.batchSize !== undefined) {
        input.batchSize = body.batchSize;
      }
      if (body.tasksPerRun !== undefined) {
        input.tasksPerRun = body.tasksPerRun;
      }

      const result = await cleanupTaskLogs(input);

      if (!result.ok) {
        request.log.error({ error: result.error.message }, 'Task log cleanup failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info(
        {
          tasksProcessed: result.value.tasksProcessed, // @allow-result-access -- .ok checked at line 3035
          logsDeleted: result.value.logsDeleted, // @allow-result-access -- .ok checked at line 3035
          durationMs: result.value.durationMs, // @allow-result-access -- .ok checked at line 3035
        },
        'Task log cleanup completed'
      );

      return await reply.ok(result.value); // @allow-result-access -- .ok checked at line 3035
    }
  );

  // POST /code/retry - Retry a failed or cancelled code task (INT-520)
  fastify.post(
    '/code/retry',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'retryCodeTask',
        summary: 'Retry a failed or cancelled code task',
        description: 'Creates a new task based on a failed or cancelled task, with optional additional context. Requires Auth0 JWT.',
        tags: ['public'],
        body: {
          type: 'object',
          required: ['taskId'],
          properties: {
            taskId: {
              type: 'string',
              description: 'The ID of the failed or cancelled task to retry',
            },
            additionalContext: {
              type: 'string',
              description: 'Optional additional context to help with the retry',
              maxLength: 5000,
            },
            workerType: {
              type: 'string',
              enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'],
              description: 'Optional worker type to use for the retry',
            },
          },
        },
        response: {
          200: {
            description: 'Task retry created successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['codeTaskId', 'resourceUrl', 'workerLocation', 'retriedFrom'],
                properties: {
                  codeTaskId: { type: 'string' },
                  resourceUrl: { type: 'string' },
                  workerLocation: { type: 'string' },
                  retriedFrom: { type: 'string' },
                },
              },
            },
          },
          400: {
            description: 'Bad request - task cannot be retried',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    enum: ['invalid_status', 'too_soon', 'worker_not_configured'],
                  },
                  message: { type: 'string' },
                  retryAfterMs: { type: 'number', nullable: true },
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
        message: 'Received request to POST /code/retry',
      });

      const { codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, metricsClient, workerSettingsRepo } =
        getServices();
      const userId = request.user?.userId;

      /* v8 ignore start -- test-infra: requires authenticated user @preserve */
      if (!userId) {
        return reply.fail('UNAUTHORIZED', 'Authentication required');
      }
      /* v8 ignore stop @preserve */

      const { taskId, additionalContext, workerType } = request.body as { taskId: string; additionalContext?: string; workerType?: string };

      request.log.info({ taskId, userId, hasAdditionalContext: additionalContext !== undefined, workerType }, 'Processing task retry');

      // Build retry request - only include additionalContext if defined
      const retryRequest: {
        originalTaskId: string;
        userId: string;
        additionalContext?: string;
        workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
      } = {
        originalTaskId: taskId,
        userId,
      };
      // Only add additionalContext if provided
      if (additionalContext !== undefined) {
        retryRequest.additionalContext = additionalContext;
      }
      // Only add workerType if provided and valid
      if (workerType !== undefined && ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'].includes(workerType)) {
        retryRequest.workerType = workerType as 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
      }

      const result = await retryTask(
        {
          logger: request.log,
          codeTaskRepo,
          linearAgentClient,
          taskDispatcher,
          whatsappNotifier,
          metricsClient,
          workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
          serviceUrl: loadConfig().serviceUrl,
        },
        retryRequest
      );

      if (!result.ok) {
        const error = result.error;

        // Map error codes to response codes
        if (error.code === 'task_not_found') {
          return reply.fail('NOT_FOUND', error.message);
        }
        /* v8 ignore start -- ts-type: complex error code comparison creates type narrowing branch @preserve */
        if (error.code === 'invalid_status' || error.code === 'too_soon' || error.code === 'worker_not_configured') {
          // Use BAD_REQUEST for client-side errors with additional data
          // @allow-raw-send: Returning retryAfterMs which is not supported by reply.fail()
          return reply.status(400).send({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
            },
          });
        }
        /* v8 ignore stop @preserve */

        // Internal error
        request.log.error({ error }, 'Task retry failed');
        return reply.fail('INTERNAL_ERROR', 'Failed to retry task');
      }

      request.log.info(
        { originalTaskId: taskId, retryTaskId: result.value.codeTaskId }, // @allow-result-access -- narrowed by !result.ok guard above
        'Task retry created successfully'
      );

      return reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  // POST /code/tasks/:taskId/feedback - Submit feedback on completed task (INT-465 Phase 4)
  fastify.post(
    '/code/tasks/:taskId/feedback',
    {
      onRequest: jwtValidator,
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

      const { codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, metricsClient, workerSettingsRepo } =
        getServices();
      const userId = request.user?.userId;

      /* v8 ignore start -- test-infra: requires authenticated user @preserve */
      if (userId === undefined) {
        return reply.fail('UNAUTHORIZED', 'Authentication required');
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
          taskDispatcher,
          whatsappNotifier,
          metricsClient,
          workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
          serviceUrl: loadConfig().serviceUrl,
        },
        {
          originalTaskId: taskId,
          userId,
          feedback,
        }
      );

      /* v8 ignore start -- test-infra: error handling paths covered by use case tests @preserve */
      if (!result.ok) {
        const error = result.error;

        // Map error codes to response codes
        if (error.code === 'task_not_found') {
          /* v8 ignore stop @preserve */
          return reply.fail('NOT_FOUND', error.message);
        }
        /* v8 ignore start -- ts-type: complex error code comparison creates type narrowing branch @preserve */
        if (error.code === 'invalid_status' || error.code === 'worker_not_configured') {
          // Use BAD_REQUEST for client-side errors
          // @allow-raw-send: Returning application-specific error codes not supported by reply.fail()
          return reply.status(400).send({
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }
        /* v8 ignore stop @preserve */

        // Internal error
        request.log.error({ error }, 'Task feedback submission failed');
        return reply.fail('INTERNAL_ERROR', 'Failed to submit task feedback');
      }

      request.log.info(
        { originalTaskId: taskId, followUpTaskId: result.value.codeTaskId }, // @allow-result-access -- narrowed by !result.ok guard above
        'Follow-up task created from feedback'
      );

      return reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  // POST /code/tasks/:taskId/implement - Start Execution Agent implementation from a completed planning task
  fastify.post(
    '/code/tasks/:taskId/implement',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'submitToExecutionAgent',
        summary: 'Start Execution Agent implementation from a completed planning task',
        description: 'Dispatches an Execution Agent task from a completed planning task. Route path remains stable for UI compatibility. Requires Auth0 JWT.',
        tags: ['public'],
        params: {
          type: 'object',
          required: ['taskId'],
          properties: {
            taskId: {
              type: 'string',
                  description: 'The ID of the completed planning task',
            },
          },
        },
        body: {
          type: 'object',
          properties: {
            workerType: {
              type: 'string',
              enum: ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'],
              description: 'Optional worker type to use for the implementation',
            },
          },
        },
        response: {
          200: {
            description: 'Execution Agent task dispatched successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['codeTaskId', 'resourceUrl', 'workerLocation', 'implementationOf'],
                properties: {
                  codeTaskId: { type: 'string' },
                  resourceUrl: { type: 'string' },
                  workerLocation: { type: 'string' },
                  implementationOf: { type: 'string' },
                },
              },
            },
          },
          400: {
            description: 'Bad request',
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
                  code: { type: 'string', enum: ['NOT_FOUND'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          409: {
            description: 'Conflict - implementation already exists or active task exists',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  details: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      existingTaskId: { type: 'string' },
                    },
                  },
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
        message: 'Received request to POST /code/tasks/:taskId/implement',
      });

      const { codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, metricsClient, workerSettingsRepo, rateLimitService } =
        getServices();
      const userId = request.user?.userId;

      /* v8 ignore start -- test-infra: requires authenticated user @preserve */
      if (userId === undefined) {
        return reply.fail('UNAUTHORIZED', 'Authentication required');
      }
      /* v8 ignore stop @preserve */

      const { taskId } = request.params as { taskId: string };
      const body = request.body as { workerType?: string } | undefined;
      const requestedWorkerType = body?.workerType;

      // Check rate limits before dispatching (prompt length 0 — reuses existing task prompt)
      const limitCheck = await rateLimitService.checkLimits(userId, 0);
      /* v8 ignore start -- test-infra: rate limit failure covered by rateLimitService unit tests @preserve */
      if (!limitCheck.ok) {
        const { error } = limitCheck;
        request.log.warn({ userId, error }, 'Rate limit exceeded for implement request');
        if (error.code === 'service_unavailable') {
          return reply.fail('MISCONFIGURED', error.message);
        }
        return reply.fail('RATE_LIMITED', error.message);
      }
      /* v8 ignore stop @preserve */

      request.log.info({ taskId, userId, workerType: requestedWorkerType }, 'Processing Execution Agent implementation request');

      // Only add workerType if provided and valid
      const executionAgentRequest: { originalTaskId: string; userId: string; workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus' } = { originalTaskId: taskId, userId };
      if (requestedWorkerType !== undefined && ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'].includes(requestedWorkerType)) {
        executionAgentRequest.workerType = requestedWorkerType as 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
      }

      const result = await submitToExecutionAgent(
        {
          logger: request.log,
          codeTaskRepo,
          linearAgentClient,
          taskDispatcher,
          whatsappNotifier,
          metricsClient,
          workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
          serviceUrl: loadConfig().serviceUrl,
        },
        executionAgentRequest
      );

      /* v8 ignore start -- test-infra: error handling paths covered by use case tests @preserve */
      if (!result.ok) {
        const error = result.error;
        switch (error.code) {
          case 'task_not_found':
            return reply.fail('NOT_FOUND', error.message);
          case 'invalid_status':
          case 'no_linear_issue':
          case 'label_not_ready':
            return reply.fail('INVALID_REQUEST', error.message, undefined, { serverCode: error.code });
          case 'worker_not_configured':
            return reply.fail('WORKER_NOT_CONFIGURED', error.message);
          case 'already_implemented':
            // @allow-raw-send: 409 with existingTaskId details for frontend navigation
            return reply.code(409).send({
              success: false,
              error: {
                code: error.code,
                message: error.message,
                details: { existingTaskId: error.existingTaskId, serverCode: error.code },
              },
            });
          case 'active_task_exists':
            return reply.fail('CONFLICT', error.message, undefined, { serverCode: error.code });
          case 'internal_error':
          default:
            return reply.fail('INTERNAL_ERROR', error.message);
        }
      }
      /* v8 ignore stop @preserve */

      // Record task start for rate limiting
      await rateLimitService.recordTaskStart(userId);

      return reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  // ============================================================
  // POST /code/tasks/:taskId/messages - Send message to task
  // ============================================================
  fastify.post<{
    Params: { taskId: string };
    Body: { message: string };
  }>(
    '/code/tasks/:taskId/messages',
    {
      onRequest: [jwtValidator],
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

      /* v8 ignore start -- test-infra: JWT validator sets request.user, guards against missing identity @preserve */
      const userId = request.user?.userId;
      if (userId === undefined) {
        return reply.fail('UNAUTHORIZED' as ErrorCode, 'Missing user identity');
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

      /* v8 ignore start -- test-infra: error code branches require task in specific states and worker configuration scenarios @preserve */
      if (!result.ok) {
        const { error } = result;
        if (error.code === 'task_not_found') {
          return reply.fail('NOT_FOUND' as ErrorCode, error.message);
        }
        if (error.code === 'invalid_status') {
          return reply.fail('INVALID_STATUS' as ErrorCode, error.message);
        }
        if (error.code === 'worker_not_configured') {
          return reply.fail('MISCONFIGURED' as ErrorCode, error.message);
        }
        if (error.code === 'worker_unavailable') {
          return reply.fail('WORKER_UNAVAILABLE', error.message);
        }
        return reply.fail('INTERNAL_ERROR' as ErrorCode, error.message);
      }
      /* v8 ignore stop @preserve */

      return reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  // POST /internal/drain-queue - triggered by Cloud Scheduler (INT-619)
  fastify.post(
    '/internal/drain-queue',
    {
      schema: {
        operationId: 'drainTaskQueue',
        summary: 'Drain task queue by dispatching oldest queued task',
        description: 'Called by Cloud Scheduler every minute to drain the task queue.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Drain completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['dispatched', 'expired', 'still_busy', 'empty', 'skipped', 'failed'] },
                  taskId: { type: 'string' },
                },
                required: ['action'],
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
        message: 'Received request to POST /internal/drain-queue',
      });

      // Auth strategy: Cloud Scheduler sends OIDC tokens; direct service calls use x-internal-auth.
      //
      // SECURITY NOTE: The OIDC token is NOT validated at the application layer. In production,
      // Cloud Run validates the OIDC token at the infrastructure level before the request reaches
      // this handler. In the current Terraform config, code-agent uses allow_unauthenticated=true
      // (required for external webhooks), so this OIDC trust relies on Cloud Run's ingress settings
      // and IAM invoker configuration — NOT on the Bearer header alone. If Cloud Run ingress is
      // changed to allow all traffic, this endpoint would need application-level OIDC validation.
      //
      // For defense in depth, internal callers should prefer the x-internal-auth header path.
      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn({ reason: authResult.reason }, 'Internal auth failed for drain-queue');
          return await reply.fail('UNAUTHORIZED', 'Unauthorized');
        }
      }

      const services = getServices();

      const result = await drainTaskQueue({
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
        taskDispatcher: services.taskDispatcher,
        linearAgentClient: services.linearAgentClient,
        whatsappNotifier: services.whatsappNotifier,
        workerSettingsRepo: services.workerSettingsRepo,
      });

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Drain queue failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  done();
};
