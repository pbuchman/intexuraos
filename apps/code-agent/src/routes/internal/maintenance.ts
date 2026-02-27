/**
 * Maintenance routes: heartbeat, detect-zombies, cleanup-logs.
 *
 * Internal maintenance endpoints for task health monitoring and cleanup.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';

const maintenanceRoute: FastifyPluginCallback = (fastify, _opts, done) => {
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

      return await reply.ok(result.value);
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

      return await reply.ok(result.value);
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
          tasksProcessed: result.value.tasksProcessed,
          logsDeleted: result.value.logsDeleted,
          durationMs: result.value.durationMs,
        },
        'Task log cleanup completed'
      );

      return await reply.ok(result.value);
    }
  );

  done();
};

export default maintenanceRoute;
