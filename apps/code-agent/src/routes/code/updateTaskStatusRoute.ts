/**
 * PATCH /internal/code-tasks/:id/status
 *
 * Dedicated, minimal endpoint for the orchestrator to commit terminal task
 * status directly to Firestore. Authed with:
 *   1. X-Internal-Auth header (shared service token)
 *   2. HMAC-SHA256 signature with the shared orchestratorSecret
 *      (same scheme as /internal/code/heartbeat)
 *
 * Body schema is strict (`additionalProperties: false`, primitive types only,
 * no arrays and no defaults) so Ajv cannot mutate the request body and the
 * HMAC signature remains stable against the raw request bytes.
 *
 * Idempotent: if the task is already terminal, the handler returns 200 no-op
 * without calling the repository.
 *
 * No side effects beyond persistence — Linear / WhatsApp / GitHub labelling
 * stays on the existing `task-complete` webhook which fires after this.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import { loadConfig } from '../../config.js';
import { resolveCompletedTaskStatus } from '../../domain/utils/resolveCompletedTaskStatus.js';

interface UpdateTaskStatusBody {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  completedAt: string;
  error?: { code: string; message: string };
  result?: { prUrl?: string; branch?: string; summary?: string };
}

const TERMINAL_STATUSES = new Set<string>([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'implemented',
  'planned',
  'reviewed',
  'archived',
]);

const updateTaskStatusRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // Fastify's default ajv has `removeAdditional: true`, which silently strips
  // unknown properties before validation — so `additionalProperties: false` in
  // the schema does NOT produce a 400 for unknown fields. Verified by removing
  // this block: the "unexpected array field" regression guard test fails (200
  // instead of 400). Keep the strict ajv so contract drift surfaces as a 400.
  const strictAjv = new Ajv.default({
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    allErrors: false,
  });
  addFormats.default(strictAjv);

  fastify.setValidatorCompiler(({ schema }) => strictAjv.compile(schema));

  fastify.patch<{ Params: { id: string }; Body: UpdateTaskStatusBody }>(
    '/internal/code-tasks/:id/status',
    {
      schema: {
        operationId: 'updateCodeTaskStatus',
        summary: 'Orchestrator commits terminal task status to Firestore',
        description:
          'Dedicated endpoint for the orchestrator to commit terminal task status. ' +
          'Authed with orchestratorSecret HMAC. Strict body schema so HMAC is stable.',
        tags: ['internal'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId', 'status', 'completedAt'],
          properties: {
            taskId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['completed', 'failed', 'interrupted', 'cancelled'],
            },
            completedAt: { type: 'string', format: 'date-time' },
            error: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
            result: {
              type: 'object',
              additionalProperties: false,
              properties: {
                prUrl: { type: 'string' },
                branch: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateTaskStatusBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /internal/code-tasks/:id/status',
      });

      // Auth layer 1: shared internal service token
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for update-task-status'
        );
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      // Auth layer 2: orchestrator HMAC signature over rawBody (INT-1412 Task 1)
      const signatureResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });
      if (!signatureResult.ok) {
        request.log.warn(
          { error: signatureResult.error },
          'Orchestrator signature validation failed for update-task-status'
        );
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { id } = request.params;
      const { taskId, status, completedAt, error, result } = request.body;

      if (taskId !== id) {
        return await reply.fail(
          'INVALID_REQUEST',
          'taskId in body does not match :id path parameter'
        );
      }

      const { codeTaskRepo, logger } = getServices();

      const existing = await codeTaskRepo.findById(taskId);
      if (!existing.ok) {
        return await reply.fail('NOT_FOUND', 'Task not found');
      }
      const task = existing.value; // @allow-result-access -- narrowed by !existing.ok guard above

      if (TERMINAL_STATUSES.has(task.status)) {
        logger.info(
          { taskId, currentStatus: task.status, requestedStatus: status },
          'Task already terminal; no-op idempotent response'
        );
        return await reply.ok({ received: true });
      }

      // Map orchestrator-vocabulary 'completed' to code-agent's agent-type-specific
      // terminal status, mirroring /internal/webhooks/task-complete (webhookRoutes.ts
      // around line 1451). The Firestore TaskStatus type does not include 'completed';
      // it uses 'planned' | 'implemented' | 'reviewed'. Other terminal values
      // ('failed' | 'interrupted' | 'cancelled') pass through unchanged.
      const resolvedStatus =
        status === 'completed'
          ? resolveCompletedTaskStatus(task.agentType)
          : status;

      // Always write `error`: either the provided value or explicit null to
      // clear any stale error captured during the `running` phase. Mirrors the
      // existing /internal/webhooks/task-complete behavior this endpoint
      // replaces as the primary status writer. `result` remains conditional —
      // the existing pattern does not clear it on failure.
      const updateFields: Record<string, unknown> = {
        status: resolvedStatus,
        completedAt: new Date(completedAt),
        error: error ?? null,
      };
      if (result !== undefined) {
        updateFields['result'] = result;
      }

      const updateResult = await codeTaskRepo.update(taskId, updateFields);
      if (!updateResult.ok) {
        request.log.error(
          { taskId, error: updateResult.error },
          'Failed to update task status'
        );
        return await reply.fail('INTERNAL_ERROR', 'Failed to update task status');
      }

      logger.info(
        { taskId, requestedStatus: status, resolvedStatus, agentType: task.agentType },
        'Task status committed via /internal/code-tasks/:id/status'
      );
      return await reply.ok({ received: true });
    }
  );

  done();
};

export default updateTaskStatusRoute;
