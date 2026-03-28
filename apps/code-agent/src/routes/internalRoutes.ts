import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { authenticateInternalScheduler } from './helpers/internalAuth.js';
import { getLinearIssueContext } from '../domain/usecases/getLinearIssueContext.js';
import { processExecutionMemoryBacklog } from '../domain/usecases/processExecutionMemoryBacklog.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/merge-conflicts/reconcile - triggered by Cloud Scheduler (INT-1023)
  fastify.post(
    '/internal/merge-conflicts/reconcile',
    {
      schema: {
        operationId: 'reconcileMergeConflicts',
        summary: 'Sync Firestore PR state from GitHub',
        description:
          'Called by Cloud Scheduler every minute. Syncs open/closed state and refreshes mergeConflictStatus for open PRs from GitHub into Firestore.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Reconcile completed',
            type: 'object',
            additionalProperties: false,
            properties: {
              processed: { type: 'number' },
              closed: { type: 'number' },
              reopened: { type: 'number' },
              mergeConflictRefreshed: { type: 'number' },
              skipped: { type: 'number' },
              error: { type: 'number' },
            },
            required: ['processed', 'closed', 'reopened', 'mergeConflictRefreshed', 'skipped', 'error'],
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
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-conflicts/reconcile',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for merge-conflicts reconcile');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for merge-conflicts reconcile');

      const { mergeConflictDetector, logger } = getServices();
      const result = await mergeConflictDetector.reconcile(logger);
      logger.info(result, 'PR state reconciliation completed');

      // @allow-raw-send: cron endpoint returns reconcile stats directly
      return await reply.send(result);
    }
  );

  // GET /internal/linear/issue-context/:identifier - proxy for orchestrator deep validation (INT-1040)
  fastify.get<{ Params: { identifier: string } }>(
    '/internal/linear/issue-context/:identifier',
    {
      schema: {
        operationId: 'getLinearIssueContext',
        summary: 'Proxy issue context from linear-agent with plan path resolution',
        description:
          'Fetches issue description + comments from linear-agent, resolves plan document path. ' +
          'Used by orchestrator for deep validation instead of direct Linear API access.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['identifier'],
          properties: {
            identifier: { type: 'string', description: 'Linear issue identifier (e.g., INT-123)' },
          },
        },
        response: {
          200: {
            description: 'Issue context retrieved',
            type: 'object',
            additionalProperties: false,
            properties: {
              description: { type: ['string', 'null'] },
              comments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    body: { type: 'string' },
                    createdAt: { type: 'string' },
                  },
                  required: ['body', 'createdAt'],
                },
              },
              planDocumentPath: { type: ['string', 'null'] },
            },
            required: ['description', 'comments', 'planDocumentPath'],
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
            description: 'Issue not found',
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
          502: {
            description: 'Upstream service error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['DOWNSTREAM_ERROR'] },
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
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/linear/issue-context/:identifier',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { identifier } = request.params;
      const { linearAgentClient, logger } = getServices();

      const result = await getLinearIssueContext(identifier, {
        linearAgentClient,
        logger,
      });

      if (result.status === 'not_found') {
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      if (result.status === 'error') {
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', `linear-agent error: ${result.code}`);
      }

      // @allow-raw-send: internal endpoint returns structured context directly
      return await reply.send(result.data);
    }
  );


  fastify.post<{ Body: { limit?: number } }>(
    '/internal/execution-memory/process',
    {
      schema: {
        operationId: 'processExecutionMemoryBacklog',
        summary: 'Process pending execution-memory post-run work',
        description:
          'Called by Cloud Scheduler. Claims pending execution-memory post-run tasks and evaluates/distills reusable lessons.',
        tags: ['internal'],
        body: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                limit: { type: 'number', minimum: 1, maximum: 50 },
              },
            },
            { type: 'null' },
          ],
        },
        response: {
          200: {
            description: 'Backlog processing completed',
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  claimed: { type: 'number' },
                  completed: { type: 'number' },
                  skipped: { type: 'number' },
                  errored: { type: 'number' },
                  taskIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['claimed', 'completed', 'skipped', 'errored', 'taskIds'],
              },
              diagnostics: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  requestId: { type: 'string' },
                  durationMs: { type: 'number' },
                  downstreamStatus: { type: 'number' },
                  downstreamRequestId: { type: 'string' },
                  endpointCalled: { type: 'string' },
                },
                required: ['requestId'],
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
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/execution-memory/process',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for execution-memory process');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const result = await processExecutionMemoryBacklog({
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
        logLineRepo: services.logLineRepo,
        turnMetricsRepo: services.turnMetricsRepo,
        linearAgentClient: services.linearAgentClient,
        executionMemoryRepo: services.executionMemoryRepo as NonNullable<typeof services.executionMemoryRepo>,
        executionMemoryApplicationRepo:
          services.executionMemoryApplicationRepo as NonNullable<typeof services.executionMemoryApplicationRepo>,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
        ...(services.executionMemoryEvaluatorClient !== undefined && {
          evaluatorClient: services.executionMemoryEvaluatorClient,
        }),
        ...(services.executionMemoryDistillerClient !== undefined && {
          distillerClient: services.executionMemoryDistillerClient,
        }),
        ...(services.executionMemoryEmbeddingClient !== undefined && {
          embeddingClient: services.executionMemoryEmbeddingClient,
        }),
        /* v8 ignore stop @preserve */
        limit: request.body.limit ?? 10,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // GET /internal/tasks/:taskId/dispatch-metadata - fallback for pruned tasks (INT-1130)
  fastify.get<{ Params: { taskId: string } }>(
    '/internal/tasks/:taskId/dispatch-metadata',
    {
      schema: {
        operationId: 'getTaskDispatchMetadata',
        summary: 'Get dispatch metadata for a task by ID',
        description:
          'Returns the dispatch metadata fields for a code task. ' +
          'Used by the orchestrator as a fallback when a task has been pruned from state.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['taskId'],
          properties: {
            taskId: { type: 'string', description: 'Code task ID' },
          },
        },
        response: {
          200: {
            description: 'Task dispatch metadata',
            type: 'object',
            additionalProperties: false,
            properties: {
              taskId: { type: 'string' },
              prompt: { type: 'string' },
              repository: { type: 'string' },
              baseBranch: { type: 'string' },
              agentType: { type: ['string', 'null'] },
              workerType: { type: 'string' },
              linearIssueId: { type: ['string', 'null'] },
              webhookSecret: { type: ['string', 'null'] },
              prNumber: { type: ['number', 'null'] },
            },
            required: ['taskId', 'prompt', 'repository', 'baseBranch', 'agentType', 'workerType', 'linearIssueId', 'webhookSecret', 'prNumber'],
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
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/tasks/:taskId/dispatch-metadata',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { taskId } = request.params;
      const { codeTaskRepo } = getServices();

      const findResult = await codeTaskRepo.findById(taskId);
      if (!findResult.ok) {
        return await reply.fail('NOT_FOUND', `Task ${taskId} not found`);
      }

      const task = findResult.value;

      // @allow-raw-send: internal endpoint returns structured dispatch metadata directly
      return await reply.send({
        taskId: task.id,
        prompt: task.prompt,
        repository: task.repository,
        baseBranch: task.baseBranch,
        agentType: task.agentType ?? null,
        workerType: task.workerType,
        linearIssueId: task.linearIssueId ?? null,
        webhookSecret: task.webhookSecret ?? null,
        prNumber: task.prNumber ?? null,
      });
    }
  );

  done();
};
