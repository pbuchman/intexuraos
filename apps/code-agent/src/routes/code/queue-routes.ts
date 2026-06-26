/**
 * Task queue endpoints (listing queued tasks + draining the queue).
 *
 * Extracted from `codeRoutes.ts` as part of INT-1430 so that route handlers
 * live in resource-specific files and `codeRoutes.ts` can act as a thin
 * Fastify plugin.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { authenticateInternalScheduler } from '../helpers/internalAuth.js';
import { getServices } from '../../services.js';
import { drainTaskQueue } from '../../domain/usecases/drainTaskQueue.js';
import { drainRetryQueue } from '../../domain/usecases/drainRetryQueue.js';
import { createTaskForPR } from '../../domain/usecases/createTaskForPR.js';
import { deletePRTaskLock } from '../../domain/utils/prTaskLock.js';
import { loadConfig } from '../../config.js';
import {
  workerTypeSchema,
} from './schemas.js';
import type { CodeRoutesOptions } from './types.js';
import type { CodeTaskSystemStatus } from '../../domain/models/codeTaskSystemStatus.js';

/** Max characters of sanitized prompt to include in queue listing responses. */
const QUEUE_PROMPT_PREVIEW_LENGTH = 200;

function serializeSystemStatus(status: CodeTaskSystemStatus): Record<string, unknown> {
  return {
    id: status.id,
    component: status.component,
    status: status.status,
    severity: status.severity,
    workerType: status.workerType,
    reason: status.reason,
    message: status.message,
    remediation: status.remediation,
    affectedTaskCount: status.affectedTaskCount,
    exampleTaskIds: status.exampleTaskIds,
    workerNames: status.workerNames,
    firstSeenAt: status.firstSeenAt.toISOString(),
    lastSeenAt: status.lastSeenAt.toISOString(),
    ...(status.lastNotifiedAt !== undefined && { lastNotifiedAt: status.lastNotifiedAt.toISOString() }),
  };
}

export const queueRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;

  // ==== Internal routes (X-Internal-Auth / scheduler) ====

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
                  action: { type: 'string', enum: ['dispatched', 'expired', 'still_busy', 'empty', 'skipped', 'failed', 'message_sent', 'exhausted', 'retry_failed'] },
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

      const authResult = await authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for drain-queue');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for drain-queue');

      const services = getServices();

      // Step 1: Retry queue (front-of-line priority)
      const retryResult = await drainRetryQueue({
        logger: services.logger,
        dispatchRetryRepo: services.dispatchRetryRepo,
        codeTaskRepo: services.codeTaskRepo,
        logLineRepo: services.logLineRepo,
        taskDispatcher: services.taskDispatcher,
        linearAgentClient: services.linearAgentClient,
        whatsappNotifier: services.whatsappNotifier,
        automationLog: services.automationLog,
        /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production services always provide codeTaskDispatchNotificationRepo for retry drain @preserve */
        ...(services.codeTaskDispatchNotificationRepo !== undefined && {
          codeTaskDispatchNotificationRepo: services.codeTaskDispatchNotificationRepo,
        }),
        /* v8 ignore stop @preserve */
        workerSettingsRepo: services.workerSettingsRepo,
        /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production initServices always provides codeTaskDispatchStatusService @preserve */
        ...(services.codeTaskDispatchStatusService !== undefined && {
          codeTaskDispatchStatusService: services.codeTaskDispatchStatusService,
        }),
        /* v8 ignore stop @preserve */
        executionMemory: {
          /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
          ...(services.executionMemoryEmbeddingClient !== undefined && {
            embeddingClient: services.executionMemoryEmbeddingClient,
          }),
          ...(services.executionMemoryRepo !== undefined && {
            executionMemoryRepo: services.executionMemoryRepo,
          }),
          ...(services.executionMemoryApplicationRepo !== undefined && {
            executionMemoryApplicationRepo: services.executionMemoryApplicationRepo,
          }),
          /* v8 ignore stop @preserve */
        },
        userServiceClient: services.userServiceClient,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
        ...(services.userLookupService !== undefined && {
          createTaskForPRFn: async (request: { repository: string; prNumber: number; senderLogin: string; comment: string; eventId: string; prTitle?: string; baseBranch?: string }): ReturnType<typeof createTaskForPR> => {
            return await createTaskForPR(
              {
                logger: services.logger,
                codeTaskRepo: services.codeTaskRepo,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by outer conditional spread `services.userLookupService !== undefined` on same object literal
                userLookupService: services.userLookupService!,
                linearIssueService: services.linearIssueService,
                taskEnqueueService: services.taskEnqueueService,
                whatsappNotifier: services.whatsappNotifier,
                orchestratorSecret: loadConfig().orchestratorSecret,
                gitHubPRClient: services.gitHubPRClient,
                userServiceClient: services.userServiceClient,
                firestore: services.firestore,
                automationLog: services.automationLog,
                workerSettingsRepo: services.workerSettingsRepo,
              },
              {
                repository: request.repository,
                prNumber: request.prNumber,
                senderLogin: request.senderLogin,
                comment: request.comment,
                eventId: request.eventId,
                ...(request.prTitle !== undefined && { prTitle: request.prTitle }),
                ...(request.baseBranch !== undefined && { baseBranch: request.baseBranch }),
              },
            );
          },
        }),
        /* v8 ignore stop @preserve */
      });

      if (!retryResult.ok) {
        request.log.error({ error: retryResult.error }, 'Drain retry queue failed');
        return await reply.fail('INTERNAL_ERROR', retryResult.error.message);
      }

      const retryHasLocksToCleanup = (retryResult.value.locksToCleanup?.length ?? 0) > 0;
      if (
        retryResult.value.action !== 'empty'
        && (retryResult.value.action !== 'failed' || retryHasLocksToCleanup)
      ) {
        for (const lock of retryResult.value.locksToCleanup ?? []) {
          await deletePRTaskLock(services.firestore, lock.repository, lock.prNumber, request.log);
        }
        return await reply.ok(retryResult.value);
      }

      // Step 2: Regular task queue (existing behavior)
      const result = await drainTaskQueue({
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
        logLineRepo: services.logLineRepo,
        taskDispatcher: services.taskDispatcher,
        linearAgentClient: services.linearAgentClient,
        /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production services always provide codeTaskDispatchNotificationRepo for queue drain @preserve */
        whatsappNotifier: services.whatsappNotifier,
        automationLog: services.automationLog,
        ...(services.codeTaskDispatchNotificationRepo !== undefined && {
          codeTaskDispatchNotificationRepo: services.codeTaskDispatchNotificationRepo,
        }),
        /* v8 ignore stop @preserve */
        workerSettingsRepo: services.workerSettingsRepo,
        /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production initServices always provides codeTaskDispatchStatusService @preserve */
        ...(services.codeTaskDispatchStatusService !== undefined && {
          codeTaskDispatchStatusService: services.codeTaskDispatchStatusService,
        }),
        /* v8 ignore stop @preserve */
        taskEnqueueService: services.taskEnqueueService,
        orchestratorSecret: loadConfig().orchestratorSecret,
        executionMemory: {
          /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
          ...(services.executionMemoryEmbeddingClient !== undefined && {
            embeddingClient: services.executionMemoryEmbeddingClient,
          }),
          ...(services.executionMemoryRepo !== undefined && {
            executionMemoryRepo: services.executionMemoryRepo,
          }),
          ...(services.executionMemoryApplicationRepo !== undefined && {
            executionMemoryApplicationRepo: services.executionMemoryApplicationRepo,
          }),
          /* v8 ignore stop @preserve */
        },
        userServiceClient: services.userServiceClient,
      });

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Drain queue failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      for (const lock of result.value.locksToCleanup ?? []) { // @allow-result-access -- narrowed by !result.ok guard above
        await deletePRTaskLock(services.firestore, lock.repository, lock.prNumber, request.log);
      }

      return await reply.ok(result.value); // @allow-result-access -- narrowed by !result.ok guard above
    }
  );

  // ==== Public routes (Auth0 JWT) ====
  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.get(
      '/queue',
      {
        schema: {
          operationId: 'listQueuedTasks',
          summary: 'List currently queued tasks',
          description: 'Public endpoint for listing all currently queued tasks. Requires Auth0 JWT.',
          tags: ['public'],
          response: {
            200: {
              description: 'Queue listing',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  required: ['tasks', 'systemStatuses', 'totalQueued', 'maxQueueSize'],
                  properties: {
                    tasks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          prompt: { type: 'string' },
                          linearIssueId: { type: 'string' },
                          workerType: workerTypeSchema,
                          agentType: { type: 'string' },
                          queuedAt: { type: 'string' },
                          createdAt: { type: 'string' },
                          position: { type: 'number' },
                          dispatchEligibleAt: { type: 'string' },
                          dispatchScheduleSource: { type: 'string', enum: ['user_scheduled', 'retry_cooloff'] },
                          dispatchScheduleText: { type: 'string' },
                        },
                        required: ['id', 'prompt', 'queuedAt', 'createdAt', 'position'],
                      },
                    },
                    systemStatuses: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          component: { type: 'string', enum: ['code-task-dispatch'] },
                          status: { type: 'string', enum: ['active'] },
                          severity: { type: 'string', enum: ['warning', 'critical'] },
                          workerType: { type: 'string' },
                          reason: { type: 'string' },
                          message: { type: 'string' },
                          remediation: { type: 'string' },
                          affectedTaskCount: { type: 'number' },
                          exampleTaskIds: { type: 'array', items: { type: 'string' } },
                          workerNames: { type: 'array', items: { type: 'string' } },
                          firstSeenAt: { type: 'string' },
                          lastSeenAt: { type: 'string' },
                          lastNotifiedAt: { type: 'string' },
                        },
                        required: [
                          'id',
                          'component',
                          'status',
                          'severity',
                          'workerType',
                          'reason',
                          'message',
                          'remediation',
                          'affectedTaskCount',
                          'exampleTaskIds',
                          'workerNames',
                          'firstSeenAt',
                          'lastSeenAt',
                        ],
                      },
                    },
                    totalQueued: { type: 'number' },
                    maxQueueSize: { type: 'number' },
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
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, { message: 'Received request to GET /code/queue' });
        const { codeTaskRepo, codeTaskSystemStatusRepo } = getServices();
        const config = loadConfig();

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        const result = await codeTaskRepo.listQueued();
        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch queue');
        }

        /* v8 ignore start -- ts-type: optional property undefined check for exactOptionalPropertyTypes; production initServices always provides codeTaskSystemStatusRepo @preserve */
        if (codeTaskSystemStatusRepo === undefined) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch queue system status');
        }
        /* v8 ignore stop @preserve */

        const statusResult = await codeTaskSystemStatusRepo.listActiveForUser(userId);
        if (!statusResult.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch queue system status');
        }

        // Scope to requesting user's tasks only — prevents cross-user data leakage
        const userTasks = result.value.filter((task) => task.userId === userId);

        const tasks = userTasks.map((task, index) => {
          const dispatchScheduleFields = task.dispatchSchedule !== undefined
            ? {
                dispatchEligibleAt: task.dispatchSchedule.notBeforeAt.toDate().toISOString(),
                dispatchScheduleSource: task.dispatchSchedule.source,
                dispatchScheduleText: task.dispatchSchedule.source === 'user_scheduled'
                  ? 'Scheduled by user'
                  : 'Waiting for Claude reset',
              }
            : undefined;
          return {
            id: task.id,
            prompt: task.sanitizedPrompt.slice(0, QUEUE_PROMPT_PREVIEW_LENGTH),
            linearIssueId: task.linearIssueId,
            workerType: task.workerType,
            agentType: task.agentType,
            queuedAt: task.queuedAt !== undefined ? task.queuedAt.toDate().toISOString() : task.createdAt.toDate().toISOString(),
            createdAt: task.createdAt.toDate().toISOString(),
            position: index + 1,
            ...(dispatchScheduleFields !== undefined && dispatchScheduleFields),
          };
        });

        return await reply.ok({
          tasks,
          systemStatuses: statusResult.value.map(serializeSystemStatus),
          totalQueued: tasks.length,
          maxQueueSize: config.queue.maxSize,
        });
      }
    );

    fastify.get(
      '/system-status',
      {
        schema: {
          operationId: 'listCodeTaskSystemStatuses',
          summary: 'List active code-task system statuses',
          description: 'Public endpoint for listing active code-task system statuses for the authenticated user. Requires Auth0 JWT.',
          tags: ['public'],
          response: {
            200: {
              description: 'Active code-task system statuses',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  required: ['systemStatuses'],
                  properties: {
                    systemStatuses: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          component: { type: 'string', enum: ['code-task-dispatch'] },
                          status: { type: 'string', enum: ['active'] },
                          severity: { type: 'string', enum: ['warning', 'critical'] },
                          workerType: { type: 'string' },
                          reason: { type: 'string' },
                          message: { type: 'string' },
                          remediation: { type: 'string' },
                          affectedTaskCount: { type: 'number' },
                          exampleTaskIds: { type: 'array', items: { type: 'string' } },
                          workerNames: { type: 'array', items: { type: 'string' } },
                          firstSeenAt: { type: 'string' },
                          lastSeenAt: { type: 'string' },
                          lastNotifiedAt: { type: 'string' },
                        },
                        required: [
                          'id',
                          'component',
                          'status',
                          'severity',
                          'workerType',
                          'reason',
                          'message',
                          'remediation',
                          'affectedTaskCount',
                          'exampleTaskIds',
                          'workerNames',
                          'firstSeenAt',
                          'lastSeenAt',
                        ],
                      },
                    },
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
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, { message: 'Received request to GET /code/system-status' });
        const { codeTaskSystemStatusRepo } = getServices();

        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        /* v8 ignore start -- ts-type: optional property undefined check for exactOptionalPropertyTypes; production initServices always provides codeTaskSystemStatusRepo @preserve */
        if (codeTaskSystemStatusRepo === undefined) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch system status');
        }
        /* v8 ignore stop @preserve */

        const statusResult = await codeTaskSystemStatusRepo.listActiveForUser(userId);
        if (!statusResult.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch system status');
        }

        return await reply.ok({
          systemStatuses: statusResult.value.map(serializeSystemStatus),
        });
      }
    );
  });

  done();
};
