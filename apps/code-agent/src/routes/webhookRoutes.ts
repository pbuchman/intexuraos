/**
 * Webhook routes for the code-agent service.
 *
 * Route handlers are intentionally thin: they parse bodies, validate task
 * HMAC signatures, and delegate all domain logic to use cases under
 * `domain/usecases/`. Shared helpers live in `domain/services/webhookHelpers.ts`.
 * JSON schemas live in `webhookRouteSchemas.ts`.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { extractOrGenerateTraceId, type ErrorCode } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { validateWebhookSignature } from '../infra/webhookValidation.js';
import type { TurnMetrics } from '../domain/models/turnMetrics.js';
import type { TaskFormatterEntry } from '../domain/services/webhookHelpers.js';
import {
  handleTaskCompletion,
  type TaskCompleteWebhookBody,
} from '../domain/usecases/handleTaskCompletion.js';
import {
  storeLogChunks,
  recordTurnMetrics,
  type StoreLogChunksBody,
} from '../domain/usecases/recordTaskEvent.js';
import { recordTaskCallbackSuccess } from '../domain/usecases/recordTaskCallbackState.js';
import {
  taskCompleteWebhookSchema,
  logChunkUploadSchema,
  turnMetricsUploadSchema,
} from './webhookRouteSchemas.js';

type LogChunkUploadBody = StoreLogChunksBody;

/**
 * Resolve the per-task webhook secret from Firestore for HMAC signature
 * validation. Shared between task-complete + log-chunk handlers.
 */
async function resolveTaskWebhookSecret(taskId: string): Promise<string | null> {
  const services = getServices();
  const taskResult = await services.codeTaskRepo.findById(taskId);
  if (!taskResult.ok) {
    return null;
  }
  /* v8 ignore start -- test-infra: FakeFirestore task fixtures always include webhookSecret so null path unreachable @preserve */
  return taskResult.value.webhookSecret ?? null;
  /* v8 ignore stop @preserve */
}

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Per-task formatter state: persists tool_use_id→name mappings across HTTP
  // requests so Read suppression works even when assistant + tool_result land
  // in different log chunks. Owned by this plugin instance.
  const taskFormatterStates = new Map<string, TaskFormatterEntry>();

  // POST /internal/webhooks/task-complete - Task completion callback from orchestrator
  fastify.post<{ Body: TaskCompleteWebhookBody }>(
    '/internal/webhooks/task-complete',
    { schema: taskCompleteWebhookSchema },
    async (request: FastifyRequest<{ Body: TaskCompleteWebhookBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to POST /internal/webhooks/task-complete' });

      const signatureResult = await validateWebhookSignature(request, { getWebhookSecret: resolveTaskWebhookSecret });
      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed');
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return await reply.status(401).send({
          success: false,
          error: { code: signatureResult.error.code.toUpperCase(), message: signatureResult.error.message },
        });
      }

      const outcome = await handleTaskCompletion(getServices().logger, {
        body: request.body,
        requestLog: request.log,
        traceId: extractOrGenerateTraceId(request.headers),
        taskFormatterStates,
      });

      if (outcome.kind === 'fail') {
        return await reply.fail(outcome.code as ErrorCode, outcome.message);
      }
      await recordTaskCallbackSuccess(request.body.taskId, 'task_complete', request.log);
      // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
      return await reply.send({ received: true });
    },
  );

  // POST /internal/logs - Log chunk uploads from orchestrator
  fastify.post<{ Body: LogChunkUploadBody }>(
    '/internal/logs',
    { schema: logChunkUploadSchema },
    async (request: FastifyRequest<{ Body: LogChunkUploadBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to POST /internal/logs' });

      const signatureResult = await validateWebhookSignature(request, { getWebhookSecret: resolveTaskWebhookSecret });
      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed for logs');
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return await reply.status(401).send({
          success: false,
          error: { code: signatureResult.error.code.toUpperCase(), message: signatureResult.error.message },
        });
      }

      const outcome = await storeLogChunks(getServices().logger, {
        body: request.body,
        requestLog: request.log,
        traceId: extractOrGenerateTraceId(request.headers),
        taskFormatterStates,
      });

      if (outcome.kind === 'fail') {
        return await reply.fail(outcome.code as ErrorCode, outcome.message);
      }
      await recordTaskCallbackSuccess(request.body.taskId, 'logs', request.log);
      // @allow-raw-send: external webhook callback - orchestrator expects ACK with acknowledged sequences
      return await reply.send({
        received: true,
        acknowledgedSequences: outcome.acknowledgedSequences,
        count: outcome.count,
      });
    },
  );

  // POST /internal/turn-metrics - Turn metrics from orchestrator
  fastify.post<{ Body: TurnMetrics }>(
    '/internal/turn-metrics',
    { schema: turnMetricsUploadSchema },
    async (request: FastifyRequest<{ Body: TurnMetrics }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to POST /internal/turn-metrics' });

      const signatureResult = await validateWebhookSignature(request, { getWebhookSecret: resolveTaskWebhookSecret });
      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Webhook signature validation failed for turn-metrics');
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return await reply.status(401).send({
          success: false,
          error: { code: signatureResult.error.code.toUpperCase(), message: signatureResult.error.message },
        });
      }

      const outcome = await recordTurnMetrics(getServices().logger, {
        body: request.body,
        requestLog: request.log,
      });

      if (outcome.kind === 'fail') {
        return await reply.fail(outcome.code as ErrorCode, outcome.message);
      }
      await recordTaskCallbackSuccess(request.body.taskId, 'turn_metrics', request.log);
      // @allow-raw-send: internal webhook callback - orchestrator expects { received: true }
      return await reply.send({ received: true });
    },
  );

  done();
};
