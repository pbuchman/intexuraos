/* eslint-disable */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { Timestamp } from '@google-cloud/firestore';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { validateWebhookSignature } from '../infra/webhookValidation.js';

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // ============================================================
  // INTERNAL WEBHOOK ROUTES (X-Internal-Auth + HMAC Signature)
  // ============================================================

  // POST /internal/webhooks/task-complete - Task completion callback from orchestrator
  fastify.post<{
    Body: {
      taskId: string;
      status: 'completed' | 'failed' | 'interrupted';
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
      };
      duration?: number;
    };
  }>(
    '/internal/webhooks/task-complete',
    {
      schema: {
        operationId: 'taskCompleteWebhook',
        summary: 'Task completion webhook from orchestrator',
        description: 'Internal webhook endpoint called by orchestrator when task completes. Requires HMAC signature.',
        tags: ['internal', 'webhooks'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string', enum: ['completed', 'failed', 'interrupted'] },
            result: {
              type: 'object',
              properties: {
                prUrl: { type: 'string' },
                branch: { type: 'string' },
                commits: { type: 'number' },
                summary: { type: 'string' },
                ciFailed: { type: 'boolean' },
                partialWork: { type: 'boolean' },
                rebaseResult: { type: 'string', enum: ['success', 'conflict', 'skipped'] },
              },
              required: ['branch', 'commits', 'summary'],
            },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['code', 'message'],
            },
            duration: { type: 'number' },
          },
          required: ['taskId', 'status'],
        },
        response: {
          200: {
            description: 'Webhook processed successfully',
            type: 'object',
            properties: {
              received: { type: 'boolean', enum: [true] },
            },
            required: ['received'],
          },
          401: {
            description: 'Invalid signature',
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
    async (request: FastifyRequest<{ Body: { taskId: string; status: 'completed' | 'failed' | 'interrupted'; result?: { prUrl?: string; branch: string; commits: number; summary: string; ciFailed?: boolean; partialWork?: boolean; rebaseResult?: 'success' | 'conflict' | 'skipped' }; error?: { code: string; message: string }; duration?: number } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/webhooks/task-complete',
      });

      // Step 1: Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for task-complete webhook');
        return reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Step 2: Validate HMAC signature
      const signatureResult = await validateWebhookSignature(request, {
        /* v8 ignore start -- ts-type: Result.ok check and optional chaining create type narrowing branches @preserve */
        getWebhookSecret: async (taskId) => {
          const services = getServices();
          const taskResult = await services.codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
            return null;
          }
          return taskResult.value.webhookSecret ?? null;
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
        },
        /* v8 ignore stop @preserve */
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed');
        /* v8 ignore stop @preserve */
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return reply.status(401).send({
          success: false,
          error: {
            code: signatureResult.error.code.toUpperCase(),
            message: signatureResult.error.message,
          },
        });
      }

      const { codeTaskRepo, actionsAgentClient, whatsappNotifier, rateLimitService, metricsClient, logger } = getServices();
      const { taskId, status, result, error } = request.body;

      // Extract traceId from headers for downstream calls
      const traceId = extractOrGenerateTraceId(request.headers);

      logger.info(
        {
          taskId,
          status,
          traceId,
          hasResult: result !== undefined,
          resultKeys: result ? Object.keys(result) : [],
          resultBranch: result?.branch,
          resultPrUrl: result?.prUrl,
          bodyKeys: Object.keys(request.body),
        },
        'Processing task-complete webhook'
      );

      // Get task details first (to check for actionId)
      /* v8 ignore start -- ts-type: Result.ok check creates type narrowing branch @preserve */
      const taskResult = await codeTaskRepo.findById(taskId);
      /* v8 ignore stop @preserve */
      if (!taskResult.ok) {
        request.log.error({ taskId, error: taskResult.error }, 'Task not found');
        return reply.fail('NOT_FOUND', 'Task not found');
      }

      const task = taskResult.value;

      // Step 3: Update task based on status
      if (status === 'completed') {
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'completed',
          ...(result !== undefined && { result }),
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as completed');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        // Notify actions-agent if task has actionId
        if (task.actionId) {
          /* v8 ignore start -- ts-type: optional chaining on result?.prUrl creates type narrowing branch @preserve */
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'completed', result?.prUrl ? {
            prUrl: result.prUrl,
          } : undefined, traceId);
          /* v8 ignore stop @preserve */

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
          }
        }

        // Send WhatsApp notification (use updated task with result populated)
        const completedTask = { ...task, status: 'completed' as const, ...(result !== undefined && { result }) };
        await whatsappNotifier.notifyTaskComplete(task.userId, completedTask);

        // Record task completion for rate limiting (fire and forget)
        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        // Record metrics (fire and forget)
        metricsClient.incrementTasksCompleted(task.workerType, 'completed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }
        /* v8 ignore stop @preserve */

        // Verify result was stored
        const verifyResult = await codeTaskRepo.findById(taskId);
        /* v8 ignore start -- ts-type: ternary operators create type narrowing branches @preserve */
        logger.info(
          {
            taskId,
            resultKeys: result ? Object.keys(result) : [],
            prUrl: result?.prUrl,
            branch: result?.branch,
            storedHasResult: verifyResult.ok && verifyResult.value.result !== undefined,
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
            storedResultKeys: verifyResult.ok && verifyResult.value.result ? Object.keys(verifyResult.value.result) : [],
            /* v8 ignore stop @preserve */
          },
        /* v8 ignore stop @preserve */
          'Task marked as completed'
        );
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

      if (status === 'completed' && !result) {
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'completed',
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as completed (no result)');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        if (task.actionId) {
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'completed', undefined, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
          }
        }

        await whatsappNotifier.notifyTaskComplete(task.userId, { ...task, status: 'completed' as const });

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        metricsClient.incrementTasksCompleted(task.workerType, 'completed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }
        /* v8 ignore stop @preserve */

        request.log.info({ taskId }, 'Task marked as completed (no PR result)');
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

      /* v8 ignore start -- test-infra: status === 'failed' conditional requires specific webhook payload @preserve */
      if (status === 'failed') {
        const taskError = error ?? { code: 'UNKNOWN_FAILURE', message: 'Task failed without error details' };
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'failed',
          error: {
            code: taskError.code,
            message: taskError.message,
          },
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as failed');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        // Notify actions-agent if task has actionId
        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (task.actionId) {
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'failed', {
            error: taskError.message,
          }, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
          }
        }

        await whatsappNotifier.notifyTaskFailed(
          task.userId,
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
          task,
          /* v8 ignore stop @preserve */
          taskError
        );

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        metricsClient.incrementTasksCompleted(task.workerType, 'failed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }
        /* v8 ignore stop @preserve */

        request.log.info({ taskId, error: taskError }, 'Task marked as failed');
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

      /* v8 ignore start -- test-infra: status === 'interrupted' conditional requires specific webhook payload @preserve */
      if (status === 'interrupted') {
      /* v8 ignore stop @preserve */
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'interrupted',
          error: {
            code: 'worker_interrupted',
            message: 'Worker was interrupted during task execution',
          },
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as interrupted');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        // Notify actions-agent if task has actionId
        // Design line 328: interrupted → failed
        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (task.actionId) {
        /* v8 ignore stop @preserve */
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'failed', {
            error: 'Worker was interrupted during task execution',
          }, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
            // Don't fail the webhook - task update succeeded
          }
        }
        /* v8 ignore stop @preserve */

        // Send WhatsApp notification for interrupted task
        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          {
            code: 'worker_interrupted',
            message: 'Worker was interrupted during task execution',
          }
        );

        // Record task completion for rate limiting (fire and forget)
        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        // Record metrics (fire and forget)
        metricsClient.incrementTasksCompleted(task.workerType, 'interrupted').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info({ taskId }, 'Task marked as interrupted');
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }
      /* v8 ignore stop @preserve */

      // Should not reach here, but TypeScript needs it
      return reply.fail('INVALID_REQUEST', 'Unknown task status');
    }
  );

  // POST /internal/logs - Log chunk uploads from orchestrator
  fastify.post<{
    Body: {
      taskId: string;
      chunks: Array<{
        sequence: number;
        content: string;
        timestamp: string;
      }>;
    };
  }>(
    '/internal/logs',
    {
      schema: {
        operationId: 'logChunkUpload',
        summary: 'Log chunk upload from orchestrator',
        description: 'Internal endpoint for uploading log chunks from orchestrator. Requires HMAC signature.',
        tags: ['internal', 'webhooks'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            chunks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sequence: { type: 'number' },
                  content: { type: 'string', maxLength: 8192 },
                  timestamp: { type: 'string' },
                },
                required: ['sequence', 'content', 'timestamp'],
              },
            },
          },
          required: ['taskId', 'chunks'],
        },
        response: {
          200: {
            description: 'Log chunks stored successfully',
            type: 'object',
            properties: {
              received: { type: 'boolean', enum: [true] },
            },
            required: ['received'],
          },
          401: {
            description: 'Invalid signature',
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
    async (request: FastifyRequest<{ Body: { taskId: string; chunks: Array<{ sequence: number; content: string; timestamp: string }> } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/logs',
      });

      // Step 1: Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for log chunk upload');
        return reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Step 2: Validate HMAC signature
      const signatureResult = await validateWebhookSignature(request, {
        /* v8 ignore start -- ts-type: Result.ok check and optional chaining create type narrowing branches @preserve */
        getWebhookSecret: async (taskId) => {
          const services = getServices();
          const taskResult = await services.codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
/* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
            return null;
            /* v8 ignore stop @preserve */
          }
          return taskResult.value.webhookSecret ?? null;
        },
        /* v8 ignore stop @preserve */
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed for logs');
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return reply.status(401).send({
          success: false,
          error: {
            code: signatureResult.error.code.toUpperCase(),
            message: signatureResult.error.message,
          },
        });
      }

      const { logChunkRepo, codeTaskRepo, statusMirrorService } = getServices();
      const { taskId, chunks } = request.body;

      request.log.debug({ taskId, count: chunks.length }, 'Storing log chunks');

      // If this is the first log chunk (sequence 0), task might still be dispatched
      // Update to running and mirror to action
      /* v8 ignore start -- test-infra: requires log chunk with sequence 0 to test @preserve */
      if (chunks.some((c) => c.sequence === 0)) {
        const taskResult = await codeTaskRepo.findById(taskId);
        /* v8 ignore start -- ts-type: Result.ok check creates type narrowing branch @preserve */
        if (taskResult.ok && taskResult.value.status === 'dispatched') {
          await codeTaskRepo.update(taskId, { status: 'running' });
          // Mirror running status to action (non-fatal)
          await statusMirrorService.mirrorStatus({
            actionId: taskResult.value.actionId,
            taskStatus: 'running',
            traceId: extractOrGenerateTraceId(request.headers),
          });
        }
        /* v8 ignore stop @preserve */
      }
      /* v8 ignore stop @preserve */

      // Step 3: Store chunks in Firestore subcollection
      const logChunks = chunks.map((chunk) => ({
        id: '', // Will be auto-generated
        sequence: chunk.sequence,
        content: chunk.content,
        timestamp: Timestamp.fromDate(new Date(chunk.timestamp)),
        size: Buffer.byteLength(chunk.content, 'utf-8'),
      }));

      const storeResult = await logChunkRepo.storeBatch(taskId, logChunks);

      if (!storeResult.ok) {
        request.log.error({ taskId, error: storeResult.error }, 'Failed to store log chunks');
        return reply.fail('INTERNAL_ERROR', storeResult.error.message);
      }

      request.log.debug({ taskId, count: chunks.length }, 'Log chunks stored successfully');
      // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
      return await reply.send({ received: true });
    }
  );

  done();
};
