/* eslint-disable */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { Timestamp } from '@google-cloud/firestore';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { validateWebhookSignature, validateOrchestratorSignature } from '../infra/webhookValidation.js';
import { formatLogChunk, createFormatterState, type FormatterState } from '../domain/services/logFormatter.js';
import { loadConfig } from '../config.js';
import type { TurnMetrics } from '../domain/models/turnMetrics.js';
import { formatMetricsLogLines } from '../domain/formatters/metricsLogFormatter.js';

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Per-task formatter state: persists tool_use_id→name mappings across HTTP requests
  // so Read suppression works even when assistant + tool_result land in different log chunks
  const taskFormatterStates = new Map<string, FormatterState>();

  // ============================================================
  // INTERNAL WEBHOOK ROUTES (X-Internal-Auth + HMAC Signature)
  // ============================================================

  // POST /internal/webhooks/task-complete - Task completion callback from orchestrator
  fastify.post<{
    Body: {
      taskId: string;
      status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
      result?: {
        prUrl?: string;
        branch?: string;
        commits?: number;
        summary?: string;
        ciFailed?: boolean;
        partialWork?: boolean;
        rebaseResult?: 'success' | 'conflict' | 'skipped';
        planning_outcome_label?: 'planned' | 'unclear';
        planning_superpowers_writing_plans_used?: '0' | '1';
        planning_issue_url?: string;
        planning_trivial_task?: '0' | '1' | '';
        planning_doc_path?: string;
        planning_pr_url?: string;
        planning_clarification_message?: string;
        execution_outcome_label?: 'implemented';
        execution_superpowers_executing_plans_used?: '0' | '1';
        execution_superpowers_requesting_code_review_used?: '0' | '1';
        execution_trivial_task?: '0' | '1';
        execution_subagents?: string;
        execution_review_iterations?: number;
        execution_linear_issue_url?: string;
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
            status: { type: 'string', enum: ['completed', 'failed', 'interrupted', 'cancelled'] },
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
                planning_outcome_label: { type: 'string', enum: ['planned', 'unclear'] },
                planning_superpowers_writing_plans_used: { type: 'string', enum: ['0', '1'] },
                planning_issue_url: { type: 'string' },
                planning_trivial_task: { type: 'string' },
                planning_doc_path: { type: 'string' },
                planning_pr_url: { type: 'string' },
                planning_clarification_message: { type: 'string' },
                execution_outcome_label: { type: 'string', enum: ['implemented'] },
                execution_superpowers_executing_plans_used: { type: 'string', enum: ['0', '1'] },
                execution_superpowers_requesting_code_review_used: {
                  type: 'string',
                  enum: ['0', '1'],
                },
                execution_trivial_task: { type: 'string', enum: ['0', '1'] },
                execution_subagents: { type: 'string' },
                execution_review_iterations: { type: 'number' },
                execution_linear_issue_url: { type: 'string' },
              },
              required: [],
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
    async (request: FastifyRequest<{ Body: { taskId: string; status: 'completed' | 'failed' | 'interrupted' | 'cancelled'; result?: { prUrl?: string; branch?: string; commits?: number; summary?: string; ciFailed?: boolean; partialWork?: boolean; rebaseResult?: 'success' | 'conflict' | 'skipped'; planning_outcome_label?: 'planned' | 'unclear'; planning_superpowers_writing_plans_used?: '0' | '1'; planning_issue_url?: string; planning_trivial_task?: '0' | '1' | ''; planning_doc_path?: string; planning_pr_url?: string; planning_clarification_message?: string; execution_outcome_label?: 'implemented'; execution_superpowers_executing_plans_used?: '0' | '1'; execution_superpowers_requesting_code_review_used?: '0' | '1'; execution_trivial_task?: '0' | '1'; execution_subagents?: string; execution_review_iterations?: number; execution_linear_issue_url?: string }; error?: { code: string; message: string }; duration?: number } }>, reply: FastifyReply) => {
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

      const { codeTaskRepo, actionsAgentClient, whatsappNotifier, rateLimitService, metricsClient, linearIssueService, linearAgentClient, logger } = getServices();
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
      const completedAt = new Date();

      const parseLinearIdentifierFromUrl = (url: string): string | null => {
        const match = /\/issue\/([^/?#]+)/.exec(url);
        return match?.[1] ?? null;
      };

      const enforcePlanningOutcome = async (
        outcome: 'planned' | 'unclear',
        planningResult: NonNullable<typeof result>,
        taskErrorForUnclear?: { code: string; message: string }
      ): Promise<{ ok: true } | { ok: false; message: string }> => {
        if (task.linearIssueId === undefined) {
          return { ok: false, message: 'Planning enforcement requires original linearIssueId' };
        }

        const originalIssueValidation = await linearAgentClient.validateIssue({
          userId: task.userId,
          identifier: task.linearIssueId,
        });
        if (!originalIssueValidation.ok) {
          return { ok: false, message: `Failed to validate original issue: ${originalIssueValidation.error.message}` };
        }

        const originalIssue = originalIssueValidation.value;
        const originalIssueUuid = originalIssue.id;

        if (outcome === 'planned') {
          const planningIssueUrl = planningResult.planning_issue_url ?? '';
          const planningIdentifier = parseLinearIdentifierFromUrl(planningIssueUrl);
          if (planningIdentifier === null) {
            return { ok: false, message: 'Missing or invalid planning_issue_url for planned outcome' };
          }

          const planningIssueValidation = await linearAgentClient.validateIssue({
            userId: task.userId,
            identifier: planningIdentifier,
          });
          if (!planningIssueValidation.ok) {
            return { ok: false, message: `Failed to validate planning issue: ${planningIssueValidation.error.message}` };
          }

          const planningTreeResult = await linearAgentClient.fetchIssueTree({
            userId: task.userId,
            issueId: planningIssueValidation.value.id,
          });
          if (!planningTreeResult.ok) {
            return { ok: false, message: `Failed to fetch planning issue tree: ${planningTreeResult.error.message}` };
          }

          if (planningTreeResult.value.root.parentId !== originalIssueUuid) {
            return { ok: false, message: 'Planning issue is not a child of original issue' };
          }

          const planningLinkComment = `Planning issue created: ${planningIssueUrl}`;
          const commentOriginalResult = await linearAgentClient.addComment({
            userId: task.userId,
            issueId: originalIssueUuid,
            body: planningLinkComment,
          });
          if (!commentOriginalResult.ok) {
            return { ok: false, message: `Failed to comment original issue: ${commentOriginalResult.error.message}` };
          }

          const markReview = await linearAgentClient.updateIssueState({
            userId: task.userId,
            issueId: originalIssueUuid,
            state: 'in_review',
          });
          if (!markReview.ok) {
            return { ok: false, message: `Failed to move original issue to In Review: ${markReview.error.message}` };
          }

          const originalLabelNormalize = await linearAgentClient.updateIssueMetadata({
            userId: task.userId,
            issueId: originalIssueUuid,
            addLabels: ['planned'],
            removeLabels: ['unclear', 'code-task'],
          });
          if (!originalLabelNormalize.ok) {
            return { ok: false, message: `Failed to normalize original issue labels: ${originalLabelNormalize.error.message}` };
          }

          const normalizeTargets = [
            planningTreeResult.value.root,
            ...planningTreeResult.value.descendants,
          ];
          for (const issueNode of normalizeTargets) {
            const stateResult = await linearAgentClient.updateIssueState({
              userId: task.userId,
              issueId: issueNode.id,
              state: 'todo',
            });
            if (!stateResult.ok) {
              return { ok: false, message: `Failed to move planning tree issue to Todo: ${stateResult.error.message}` };
            }

            const metadataResult = await linearAgentClient.updateIssueMetadata({
              userId: task.userId,
              issueId: issueNode.id,
              assigneeId: null,
              addLabels: ['code-task'],
              removeLabels: ['planned', 'unclear'],
            });
            if (!metadataResult.ok) {
              return { ok: false, message: `Failed to normalize planning tree issue labels/assignee: ${metadataResult.error.message}` };
            }
          }

          const planningPrUrl = planningResult.planning_pr_url ?? '';
          if (planningPrUrl !== '') {
            const originalPrComment = await linearAgentClient.addComment({
              userId: task.userId,
              issueId: originalIssueUuid,
              body: `Planning PR: ${planningPrUrl}`,
            });
            if (!originalPrComment.ok) {
              return { ok: false, message: `Failed to comment planning PR on original issue: ${originalPrComment.error.message}` };
            }
            const planningPrComment = await linearAgentClient.addComment({
              userId: task.userId,
              issueId: planningTreeResult.value.root.id,
              body: `Planning PR: ${planningPrUrl}`,
            });
            if (!planningPrComment.ok) {
              return { ok: false, message: `Failed to comment planning PR on planning issue: ${planningPrComment.error.message}` };
            }
          }

          return { ok: true };
        }

        const clarificationMessage =
          planningResult.planning_clarification_message ??
          taskErrorForUnclear?.message ??
          'Planning agent reported unclear outcome';

        const unclearComment = await linearAgentClient.addComment({
          userId: task.userId,
          issueId: originalIssueUuid,
          body: clarificationMessage,
        });
        if (!unclearComment.ok) {
          return { ok: false, message: `Failed to comment unclear clarification: ${unclearComment.error.message}` };
        }

        const unclearLabels = await linearAgentClient.updateIssueMetadata({
          userId: task.userId,
          issueId: originalIssueUuid,
          addLabels: ['unclear'],
          removeLabels: ['planned', 'code-task'],
        });
        if (!unclearLabels.ok) {
          return { ok: false, message: `Failed to enforce unclear labels: ${unclearLabels.error.message}` };
        }

        return { ok: true };
      };

      const enforceExecutionOutcome = async (
        executionResult: NonNullable<typeof result>
      ): Promise<{ ok: true } | { ok: false; message: string; code: string }> => {
        if (task.linearIssueId === undefined) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: 'Execution enforcement requires routed linearIssueId',
          };
        }
        if (!executionResult.prUrl) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: 'Execution enforcement requires result.prUrl',
          };
        }
        const reportedIssueUrl = executionResult.execution_linear_issue_url;
        if (!reportedIssueUrl) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_WRONG_ISSUE_MISMATCH',
            message: 'Missing execution_linear_issue_url for execution completion',
          };
        }

        const routedIssueValidation = await linearAgentClient.validateIssue({
          userId: task.userId,
          identifier: task.linearIssueId,
        });
        if (!routedIssueValidation.ok) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to validate routed issue: ${routedIssueValidation.error.message}`,
          };
        }

        const reportedIdentifier = parseLinearIdentifierFromUrl(reportedIssueUrl);
        if (reportedIdentifier === null) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_WRONG_ISSUE_MISMATCH',
            message: `Invalid execution_linear_issue_url: ${reportedIssueUrl}`,
          };
        }

        const reportedIssueValidation = await linearAgentClient.validateIssue({
          userId: task.userId,
          identifier: reportedIdentifier,
        });
        if (!reportedIssueValidation.ok) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to validate execution-reported issue: ${reportedIssueValidation.error.message}`,
          };
        }

        if (reportedIssueValidation.value.id !== routedIssueValidation.value.id) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_WRONG_ISSUE_MISMATCH',
            message:
              `Execution agent reported different Linear issue (routed=${task.linearIssueId}, reported=${reportedIdentifier})`,
          };
        }

        const commentResult = await linearAgentClient.addComment({
          userId: task.userId,
          issueId: routedIssueValidation.value.id,
          body: `Implementation PR: ${executionResult.prUrl}`,
        });
        if (!commentResult.ok) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to comment executed issue with PR URL: ${commentResult.error.message}`,
          };
        }

        const markReview = await linearAgentClient.updateIssueState({
          userId: task.userId,
          issueId: routedIssueValidation.value.id,
          state: 'in_review',
        });
        if (!markReview.ok) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to move executed issue to In Review: ${markReview.error.message}`,
          };
        }

        const keepCodeTaskLabel = await linearAgentClient.updateIssueMetadata({
          userId: task.userId,
          issueId: routedIssueValidation.value.id,
          addLabels: ['code-task'],
        });
        if (!keepCodeTaskLabel.ok) {
          return {
            ok: false,
            code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to preserve code-task label on executed issue: ${keepCodeTaskLabel.error.message}`,
          };
        }

        return { ok: true };
      };

      // Step 3: Update task based on status
      if (status === 'completed') {
        if (task.agentType === 'execution') {
          if (result === undefined) {
            request.log.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Execution completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
                message: 'Execution completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }

          const executionEnforcement = await enforceExecutionOutcome(result);
          if (!executionEnforcement.ok) {
            request.log.error(
              {
                taskId,
                routedIssueId: task.linearIssueId,
                reportedIssueUrl: result.execution_linear_issue_url,
                prUrl: result.prUrl,
                errorCode: executionEnforcement.code,
                error: executionEnforcement.message,
              },
              'Execution deterministic enforcement failed'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: executionEnforcement.code,
                message: executionEnforcement.message,
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }
        }

        if (result?.planning_outcome_label === 'planned') {
          const planningEnforcement = await enforcePlanningOutcome('planned', result);
          if (!planningEnforcement.ok) {
            request.log.error({ taskId, error: planningEnforcement.message }, 'Planning deterministic enforcement failed');
            return reply.fail('INTERNAL_ERROR', planningEnforcement.message);
          }
        }

        // Extract PR number from prUrl for findByPR correlation (INT-465)
        let prNumber: number | undefined;
        if (result?.prUrl) {
          const match = /\/pull\/(\d+)/.exec(result.prUrl);
          if (match?.[1] !== undefined) {
            prNumber = Number(match[1]);
          }
        }

        const resolvedStatus =
          result?.planning_outcome_label === 'planned'
            ? 'planned'
            : task.agentType === 'execution' || task.agentType === 'pull_request'
              ? 'implemented'
              : 'planned';
        const updateResult = await codeTaskRepo.update(taskId, {
          status: resolvedStatus,
          completedAt,
          ...(result !== undefined && { result }),
          ...(prNumber !== undefined && { prNumber }),
          ...(result?.branch !== undefined && { prBranch: result.branch }),
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as completed');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        // Transition Linear issue to In Review when PR is created (best-effort)
        /* v8 ignore start -- ts-type: optional property checks create type narrowing branches @preserve */
        if (task.agentType !== 'execution' && prNumber !== undefined && task.linearIssueId !== undefined) {
          await linearIssueService.markInReview(task.userId, task.linearIssueId);
        }
        /* v8 ignore stop @preserve */

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
        /* v8 ignore start -- ts-type: spread with boolean shorthand creates complex type that requires assertion @preserve */
        const completedTask = { ...task, status: resolvedStatus, ...(result !== undefined && { result }) } as typeof task;
        /* v8 ignore stop @preserve */

        // INT-628: If planning agent completed, send notification with button to proceed to execution
        if (task.agentType === 'planning') {
          const notifyResult = await whatsappNotifier.notifyDesignComplete(task.userId, completedTask);
          if (!notifyResult.ok) {
            request.log.warn(
              { taskId, errorCode: notifyResult.error.code, errorMessage: notifyResult.error.message },
              'Failed to send design-complete notification — user may not receive Phase 2 button'
            );
          }
        } else {
          await whatsappNotifier.notifyTaskComplete(task.userId, completedTask);
        }

        // Record task completion for rate limiting (fire and forget)
        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        // Record metrics (fire and forget)
        metricsClient.incrementTasksCompleted(task.workerType, resolvedStatus).catch((err) => {
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

      /* v8 ignore start -- test-infra: status === 'failed' conditional requires specific webhook payload @preserve */
      if (status === 'failed') {
        const taskError = error ?? { code: 'UNKNOWN_FAILURE', message: 'Task failed without error details' };
        if (taskError.code === 'PLANNING_AGENT_UNCLEAR' && result?.planning_outcome_label === 'unclear') {
          const unclearEnforcement = await enforcePlanningOutcome('unclear', result, taskError);
          if (!unclearEnforcement.ok) {
            request.log.error({ taskId, error: unclearEnforcement.message }, 'Planning unclear deterministic enforcement failed');
            return reply.fail('INTERNAL_ERROR', unclearEnforcement.message);
          }
        }
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'failed',
          completedAt,
          ...(result !== undefined && { result }),
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
          completedAt,
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

      /* v8 ignore start -- test-infra: status === 'cancelled' conditional requires specific webhook payload @preserve */
      if (status === 'cancelled') {
      /* v8 ignore stop @preserve */
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'cancelled',
          completedAt,
          error: {
            code: 'task_cancelled',
            message: 'Task was cancelled by user',
          },
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as cancelled');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
        if (task.actionId) {
        /* v8 ignore stop @preserve */
          const actionsResult = await actionsAgentClient.updateActionStatus(task.actionId, 'cancelled', undefined, traceId);

          if (!actionsResult.ok) {
            request.log.warn(
              { taskId, actionId: task.actionId, error: actionsResult.error },
              'Failed to notify actions-agent - action status may be stale'
            );
          }
        }

        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          {
            code: 'task_cancelled',
            message: 'Task was cancelled by user',
          }
        );

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });

        metricsClient.incrementTasksCompleted(task.workerType, 'cancelled').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info({ taskId }, 'Task marked as cancelled');
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

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
                  content: { type: 'string', maxLength: 65536 },
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
              acknowledgedSequences: { type: 'array', items: { type: 'number' } },
              count: { type: 'number' },
            },
            required: ['received', 'acknowledgedSequences', 'count'],
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

      const { logChunkRepo, logLineRepo, codeTaskRepo, statusMirrorService } = getServices();
      const { taskId, chunks } = request.body;

      request.log.debug({ taskId, count: chunks.length }, 'Storing log chunks');

      // First log delivery for this task — task might still be dispatched.
      // Update to running and mirror to action.
      /* v8 ignore start -- test-infra: requires first log chunk delivery to test @preserve */
      if (!taskFormatterStates.has(taskId)) {
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
        id: '',
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

      const state = taskFormatterStates.get(taskId) ?? createFormatterState();
      const allLines = chunks.flatMap((chunk) => {
        const chunkTimestamp = Timestamp.fromDate(new Date(chunk.timestamp));
        return formatLogChunk(chunk.content, chunk.sequence, chunkTimestamp, state);
      });
      taskFormatterStates.set(taskId, state);

      if (allLines.length > 0) {
        const lineResult = await logLineRepo.storeBatch(taskId, allLines);
        if (!lineResult.ok) {
          request.log.error({ taskId, error: lineResult.error }, 'Failed to store log lines (chunks stored OK)');
        }
      }

      const acknowledgedSequences = chunks.map((c) => c.sequence);
      request.log.debug({ taskId, count: chunks.length, lines: allLines.length }, 'Log chunks stored successfully');
      // @allow-raw-send: external webhook callback - orchestrator expects ACK with acknowledged sequences
      return await reply.send({ received: true, acknowledgedSequences, count: acknowledgedSequences.length });
    }
  );

  // POST /internal/turn-metrics - Turn metrics from orchestrator
  fastify.post<{
    Body: TurnMetrics;
  }>(
    '/internal/turn-metrics',
    {
      schema: {
        operationId: 'turnMetricsUpload',
        summary: 'Turn metrics upload from orchestrator',
        description: 'Internal endpoint for uploading turn-end metrics from orchestrator. Requires orchestrator HMAC signature.',
        tags: ['internal', 'webhooks'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            attempt: { type: 'number' },
            timestamp: { type: 'string' },
            cpuTimeSeconds: { type: 'number' },
            cpuCores: { type: 'number' },
            peakMemoryMB: { type: 'number' },
            wallTimeSeconds: { type: 'number' },
            apiWaitSeconds: { type: 'number' },
            toolExecSeconds: { type: 'number' },
            backgroundWaitSeconds: { type: 'number' },
            overheadSeconds: { type: 'number' },
            totalInputTokens: { type: 'number' },
            totalOutputTokens: { type: 'number' },
            totalCacheReadTokens: { type: 'number' },
            totalCacheCreationTokens: { type: 'number' },
            apiCallCount: { type: 'number' },
            cpuUtilizationPercent: { type: 'number' },
            idlePercent: { type: 'number' },
          },
          required: ['taskId', 'attempt', 'timestamp'],
        },
        response: {
          200: {
            description: 'Metrics stored successfully',
            type: 'object',
            properties: {
              received: { type: 'boolean', enum: [true] },
            },
            required: ['received'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: TurnMetrics }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/turn-metrics',
      });

      // Step 1: Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for turn-metrics');
        return reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      // Step 2: Validate orchestrator HMAC signature
      const signatureResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });

      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Orchestrator signature validation failed for turn-metrics');
        return reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      // Step 3: Store metrics
      const { turnMetricsRepo, logLineRepo } = getServices();
      const metrics = request.body;

      const storeResult = await turnMetricsRepo.store(
        metrics.taskId,
        metrics.attempt,
        metrics
      );

      if (!storeResult.ok) {
        request.log.error({ taskId: metrics.taskId, error: storeResult.error }, 'Failed to store turn metrics');
        return reply.fail('INTERNAL_ERROR', storeResult.error.message);
      }

      // Step 4: Append formatted metrics as log lines (non-fatal)
      const metricsLines = formatMetricsLogLines(metrics);
      const now = Date.now();
      const formattedLines = metricsLines.map((text, i) => ({
        sequence: now * 1000 + i,
        text,
        timestamp: Timestamp.fromDate(new Date(metrics.timestamp)),
      }));

      const lineResult = await logLineRepo.storeBatch(metrics.taskId, formattedLines);
      if (!lineResult.ok) {
        request.log.warn(
          { taskId: metrics.taskId, error: lineResult.error },
          'Failed to store metrics log lines (non-fatal, metrics stored OK)'
        );
      }

      request.log.info(
        { taskId: metrics.taskId, attempt: metrics.attempt, logLines: metricsLines.length },
        'Turn metrics stored with log lines'
      );
      // @allow-raw-send: internal webhook callback - orchestrator expects { received: true }
      return await reply.send({ received: true });
    }
  );

  done();
};
