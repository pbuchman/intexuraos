import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { authenticateInternalScheduler } from './helpers/internalAuth.js';
import { getLinearIssueContext } from '../domain/usecases/getLinearIssueContext.js';

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

  // PATCH /internal/tasks/:id/remediation-status - set requiresReReview on remediation tasks
  fastify.patch<{ Params: { id: string }; Body: { requiresReReview: boolean } }>(
    '/internal/tasks/:id/remediation-status',
    {
      schema: {
        operationId: 'updateRemediationStatus',
        summary: 'Set requiresReReview on a remediation task',
        description:
          'Called by the remediation agent before pushing code. ' +
          'Validates that the task exists, has agentType=remediation, and the caller task ID matches.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Code task ID' },
          },
        },
        body: {
          type: 'object',
          required: ['requiresReReview'],
          additionalProperties: false,
          properties: {
            requiresReReview: { type: 'boolean' },
          },
        },
        response: {
          200: {
            description: 'Status updated',
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', enum: [true] },
            },
            required: ['ok'],
          },
          400: {
            description: 'Invalid request',
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
          403: {
            description: 'Forbidden',
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
        message: 'Received request to PATCH /internal/tasks/:id/remediation-status',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { id } = request.params;
      const { codeTaskRepo, logger } = getServices();

      // Validate caller task ID matches
      const callerTaskId = request.headers['x-task-id'];
      if (typeof callerTaskId !== 'string' || callerTaskId !== id) {
        return await reply.fail('FORBIDDEN', 'Caller task ID does not match');
      }

      // Look up the task
      const findResult = await codeTaskRepo.findById(id);
      if (!findResult.ok) {
        if (findResult.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', `Task ${id} not found`);
        }
        return await reply.fail('INTERNAL_ERROR', `Failed to look up task ${id}`);
      }

      const task = findResult.value;

      // Verify agentType is remediation
      if (task.agentType !== 'remediation') {
        return await reply.fail('FORBIDDEN', 'Task is not a remediation task');
      }

      // Update requiresReReview
      const { requiresReReview } = request.body;
      const updateResult = await codeTaskRepo.update(id, { requiresReReview });
      if (!updateResult.ok) {
        logger.error({ taskId: id, error: updateResult.error }, 'Failed to update remediation status');
        return await reply.fail('INTERNAL_ERROR', 'Failed to update task');
      }

      logger.info({ taskId: id, requiresReReview }, 'Updated remediation status');

      // @allow-raw-send: internal endpoint returns simple acknowledgement
      return await reply.send({ ok: true });
    }
  );

  done();
};
