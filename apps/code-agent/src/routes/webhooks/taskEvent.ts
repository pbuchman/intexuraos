/**
 * Task-event webhook route handler.
 *
 * Receives task lifecycle events from the orchestrator and records them
 * to the unified PR automation log. Best-effort — failures are logged
 * but never block the caller.
 *
 * Auth: X-Internal-Auth + HMAC-SHA256 orchestrator signature.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import { loadConfig } from '../../config.js';
import type { AutomationEvent } from '../../domain/ports/automationLog.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

const VALID_EVENTS = new Set([
  'task_started',
  'task_completed',
  'task_failed',
  'task_interrupted',
] as const);

type TaskEventType = 'task_started' | 'task_completed' | 'task_failed' | 'task_interrupted';

interface TaskEventWebhookBody {
  taskId: string;
  event: string;
  attempt?: number;
  workerType?: string;
  duration?: number;
  commits?: { sha: string; message: string }[];
  prUrl?: string;
  prNumber?: number;
  error?: { code: string; message: string };
  status?: string;
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

function mapToAutomationEvent(body: TaskEventWebhookBody): AutomationEvent {
  const eventType = body.event as TaskEventType;

  switch (eventType) {
    case 'task_started':
      return {
        type: 'task_started',
        taskId: body.taskId,
        workerType: body.workerType ?? 'unknown',
        attempt: body.attempt ?? 1,
      };
    case 'task_completed': {
      const status = (body.status ?? 'unknown') as Extract<AutomationEvent, { type: 'task_completed' }>['status'];
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: body.taskId,
        status,
        duration: body.duration ?? 0,
      };
      if (body.prUrl !== undefined) {
        (event as { prUrl?: string }).prUrl = body.prUrl;
      }
      if (body.commits !== undefined) {
        (event as { commits?: { sha: string; message: string }[] }).commits = body.commits;
      }
      return event;
    }
    case 'task_failed': {
      const event: AutomationEvent = {
        type: 'task_failed',
        taskId: body.taskId,
        error: body.error?.message ?? 'Unknown error',
      };
      if (body.error?.code !== undefined) {
        (event as { errorCode?: string }).errorCode = body.error.code;
      }
      if (body.duration !== undefined) {
        (event as { duration?: number }).duration = body.duration;
      }
      return event;
    }
    case 'task_interrupted': {
      const event: AutomationEvent = {
        type: 'task_interrupted',
        taskId: body.taskId,
      };
      if (body.duration !== undefined) {
        (event as { duration?: number }).duration = body.duration;
      }
      return event;
    }
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const taskEventRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: TaskEventWebhookBody }>(
    '/internal/webhooks/task-event',
    {
      schema: {
        operationId: 'taskEventWebhook',
        tags: ['webhooks'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            event: { type: 'string' },
            attempt: { type: 'number' },
            workerType: { type: 'string' },
            duration: { type: 'number' },
            status: { type: 'string' },
            prUrl: { type: 'string' },
            prNumber: { type: 'number' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
            commits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sha: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          required: ['taskId', 'event'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: TaskEventWebhookBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/webhooks/task-event',
      });

      // Step 1: Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for task-event webhook');
        return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Step 2: Validate orchestrator HMAC signature
      const signatureResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Orchestrator signature validation failed for task-event');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      // Step 3: Validate request body
      const { taskId, event } = request.body;

      if (taskId === '') {
        return await reply.fail('INVALID_REQUEST', 'Missing taskId');
      }

      if (!VALID_EVENTS.has(event as TaskEventType)) {
        return await reply.fail('INVALID_REQUEST', `Unknown event type: ${event}`);
      }

      // Step 4: Look up task to get repository and prNumber
      const { codeTaskRepo, automationLog, logger } = getServices();

      const taskResult = await codeTaskRepo.findById(taskId);
      if (!taskResult.ok) {
        logger.warn({ taskId, error: taskResult.error }, 'Task-event webhook: task not found, skipping automation log');
        // @allow-raw-send: orchestrator contract requires simple acknowledgment
        return await reply.send({ received: true });
      }

      const task = taskResult.value;

      if (task.prNumber === undefined) {
        logger.warn({ taskId }, 'Task-event webhook: task has no prNumber, skipping automation log');
        // @allow-raw-send: orchestrator contract requires simple acknowledgment
        return await reply.send({ received: true });
      }

      // Step 5: Map and record the event (best-effort)
      const prRef = { repository: task.repository, prNumber: task.prNumber };
      const automationEvent = mapToAutomationEvent(request.body);

      try {
        await automationLog.record(prRef, automationEvent, task.userId);
      } catch (error: unknown) {
        logger.warn(
          { taskId, repository: task.repository, prNumber: task.prNumber, error },
          'Task-event webhook: failed to record automation event'
        );
      }

      // @allow-raw-send: orchestrator contract requires simple acknowledgment
      return await reply.send({ received: true });
    }
  );

  done();
};
