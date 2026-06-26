/**
 * Task CRUD + state transitions (submit, cancel, retry, archive, implement, zombies, worker status, etc.)
 *
 * Extracted from `codeRoutes.ts` as part of INT-1430 so that route handlers
 * live in resource-specific files and `codeRoutes.ts` can act as a thin
 * Fastify plugin.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { Timestamp } from '@intexuraos/infra-firestore';
import { randomUUID } from 'node:crypto';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { authenticateInternalScheduler } from '../helpers/internalAuth.js';
import { extractOrGenerateTraceId, type ErrorCode } from '@intexuraos/common-core';
import {
  isCodeTaskWorkerType,
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
} from '@intexuraos/code-task-domain';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { getServices } from '../../services.js';
import { submitDirectCodeTask } from '../../domain/usecases/submitDirectCodeTask.js';
import { cancelTask, type CancelTaskErrorCode } from '../../domain/usecases/cancelTask.js';
import { cancelTaskWithNonce } from '../../domain/usecases/cancelTaskWithNonce.js';
import { retryTask } from '../../domain/usecases/retryTask.js';
import { submitToExecutionAgent } from '../../domain/usecases/submitToExecutionAgent.js';
import { backLinkPlanningTask } from '../../domain/usecases/backLinkPlanningTask.js';
import { deletePRTaskLock } from '../../domain/utils/prTaskLock.js';
import { hasCodeTaskLabel } from '../../domain/utils/labelUtils.js';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { generateWebhookSecret } from '../../domain/utils/secrets.js';
import { loadConfig } from '../../config.js';
import type { TaskStatus, WorkerType } from '../../domain/models/codeTask.js';
import type { WorkerConfig, WorkerHealthState, WorkerHealthStatus } from '../../domain/models/workerSettings.js';
import type { DispatchScheduleCreateInput } from '../../domain/repositories/codeTaskRepository.js';
import { classifyCodeTaskDispatchability } from '../../domain/services/codeTaskDispatchBlockers.js';
import {
  buildDispatchStatusForProblem,
  dispatchFailureProblem,
  dispatchProblemFromBlocker,
  notifyDispatchProblemForTask,
  taskErrorFromDispatchStatus,
} from '../../domain/services/codeTaskDispatchProblems.js';
import { taskToApiResponse, inFlightRequests } from './responseFormatters.js';
import {
  codeTaskSchema,
  callbackStateSchema,
  dispatchStatusSchema,
  linearIssueForDisplaySchema,
  workerTypeSchema,
  executionMemoryContextSchema,
  executionMemoryPostRunSchema,
} from './schemas.js';
import type { CodeRoutesOptions } from './types.js';

/** Terminal task statuses eligible for archival, rate-limit recording, etc. */
const TERMINAL_STATUSES: readonly TaskStatus[] = ['planned', 'implemented', 'reviewed', 'failed', 'cancelled', 'interrupted'];

/** Maps cancelTask domain error codes to public HTTP ErrorCode values. */
const CANCEL_TASK_ERROR_CODE_MAP: Record<CancelTaskErrorCode, ErrorCode> = {
  task_not_found: 'NOT_FOUND',
  not_owner: 'FORBIDDEN',
  task_not_cancellable: 'CONFLICT',
  internal_error: 'INTERNAL_ERROR',
};

const logger = createAppLogger({ name: 'code-routes' });

interface WorkerStatusResponse {
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
  healthy: boolean;
  status: WorkerHealthState['_tag'] | 'disabled';
  details: {
    capacity?: number;
    available?: number;
    running?: number;
    responseTimeMs?: number;
    reason?: string;
    code?: string;
    error?: string;
    missingFields?: string[];
    contractMismatch?: boolean;
  } | null;
  checkedAt: string | null;
  stale: boolean;
}

function isWorkerEnabled(worker: { enabled?: boolean }): boolean {
  return worker.enabled ?? true;
}

function formatWorkerStatus(
  worker: WorkerConfig,
  priority: number,
  healthStatus: WorkerHealthStatus | undefined
): WorkerStatusResponse {
  if (!isWorkerEnabled(worker)) {
    return {
      name: worker.name,
      url: worker.url,
      priority,
      enabled: false,
      healthy: false,
      status: 'disabled',
      details: { reason: 'disabled' },
      checkedAt: null,
      stale: false,
    };
  }

  const state = healthStatus?.state;
  const isHealthy = state?.healthy ?? false;
  const statusTag = state?._tag ?? 'unknown';

  let details: WorkerStatusResponse['details'] = null;

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
  } else if (state?._tag === 'unknown') {
    details = {
      error: state.error,
      ...(state.missingFields !== undefined && { missingFields: state.missingFields }),
      ...(state.contractMismatch !== undefined && { contractMismatch: state.contractMismatch }),
    };
  }

  return {
    name: worker.name,
    url: worker.url,
    priority,
    enabled: true,
    healthy: isHealthy,
    status: statusTag,
    details,
    checkedAt: healthStatus?.checkedAt ?? null,
    stale: healthStatus?.stale ?? true,
  };
}

export const taskRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;

  // ==== Internal routes (X-Internal-Auth / scheduler) ====

  // POST /internal/code/submit - Internal endpoint to create tasks on behalf of a user (INT-1287)
  fastify.post<{
    Body: {
      userId: string;
      prompt: string;
      workerType?: WorkerType;
      taskMode?: 'planning' | 'execution';
      linearIssueId?: string;
    };
  }>(
    '/internal/code/submit',
    {
      schema: {
        operationId: 'internalSubmitCodeTask',
        summary: 'Create a code task on behalf of a user',
        description:
          'Internal endpoint for creating code tasks on behalf of a user. ' +
          'Mirrors POST /code/submit but uses internal auth and accepts userId in the body.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            userId: { type: 'string', minLength: 1 },
            prompt: { type: 'string', minLength: 1, maxLength: 100000 },
            workerType: workerTypeSchema,
            taskMode: { type: 'string', enum: ['planning', 'execution'] },
            linearIssueId: { type: 'string' },
          },
          required: ['userId', 'prompt'],
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
          409: {
            description: 'Duplicate task',
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
          400: {
            description: 'Invalid request - prompt failed injection sanitization',
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
          503: {
            description: 'Queue full',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['QUEUE_FULL'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          424: {
            description: 'Worker not configured',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['WORKER_NOT_CONFIGURED'] },
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
    async (
      request: FastifyRequest<{
        Body: {
          userId: string;
          prompt: string;
          workerType?: WorkerType;
          taskMode?: 'planning' | 'execution';
          linearIssueId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/submit',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for internal code submit');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const body = request.body;

      // Extract or generate traceId from headers
      const traceId = extractOrGenerateTraceId(request.headers);

      request.log.info(
        {
          userId: body.userId,
          workerType: body.workerType,
          promptLength: body.prompt.length,
          traceId,
        },
        'Internal code task submission on behalf of user'
      );

      const processRequest: {
        userId: string;
        prompt: string;
        workerType: WorkerType;
        taskMode?: 'planning' | 'execution';
        linearIssueId?: string;
        traceId?: string;
        source?: 'whatsapp' | 'web';
      } = {
        userId: body.userId,
        prompt: body.prompt,
        workerType: body.workerType ?? 'auto',
        traceId,
        source: 'web',
      };

      if (body.taskMode !== undefined) {
        processRequest.taskMode = body.taskMode;
      }
      if (body.linearIssueId !== undefined) {
        processRequest.linearIssueId = body.linearIssueId;
      }

      const result = await submitDirectCodeTask(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskEnqueueService: services.taskEnqueueService,
          linearIssueService: services.linearIssueService,
          linearAgentClient: services.linearAgentClient,
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
          'Failed to create internal code task'
        );

        if (error.code === 'duplicate_prompt') {
          // firestoreCodeTaskRepository always provides existingTaskId for duplicate_prompt
          const existingTaskId = error.existingTaskId;
          /* v8 ignore start -- ts-type: firestoreCodeTaskRepository always provides existingTaskId; fallback unreachable @preserve */
          return await reply.fail('CONFLICT', `Similar task submitted in last 5 minutes: ${existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        if (error.code === 'active_task_exists') {
          // firestoreCodeTaskRepository always provides existingTaskId for active_task_exists
          const existingTaskId = error.existingTaskId;
          /* v8 ignore start -- ts-type: firestoreCodeTaskRepository always provides existingTaskId; fallback unreachable @preserve */
          return await reply.fail('CONFLICT', `Active task already exists for this Linear issue: ${existingTaskId ?? ''}`);
          /* v8 ignore stop @preserve */
        }

        if (error.code === 'worker_not_configured') {
          return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
        }

        if (error.code === 'validation_error') {
          return await reply.fail('INVALID_REQUEST', error.message);
        }

        if (error.code === 'queue_full') {
          return await reply.fail('QUEUE_FULL', error.message);
        }

        /* v8 ignore start -- ts-type: queue_timeout is not in EnqueueError code union; codeRoutes.ts handler is defensive only @preserve */
        if (error.code === 'queue_timeout') {
          // Note: QUEUE_TIMEOUT is not in ErrorCode union; map to INTERNAL_ERROR.
          // TODO: Consider adding QUEUE_TIMEOUT to common-core/src/errors.ts if needed.
          return await reply.fail('INTERNAL_ERROR', error.message);
        }
        /* v8 ignore stop @preserve */

        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      request.log.info({ codeTaskId: result.value.codeTaskId }, 'Internal code task created successfully'); // @allow-result-access -- narrowed by !result.ok guard above

      return await reply.ok({
        status: 'submitted',
        codeTaskId: result.value.codeTaskId, // @allow-result-access -- narrowed by !result.ok guard above
        resourceUrl: result.value.resourceUrl, // @allow-result-access -- narrowed by !result.ok guard above
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
        return await reply.fail('NOT_FOUND', result.error.message);
      }

      request.log.info({ taskId, status: result.value.status }, 'Code task updated successfully'); // @allow-result-access -- narrowed by !result.ok guard above

      return await reply.ok({ task: taskToApiResponse(result.value) }); // @allow-result-access -- narrowed by !result.ok guard above
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

      request.log.info({ count: result.value.length }, 'Zombie code tasks found'); // @allow-result-access -- narrowed by !result.ok guard above
      return await reply.ok({
        tasks: result.value.map(taskToApiResponse), // @allow-result-access -- narrowed by !result.ok guard above
      });
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

      const authResult = await authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for zombie detection');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for zombie detection');

      const { detectZombieTasks } = getServices();

      request.log.info('Starting zombie task detection');

      const result = await detectZombieTasks();

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Zombie detection failed');
        return await reply.fail('INTERNAL_ERROR', 'Failed to detect zombie tasks');
      }

      // Best-effort: clean up PR task locks for interrupted zombie tasks
      for (const lock of result.value.locksToCleanup) { // @allow-result-access -- narrowed by !result.ok guard above
        await deletePRTaskLock(getServices().firestore, lock.repository, lock.prNumber, request.log);
      }

      return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
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

      if (result.ok) {
        for (const lock of result.value.locksToCleanup) { // @allow-result-access -- narrowed by result.ok check
          await deletePRTaskLock(services.firestore, lock.repository, lock.prNumber, request.log);
        }
      }

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
          if (mappedCode === undefined) {
            // This should never happen - all domain error codes must be mapped
            request.log.error({ taskId, errorCode: error.code }, 'Unmapped domain error code in cancel-with-nonce');
            return await reply.fail('INTERNAL_ERROR', 'Unable to process error code');
          }
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
                  childTaskIds: { type: 'array', items: { type: 'string' } },
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
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for submit-phase2');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { taskId, userId } = request.body;

      request.log.info({ taskId, userId }, 'Processing submit-phase2 request');

      // Call existing submitToExecutionAgent use case
      const result = await submitToExecutionAgent(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          linearAgentClient: services.linearAgentClient,
          taskEnqueueService: services.taskEnqueueService,
          metricsClient: services.metricsClient,
          workerSettingsRepo: services.workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
          gitHubPRClient: services.gitHubPRClient,
          userServiceClient: services.userServiceClient,
        },
        { originalTaskId: taskId, userId }
      );

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
          case 'complex_task_no_qualifying_children':
            return await reply.fail('CONFLICT', error.message, undefined, { serverCode: error.code });
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
          case 'plan_pr_merge_failed':
            return await reply.fail('PLAN_PR_MERGE_FAILED', error.message);
          case 'internal_error':
          default:
            return await reply.fail('INTERNAL_ERROR', error.message);
        }
      }

      request.log.info({ taskId, phase2TaskId: result.value.codeTaskId }, 'Phase 2 submitted successfully'); // @allow-result-access -- .ok checked above in the v8-ignore block
      return await reply.ok(result.value); // @allow-result-access -- .ok checked above in the v8-ignore block
    }
  );

  // ==== Public routes (Auth0 JWT) ====
  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.post<{
      Body: {
        prompt: string;
        workerType?: WorkerType;
        linearIssueId?: string;
        taskMode?: 'planning' | 'execution';
        scheduledDispatch?: {
          localDateTime: string;
          timezone: string;
          notBeforeAt: string;
        };
        timeoutHours?: number;
      };
    }>(
      '/submit',
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
              workerType: workerTypeSchema,
              linearIssueId: { type: 'string' },
              taskMode: { type: 'string', enum: ['planning', 'execution'] },
              scheduledDispatch: {
                type: 'object',
                properties: {
                  localDateTime: { type: 'string' },
                  timezone: { type: 'string' },
                  notBeforeAt: { type: 'string' },
                },
                required: ['localDateTime', 'timezone', 'notBeforeAt'],
              },
              timeoutHours: {
                type: 'integer',
                minimum: MIN_TIMEOUT_HOURS,
                maximum: MAX_TIMEOUT_HOURS,
                description:
                  'Optional per-task timeout override in hours (1–12). When omitted, orchestrator default (5h) applies (INT-1585).',
              },
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
                    status: { type: 'string', enum: ['submitted', 'failed'] },
                    codeTaskId: { type: 'string' },
                  },
                  required: ['status', 'codeTaskId'],
                },
              },
            },
            400: {
              description: 'Invalid request — scheduledDispatch only allowed in execution mode with valid future notBeforeAt',
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
                      enum: ['concurrent_limit', 'hourly_limit', 'prompt_too_long'],
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
                    code: { type: 'string', enum: ['MISCONFIGURED', 'QUEUE_FULL'] },
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
      async (request: FastifyRequest<{ Body: { prompt: string; workerType?: WorkerType; workerLocation?: string; linearIssueId?: string; taskMode?: 'planning' | 'execution'; scheduledDispatch?: { localDateTime: string; timezone: string; notBeforeAt: string }; timeoutHours?: number } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/submit',
          includeParams: true,
        });

        const {
          codeTaskRepo,
          linearIssueService,
          workerSettingsRepo,
          taskEnqueueService,
          whatsappNotifier,
          codeTaskDispatchStatusService,
          logger: serviceLogger,
        } = getServices();
        const body = request.body as {
          prompt: string;
          workerType?: WorkerType;
          linearIssueId?: string;
          taskMode?: 'planning' | 'execution';
          scheduledDispatch?: {
            localDateTime: string;
            timezone: string;
            notBeforeAt: string;
          };
          timeoutHours?: number;
        };

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in submit-code-task route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        request.log.info({ userId, promptLength: body.prompt.length }, 'Submitting code task from UI');

        // Sanitize prompt early so raw prompt never leaks to external services
        const sanitizedPromptText = sanitizePrompt(body.prompt);

        // Ensure Linear issue exists (create if not provided)
        const ensureParams: {
          userId: string;
          linearIssueId?: string;
          taskPrompt: string;
        } = { userId, taskPrompt: sanitizedPromptText };
        if (body.linearIssueId !== undefined) {
          ensureParams.linearIssueId = body.linearIssueId;
        }
        const issueResult = await linearIssueService.ensureIssueExists(ensureParams);

        // Derive effective agent type (INT-1468: used to gate scheduledDispatch acceptance)
        const agentType: 'planning' | 'execution' = body.taskMode ?? (hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning');

        // Validate scheduledDispatch (INT-1468): execution-only + future ISO
        let scheduleNotBeforeAt: Date | undefined;
        if (body.scheduledDispatch !== undefined) {
          if (agentType !== 'execution') {
            return await reply.fail('INVALID_REQUEST', 'scheduledDispatch is only allowed when taskMode is execution');
          }
          const parsed = new Date(body.scheduledDispatch.notBeforeAt);
          if (Number.isNaN(parsed.getTime())) {
            return await reply.fail('INVALID_REQUEST', 'scheduledDispatch.notBeforeAt must be a valid ISO 8601 timestamp');
          }
          if (parsed.getTime() <= Date.now()) {
            return await reply.fail('INVALID_REQUEST', 'scheduledDispatch.notBeforeAt must be in the future');
          }
          scheduleNotBeforeAt = parsed;
        }

        // Pre-generate task ID and derive deterministic webhook secret
        const config = loadConfig();
        const taskId = `task_${randomUUID()}`;
        const webhookSecret = generateWebhookSecret(config.orchestratorSecret, taskId);

        // Create task with prompt deduplication.
        const createInput: {
          id: string;
          userId: string;
          prompt: string;
          sanitizedPrompt: string;
          systemPromptHash: string;
          workerType: WorkerType;
          workerLocation: string;
          repository: string;
          baseBranch: string;
          traceId: string;
          webhookSecret: string;
          linearIssueId?: string;
          agentType: 'planning' | 'execution';
          dispatchSchedule?: DispatchScheduleCreateInput;
          timeoutHours?: number;
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
          traceId: `trace_${String(Date.now())}_${Math.random().toString(36).substring(7)}`,
          webhookSecret,
          agentType,
        };

        // Save linearIssueId if available (linking to existing issue)
        if (issueResult.linearIssueId !== undefined) {
          createInput.linearIssueId = issueResult.linearIssueId;
        }

        // Persist user-provided schedule on the new task (INT-1468)
        if (scheduleNotBeforeAt !== undefined && body.scheduledDispatch !== undefined) {
          const dispatchSchedule: DispatchScheduleCreateInput = {
            notBeforeAt: scheduleNotBeforeAt,
            source: 'user_scheduled',
            timezone: body.scheduledDispatch.timezone,
            localDateTime: body.scheduledDispatch.localDateTime,
            derivedBy: 'user_input',
          };
          createInput.dispatchSchedule = dispatchSchedule;
        }

        // Persist user-provided timeout override on the new task (INT-1585)
        if (body.timeoutHours !== undefined) {
          createInput.timeoutHours = body.timeoutHours;
        }

        const createResult = await codeTaskRepo.create(createInput);

        if (!createResult.ok) {
          request.log.warn({ error: createResult.error }, 'Failed to create code task');

          if (createResult.error.code === 'DUPLICATE_PROMPT') {
            return await reply.fail('CONFLICT', `Similar task submitted in last 5 minutes: ${createResult.error.existingTaskId}`);
          }

          if (createResult.error.code === 'ACTIVE_TASK_EXISTS') {
            return await reply.fail('CONFLICT', `Active task already exists for this Linear issue: ${createResult.error.existingTaskId}`);
          }

          return await reply.fail('INTERNAL_ERROR', createResult.error.message);
        }

        const task = createResult.value;

        // Back-link planning task to this execution task (INT-725, best-effort)
        await backLinkPlanningTask(codeTaskRepo, request.log, task);

        // Fetch user's worker settings to validate workers are configured
        const settingsResult = await workerSettingsRepo.getSettings(userId);
        if (!settingsResult.ok) {
          request.log.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
          const problem = dispatchFailureProblem({
            message: 'Task could not be dispatched because worker settings could not be loaded.',
            remediation: 'Retry this task after worker settings are available.',
          });
          const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
          const failUpdate = await codeTaskRepo.update(task.id, {
            status: 'failed',
            error: taskErrorFromDispatchStatus(dispatchStatus),
            dispatchStatus,
          });
          if (!failUpdate.ok) {
            request.log.error({ taskId: task.id, error: failUpdate.error }, 'Failed to mark task failed after worker settings lookup failed');
            return await reply.fail('INTERNAL_ERROR', failUpdate.error.message);
          }
          await notifyDispatchProblemForTask({
            task,
            dispatchStatus,
            problem,
            whatsappNotifier,
            codeTaskRepo,
            logger: serviceLogger,
            affectedTaskCount: 1,
          });
          return await reply.ok({
            status: 'failed',
            codeTaskId: task.id,
          });
        }

        const settings = settingsResult.value;

        // Build worker credentials from user's settings
        // Only include enabled workers, in the user's priority order
        const enabledWorkers = settings?.workers.filter((w) => w.enabled) ?? [];

        // Fail if no workers configured
        if (enabledWorkers.length === 0) {
          request.log.warn({ userId }, 'User has no workers configured');
          const dispatchability = classifyCodeTaskDispatchability({
            workerType: task.workerType,
            workers: enabledWorkers,
            healthByWorkerName: {},
          }) as Extract<ReturnType<typeof classifyCodeTaskDispatchability>, { dispatchable: false }>;
          if (codeTaskDispatchStatusService !== undefined) {
            try {
              await codeTaskDispatchStatusService.recordDispatchBlocked({
                userId,
                workerType: task.workerType,
                blocker: dispatchability,
                affectedTaskCount: 1,
                exampleTaskIds: [task.id],
              });
            } catch (error) {
              request.log.warn(
                { taskId: task.id, reason: dispatchability.reason, error },
                'Failed to record code task dispatch blocker status during submit'
              );
            }
          }
          const problem = dispatchProblemFromBlocker(dispatchability);
          const dispatchStatus = buildDispatchStatusForProblem({
            task,
            problem,
          });
          const failUpdate = await codeTaskRepo.update(task.id, {
            status: 'failed',
            error: taskErrorFromDispatchStatus(dispatchStatus),
            dispatchStatus,
          });
          if (!failUpdate.ok) {
            request.log.error({ taskId: task.id, error: failUpdate.error }, 'Failed to mark task failed after no enabled workers');
            return await reply.fail('INTERNAL_ERROR', failUpdate.error.message);
          }
          await notifyDispatchProblemForTask({
            task,
            dispatchStatus,
            problem,
            whatsappNotifier,
            codeTaskRepo,
            logger: serviceLogger,
            affectedTaskCount: 1,
          });
          return await reply.ok({
            status: 'failed',
            codeTaskId: task.id,
          });
        }

        // Enqueue task for dispatch (INT-949)
        const enqueueResult = await taskEnqueueService.enqueue({
          taskId: task.id,
          userId,
        });

        if (!enqueueResult.ok) {
          if (enqueueResult.error.code === 'queue_full') {
            return await reply.ok({
              status: 'failed',
              codeTaskId: task.id,
            });
          }
          return await reply.fail('INTERNAL_ERROR', enqueueResult.error.message);
        }

        // Mark Linear issue as In Progress after successful enqueue
        if (issueResult.linearIssueId !== undefined) {
          await linearIssueService.markInProgress(userId, issueResult.linearIssueId);
        }

        request.log.info({ taskId: task.id }, 'Code task submitted and enqueued successfully');

        return await reply.ok({
          status: 'submitted',
          codeTaskId: task.id,
        });
      }
    );

    fastify.get<{
      Querystring: {
        status?: string;
        limit?: number;
        cursor?: string;
      };
    }>(
      '/tasks',
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
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in list-user-tasks route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        // Parse comma-separated status filter.
        const validStatuses: TaskStatus[] = ['dispatched', 'running', 'queued', 'planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled', 'archived'];
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
          /* v8 ignore start -- ts-type: Fastify schema injects default — ?? fallback unreachable @preserve */
          limit: request.query.limit ?? 20,
          /* v8 ignore stop @preserve */
        };

        if (statusFilter !== undefined && statusFilter.length > 0) {
          listInput.status = statusFilter;
        }

        if (request.query.cursor !== undefined) {
          listInput.cursor = request.query.cursor;
        }

        const listResult = await codeTaskRepo.list(listInput);

        if (!listResult.ok) {
          request.log.error({ error: listResult.error }, 'Failed to list code tasks');
          return await reply.fail('INTERNAL_ERROR', listResult.error.message);
        }

        const filteredTasks = listResult.value.tasks.filter((t) => t.agentType !== 'ask_agent');
        const apiTasks = filteredTasks.map(taskToApiResponse);
        const linearIssueIds = Array.from(
          new Set(
            filteredTasks
              .map((task) => task.linearIssueId)
              .filter((issueId): issueId is string => issueId !== undefined)
          )
        );

        let hydratedIssuesByIdentifier = new Map<string, {
          identifier: string;
          parentIdentifier: string | null;
          title: string;
          state: { name: string; type: string };
          priority: number;
          assignee: { id: string; name: string } | null;
          labels: { id: string; name: string }[];
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
          ...(listResult.value.nextCursor !== undefined && { nextCursor: listResult.value.nextCursor }),
        });
      }
    );

    fastify.get<{
      Params: { taskId: string };
    }>(
      '/tasks/:taskId',
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
                    prNumber: { type: 'number', nullable: true },
                    agentType: { type: 'string', enum: ['planning', 'execution', 'pull_request', 'review', 'remediation', 'ask_agent'] },
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
                        review_comments_posted: { type: 'string', nullable: true },
                        review_types: { type: 'string', nullable: true },
                        requirements_tracker_updated: { type: 'string', nullable: true },
                        needs_remediation: { type: 'string', nullable: true },
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
                            action: { type: 'string', nullable: true },
                          },
                        },
                      },
                    },
                    dispatchStatus: dispatchStatusSchema,
                    callbackState: callbackStateSchema,
                    executionMemoryContext: executionMemoryContextSchema,
                    executionMemoryPostRun: executionMemoryPostRunSchema,
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
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in get-task-details route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        logger.info({ userId, taskId: request.params.taskId }, 'Getting code task');

        const getResult = await codeTaskRepo.findByIdForUser(request.params.taskId, userId);

        if (!getResult.ok) {
          if (getResult.error.code === 'NOT_FOUND') {
            logger.warn({ taskId: request.params.taskId, userId }, 'Code task not found');
            return await reply.fail('NOT_FOUND', `Task ${request.params.taskId} not found`);
          }

          logger.error({ error: getResult.error }, 'Failed to get code task');
          return await reply.fail('INTERNAL_ERROR', getResult.error.message);
        }

        const task = getResult.value; // @allow-result-access -- narrowed by !result.ok guard above
        const apiResponse = taskToApiResponse(task);

        let linearIssue: undefined | {
          identifier: string;
          parentIdentifier: string | null;
          title: string;
          state: { name: string; type: string };
          priority: number;
          assignee: { id: string; name: string } | null;
          labels: { id: string; name: string }[];
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
            hasResult: task.result !== undefined,
            resultKeys: task.result ? Object.keys(task.result) : [],
            apiResponseHasResult: apiResponse.result !== undefined,
            apiResponseResultKeys: apiResponse.result ? Object.keys(apiResponse.result) : [],
            hasLinearIssue: linearIssue !== undefined,
          },
          'Returning task for GET /code/tasks/:taskId'
        );

        return await reply.ok({ ...apiResponse, linearIssue });
      }
    );

    fastify.delete<{
      Params: { taskId: string };
    }>(
      '/tasks/:taskId',
      {
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
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in delete-task route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */
        const { taskId } = request.params;

        logger.info({ userId, taskId }, 'Deleting code task');

        const deleteResult = await codeTaskRepo.deleteTask(taskId, userId);

        if (!deleteResult.ok) {
          if (deleteResult.error.code === 'NOT_FOUND') {
            return await reply.fail('NOT_FOUND', `Task ${taskId} not found`);
          }
          logger.error({ error: deleteResult.error, taskId }, 'Failed to delete code task');
          return await reply.fail('INTERNAL_ERROR', deleteResult.error.message);
        }

        logger.info({ userId, taskId }, 'Code task deleted');
        return await reply.ok({ deleted: true });
      }
    );

    fastify.post<{
      Params: { taskId: string };
    }>(
      '/tasks/:taskId/archive',
      {
        schema: {
          operationId: 'archiveCodeTask',
          summary: 'Archive a code task',
          description: 'Archives a code task owned by the authenticated user. Task must be in a terminal status.',
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
                    archived: { type: 'boolean' },
                  },
                  required: ['archived'],
                },
              },
            },
          },
        },
      },
      async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/tasks/:taskId/archive',
          includeParams: true,
        });

        const { codeTaskRepo, logger } = getServices();
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in archive-task route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */
        const { taskId } = request.params;

        logger.info({ userId, taskId }, 'Archiving code task');

        const findResult = await codeTaskRepo.findByIdForUser(taskId, userId);

        if (!findResult.ok) {
          if (findResult.error.code === 'NOT_FOUND') {
            return await reply.fail('NOT_FOUND', `Task ${taskId} not found`);
          }
          logger.error({ error: findResult.error, taskId }, 'Failed to find code task for archiving');
          return await reply.fail('INTERNAL_ERROR', findResult.error.message);
        }

        const task = findResult.value;
        if (!TERMINAL_STATUSES.includes(task.status)) {
          return await reply.fail('INVALID_REQUEST', `Cannot archive task with status '${task.status}'`);
        }

        const updateResult = await codeTaskRepo.update(taskId, { status: 'archived' });

        if (!updateResult.ok) {
          logger.error({ error: updateResult.error, taskId }, 'Failed to archive code task');
          return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        logger.info({ userId, taskId }, 'Code task archived');
        return await reply.ok({ archived: true });
      }
    );

    fastify.post<{
      Body: { taskId: string };
    }>(
      '/cancel',
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

        const { codeTaskRepo, taskDispatcher, workerSettingsRepo } = getServices();
        const { taskId } = request.body;
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in cancel-task route — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        const result = await cancelTask(
          {
            logger: request.log,
            codeTaskRepo,
            taskDispatcher,
            workerSettingsRepo,
          },
          {
            taskId,
            userId,
            traceId: extractOrGenerateTraceId(request.headers),
          }
        );

        if (!result.ok) {
          const errorCode = CANCEL_TASK_ERROR_CODE_MAP[result.error.code];
          return await reply.fail(errorCode, result.error.message);
        }

        return await reply.ok({ status: 'cancelled' });
      }
    );

    fastify.get(
      '/workers/status',
      {
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
                          enabled: { type: 'boolean' },
                          healthy: { type: 'boolean' },
                          status: {
                            type: 'string',
                            enum: ['healthy', 'orchestrator-unreachable', 'tunnel-down', 'unknown', 'disabled'],
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
                              error: { type: 'string' },
                              missingFields: { type: 'array', items: { type: 'string' } },
                              contractMismatch: { type: 'boolean' },
                            },
                          },
                          checkedAt: { type: 'string', format: 'date-time', nullable: true },
                          stale: { type: 'boolean' },
                        },
                        required: ['name', 'url', 'priority', 'enabled', 'healthy', 'status', 'details', 'checkedAt', 'stale'],
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

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in worker-health-get route — ?? fallback unreachable @preserve */
        if (userId === undefined || userId === '') {
          return await reply.fail('UNAUTHORIZED', 'Authentication required');
        }
        /* v8 ignore stop @preserve */

        const settingsResult = await workerSettingsRepo.getSettings(userId);

        if (!settingsResult.ok || settingsResult.value === null) {
          return await reply.ok({ workers: [], stale: false });
        }

        const settings = settingsResult.value;
        const TTL_MS = 60_000;
        const now = Date.now();

        const healthStatusesResult = await workerSettingsRepo.getHealthStatuses(userId);
        const healthStatuses = healthStatusesResult.ok ? healthStatusesResult.value ?? {} : {};
        const enabledWorkers = settings.workers.filter(isWorkerEnabled);

        let stale = false;
        for (const worker of enabledWorkers) {
          const status = healthStatuses[worker.name];
          if (status === undefined) {
            continue;
          }
          const checkedAt = new Date(status.checkedAt).getTime();
          if (now - checkedAt > TTL_MS) {
            stale = true;
            status.stale = true;
          }
        }

        const hasMissingEnabledHealthStatus = enabledWorkers.some((w) => healthStatuses[w.name] === undefined);

        if (enabledWorkers.length > 0 && (stale || hasMissingEnabledHealthStatus)) {
          // Deduplicate in-flight health probes per user
          const probeKey = `health-probe:${userId}`;
          let probePromise = inFlightRequests.get(probeKey);

          if (!probePromise) {
            probePromise = workerHealthProbe
              .probeAllWorkers(enabledWorkers)
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
          void probePromise.catch((error: unknown) => {
            logger.error({ error }, 'Failed to refresh worker health statuses');
          });
        }

        const workers = settings.workers.map((w, index) =>
          formatWorkerStatus(w, index + 1, healthStatuses[w.name])
        );

        return await reply.ok({ workers, stale });
      }
    );

    fastify.post(
      '/workers/refresh-status',
      {
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
                          enabled: { type: 'boolean' },
                          healthy: { type: 'boolean' },
                          status: {
                            type: 'string',
                            enum: ['healthy', 'orchestrator-unreachable', 'tunnel-down', 'unknown', 'disabled'],
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
                              error: { type: 'string' },
                              missingFields: { type: 'array', items: { type: 'string' } },
                              contractMismatch: { type: 'boolean' },
                            },
                          },
                          checkedAt: { type: 'string', format: 'date-time', nullable: true },
                          stale: { type: 'boolean' },
                        },
                        required: ['name', 'url', 'priority', 'enabled', 'healthy', 'status', 'details', 'checkedAt', 'stale'],
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

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in worker-health-refresh route — ?? fallback unreachable @preserve */
        if (userId === undefined || userId === '') {
          return await reply.fail('UNAUTHORIZED', 'Authentication required');
        }
        /* v8 ignore stop @preserve */

        const settingsResult = await workerSettingsRepo.getSettings(userId);

        if (!settingsResult.ok || settingsResult.value === null) {
          return await reply.ok({ workers: [], stale: false });
        }

        const settings = settingsResult.value;

        const enabledWorkers = settings.workers.filter(isWorkerEnabled);
        const results = enabledWorkers.length > 0
          ? await workerHealthProbe.probeAllWorkers(enabledWorkers)
          : {};
        const checkedAt = new Date().toISOString();

        for (const [name, state] of Object.entries(results)) {
          await workerSettingsRepo.updateHealthStatus(userId, name, {
            state,
            checkedAt,
            stale: false,
          });
        }

        const workers = settings.workers.map((w, index) => {
          const state = results[w.name];
          const status = formatWorkerStatus(
            w,
            index + 1,
            state === undefined ? undefined : { state, checkedAt, stale: false }
          );
          if (isWorkerEnabled(w) && state === undefined) {
            return {
              ...status,
              checkedAt,
              stale: false,
            };
          }
          return status;
        });

        return await reply.ok({ workers, stale: false });
      }
    );

    // POST /code/retry - Retry a failed or cancelled code task (INT-520)
    fastify.post(
      '/retry',
      {
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
                ...workerTypeSchema,
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

        const {
          codeTaskRepo,
          linearAgentClient,
          taskEnqueueService,
          metricsClient,
          gitHubPRClient,
          userServiceClient,
          automationLog,
        } =
          getServices();
        const userId = request.user?.userId;

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in retry-task route — ?? fallback unreachable @preserve */
        if (userId === undefined || userId === '') {
          return await reply.fail('UNAUTHORIZED', 'Authentication required');
        }
        /* v8 ignore stop @preserve */

        const { taskId, additionalContext, workerType } = request.body as { taskId: string; additionalContext?: string; workerType?: string };

        request.log.info({ taskId, userId, hasAdditionalContext: additionalContext !== undefined, workerType }, 'Processing task retry');

        // Build retry request - only include additionalContext if defined
        const retryRequest: {
          originalTaskId: string;
          userId: string;
          additionalContext?: string;
          workerType?: WorkerType;
        } = {
          originalTaskId: taskId,
          userId,
        };
        // Only add additionalContext if provided
        if (additionalContext !== undefined) {
          retryRequest.additionalContext = additionalContext;
        }
        // Only add workerType if provided and valid
        if (workerType !== undefined && isCodeTaskWorkerType(workerType)) {
          retryRequest.workerType = workerType;
        }

        const result = await retryTask(
          {
            logger: request.log,
            codeTaskRepo,
            linearAgentClient,
            taskEnqueueService,
            metricsClient,
            gitHubPRClient,
            userServiceClient,
            orchestratorSecret: loadConfig().orchestratorSecret,
            automationLog,
          },
          retryRequest
        );

        if (!result.ok) {
          const error = result.error;

          // Map error codes to response codes
          if (error.code === 'task_not_found') {
            return await reply.fail('NOT_FOUND', error.message);
          }
          if (error.code === 'invalid_status' || error.code === 'too_soon' || error.code === 'worker_not_configured') {
            // Use BAD_REQUEST for client-side errors with additional data
            // @allow-raw-send: Returning retryAfterMs which is not supported by reply.fail()
            return await reply.status(400).send({
              success: false,
              error: {
                code: error.code,
                message: error.message,
                ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
              },
            });
          }

          // Internal error
          request.log.error({ error }, 'Task retry failed');
          return await reply.fail('INTERNAL_ERROR', 'Failed to retry task');
        }

        request.log.info(
          { originalTaskId: taskId, retryTaskId: result.value.codeTaskId }, // @allow-result-access -- narrowed by !result.ok guard above
          'Task retry created successfully'
        );

        return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
      }
    );

    // POST /code/tasks/:taskId/implement - Start Execution Agent implementation from a completed planning task
    fastify.post(
      '/tasks/:taskId/implement',
      {
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
                ...workerTypeSchema,
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
                    childTaskIds: { type: 'array', items: { type: 'string' } },
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

        const { codeTaskRepo, linearAgentClient, taskEnqueueService, metricsClient, workerSettingsRepo, gitHubPRClient, userServiceClient } =
          getServices();
        const userId = request.user?.userId;

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId in start-execution-agent route — ?? fallback unreachable @preserve */
        if (userId === undefined) {
          return await reply.fail('UNAUTHORIZED', 'Authentication required');
        }
        /* v8 ignore stop @preserve */

        const { taskId } = request.params as { taskId: string };
        const body = request.body as { workerType?: string } | undefined;
        const requestedWorkerType = body?.workerType;

        request.log.info({ taskId, userId, workerType: requestedWorkerType }, 'Processing Execution Agent implementation request');

        // Only add workerType if provided and valid
        const executionAgentRequest: { originalTaskId: string; userId: string; workerType?: WorkerType } = { originalTaskId: taskId, userId };
        if (requestedWorkerType !== undefined && isCodeTaskWorkerType(requestedWorkerType)) {
          executionAgentRequest.workerType = requestedWorkerType;
        }

        const result = await submitToExecutionAgent(
          {
            logger: request.log,
            codeTaskRepo,
            linearAgentClient,
            taskEnqueueService,
            metricsClient,
            workerSettingsRepo,
            orchestratorSecret: loadConfig().orchestratorSecret,
            gitHubPRClient,
            userServiceClient,
          },
          executionAgentRequest
        );

        if (!result.ok) {
          const error = result.error;
          switch (error.code) {
            case 'task_not_found':
              return await reply.fail('NOT_FOUND', error.message);
            case 'invalid_status':
            case 'no_linear_issue':
            case 'label_not_ready':
              return await reply.fail('INVALID_REQUEST', error.message, undefined, { serverCode: error.code });
            case 'complex_task_no_qualifying_children':
              return await reply.fail('CONFLICT', error.message, undefined, { serverCode: error.code });
            case 'worker_not_configured':
              return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
            case 'already_implemented':
              // @allow-raw-send: 409 with existingTaskId details for frontend navigation
              return await reply.code(409).send({
                success: false,
                error: {
                  code: error.code,
                  message: error.message,
                  details: { existingTaskId: error.existingTaskId, serverCode: error.code },
                },
              });
            case 'active_task_exists':
              return await reply.fail('CONFLICT', error.message, undefined, { serverCode: error.code });
            case 'plan_pr_merge_failed':
              return await reply.fail('PLAN_PR_MERGE_FAILED', error.message);
            case 'internal_error':
            default:
              return await reply.fail('INTERNAL_ERROR', error.message);
          }
        }

        return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
      }
    );
  });

  done();
};
