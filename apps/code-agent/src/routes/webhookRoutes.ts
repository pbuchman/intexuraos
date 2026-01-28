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
        reply.status(401);
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Internal authentication failed',
          },
        };
      }

      // Step 2: Validate HMAC signature
      const signatureResult = await validateWebhookSignature(request, {
        getWebhookSecret: async (taskId) => {
          const services = getServices();
          const taskResult = await services.codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
            return null;
          }
          return taskResult.value.webhookSecret ?? null;
        },
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed');
        reply.status(401);
        return {
          success: false,
          error: {
            code: signatureResult.error.code.toUpperCase(),
            message: signatureResult.error.message,
          },
        };
      }

      const { codeTaskRepo, actionsAgentClient, whatsappNotifier, rateLimitService, metricsClient } = getServices();
      const { taskId, status, result, error } = request.body;

      // Extract traceId from headers for downstream calls
      const traceId = extractOrGenerateTraceId(request.headers);

      request.log.info(
        { taskId, status, traceId, hasResult: result !== undefined, resultKeys: result ? Object.keys(result) : [] },
        'Processing task-complete webhook'
      );

      // Get task details first (to check for actionId)
      const taskResult = await codeTaskRepo.findById(taskId);
      if (!taskResult.ok) {
        request.log.error({ taskId, error: taskResult.error }, 'Task not found');
        reply.status(404);
        return {
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
          },
        };
      }

      const task = taskResult.value;

      // Step 3: Update task based on status
      if (status === 'completed' && result) {
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'completed',
          result,
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as completed');
          reply.status(500);
          return {
            success: false,
            error: {
              code: updateResult.error.code,
              message: updateResult.error.message,
            },
          };
        }

        // Notify actions-agent if task has actionId
        if (task.actionId) {
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'completed', result.prUrl ? {
            prUrl: result.prUrl,
          } : undefined, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
            // Don't fail the webhook - task update succeeded
          }
        }

        // Send WhatsApp notification
        await whatsappNotifier.notifyTaskComplete(task.userId, task);

        // Record task completion for rate limiting (fire and forget)
        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        // Record metrics (fire and forget)
        metricsClient.incrementTasksCompleted(task.workerType, 'completed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info(
          { taskId, resultKeys: result ? Object.keys(result) : [], prUrl: result?.prUrl, branch: result?.branch },
          'Task marked as completed with result'
        );
        return reply.send({ received: true });
      }

      if (status === 'failed' && error) {
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'failed',
          error: {
            code: error.code,
            message: error.message,
          },
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as failed');
          reply.status(500);
          return {
            success: false,
            error: {
              code: updateResult.error.code,
              message: updateResult.error.message,
            },
          };
        }

        // Notify actions-agent if task has actionId
        if (task.actionId) {
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'failed', {
            error: error.message,
          }, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
            // Don't fail the webhook - task update succeeded
          }
        }

        // Send WhatsApp notification
        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          error ?? {
            code: 'worker_interrupted',
            message: 'Worker was interrupted during task execution',
          }
        );

        // Record task completion for rate limiting (fire and forget)
        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        // Record metrics (fire and forget)
        metricsClient.incrementTasksCompleted(task.workerType, 'failed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info({ taskId, error }, 'Task marked as failed');
        return reply.send({ received: true });
      }

      if (status === 'interrupted') {
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
          reply.status(500);
          return {
            success: false,
            error: {
              code: updateResult.error.code,
              message: updateResult.error.message,
            },
          };
        }

        // Notify actions-agent if task has actionId
        // Design line 328: interrupted → failed
        if (task.actionId) {
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
        return reply.send({ received: true });
      }

      // Should not reach here, but TypeScript needs it
      reply.status(400);
      return {
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Unknown task status',
        },
      };
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
        reply.status(401);
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Internal authentication failed',
          },
        };
      }

      // Step 2: Validate HMAC signature
      const signatureResult = await validateWebhookSignature(request, {
        getWebhookSecret: async (taskId) => {
          const services = getServices();
          const taskResult = await services.codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
            return null;
          }
          return taskResult.value.webhookSecret ?? null;
        },
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed for logs');
        reply.status(401);
        return {
          success: false,
          error: {
            code: signatureResult.error.code.toUpperCase(),
            message: signatureResult.error.message,
          },
        };
      }

      const { logChunkRepo, codeTaskRepo, statusMirrorService } = getServices();
      const { taskId, chunks } = request.body;

      request.log.debug({ taskId, count: chunks.length }, 'Storing log chunks');

      // If this is the first log chunk (sequence 0), task might still be dispatched
      // Update to running and mirror to action
      if (chunks.some((c) => c.sequence === 0)) {
        const taskResult = await codeTaskRepo.findById(taskId);
        if (taskResult.ok && taskResult.value.status === 'dispatched') {
          await codeTaskRepo.update(taskId, { status: 'running' });
          // Mirror running status to action (non-fatal)
          await statusMirrorService.mirrorStatus({
            actionId: taskResult.value.actionId,
            taskStatus: 'running',
            traceId: extractOrGenerateTraceId(request.headers),
          });
        }
      }

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
        reply.status(500);
        return {
          success: false,
          error: {
            code: storeResult.error.code,
            message: storeResult.error.message,
          },
        };
      }

      request.log.debug({ taskId, count: chunks.length }, 'Log chunks stored successfully');
      return reply.send({ received: true });
    }
  );

  done();
};
