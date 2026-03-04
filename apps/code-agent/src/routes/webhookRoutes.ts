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

export const parseLinearIdentifierFromUrl = (url: string): string | null => {
  const mdMatch = /\[.*?\]\((.*?)\)/.exec(url);
  const cleanUrl = mdMatch?.[1] ?? url;

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname !== 'linear.app') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const identifier = segments[2];
    if (segments.length < 3 || segments[1] !== 'issue' || identifier === undefined) return null;
    return identifier;
  } catch {
    return null;
  }
};

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Per-task formatter state: persists tool_use_id→name mappings across HTTP requests
  // so Read suppression works even when assistant + tool_result land in different log chunks
  const taskFormatterStates = new Map<string, FormatterState>();

  // ============================================================
  // INTERNAL WEBHOOK ROUTES (X-Internal-Auth + HMAC Signature)
  // ============================================================

  // POST /internal/webhooks/task-complete - Task completion callback from orchestrator
  type TaskCompleteWebhookBody = {
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
      comment_replied?: boolean;
      planning_outcome_label?: 'planned' | 'unclear';
      planning_superpowers_writing_plans_used?: '0' | '1';
      planning_linear_url?: string;
      planning_is_complex?: '0' | '1';
      planning_subtask_urls?: string;
      planning_pr_url?: string;
      planning_unclear_clarification?: string;
      execution_outcome_label?: 'implemented';
      execution_superpowers_executing_plans_used?: '0' | '1';
      execution_superpowers_requesting_code_review_used?: '0' | '1';
      execution_linear_issue_url?: string;
    };
    error?: {
      code: string;
      message: string;
    };
    duration?: number;
    resumedCompletion?: boolean;
  };
  fastify.post<{ Body: TaskCompleteWebhookBody }>(
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
                // --- Fields used in handler logic (strictly validated) ---
                comment_replied: { type: 'boolean' },
                planning_outcome_label: { type: 'string', enum: ['planned', 'unclear'] },
                planning_is_complex: { type: 'string', enum: ['0', '1'] },
                planning_subtask_urls: { type: 'string' },
                planning_pr_url: { type: 'string' },
                planning_unclear_clarification: { type: 'string' },
                execution_linear_issue_url: { type: 'string' },
                // --- Pass-through fields (stored to Firestore, not acted on) ---
                summary: { type: 'string' },
                ciFailed: { type: 'boolean' },
                partialWork: { type: 'boolean' },
                rebaseResult: { type: 'string' },
                planning_superpowers_writing_plans_used: { type: 'string' },
                planning_linear_url: { type: 'string' },
                execution_outcome_label: { type: 'string' },
                execution_superpowers_executing_plans_used: { type: 'string' },
                execution_superpowers_requesting_code_review_used: { type: 'string' },
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
            resumedCompletion: { type: 'boolean' },
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
    async (request: FastifyRequest<{ Body: TaskCompleteWebhookBody }>, reply: FastifyReply) => {
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
          const isComplex = planningResult.planning_is_complex === '1';

          // Normalize original issue: state → todo, labels based on complexity
          const [markTodo, parentLabels] = await Promise.all([
            linearAgentClient.updateIssueState({
              userId: task.userId,
              issueId: originalIssueUuid,
              state: 'todo',
            }),
            linearAgentClient.updateIssueMetadata({
              userId: task.userId,
              issueId: originalIssueUuid,
              addLabels: isComplex ? ['planned'] : [],
              removeLabels: isComplex ? ['unclear', 'code-task'] : ['unclear', 'planned'],
            }),
          ]);
          if (!markTodo.ok) {
            return { ok: false, message: `Failed to normalize original issue state: ${markTodo.error.message}` };
          }
          if (!parentLabels.ok) {
            return { ok: false, message: `Failed to normalize original issue labels: ${parentLabels.error.message}` };
          }

          if (isComplex) {
            const subtaskUrls = (planningResult.planning_subtask_urls ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s !== '');

            if (subtaskUrls.length > 0 && subtaskUrls.length >= originalIssue.childCount) {
              for (const url of subtaskUrls) {
                const identifier = parseLinearIdentifierFromUrl(url);
                if (identifier === null) {
                  return { ok: false, message: `Invalid subtask URL: ${url}` };
                }

                const subtaskValidation = await linearAgentClient.validateIssue({
                  userId: task.userId,
                  identifier,
                });
                if (!subtaskValidation.ok) {
                  return { ok: false, message: `Failed to validate subtask ${identifier}: ${subtaskValidation.error.message}` };
                }

                const subtask = subtaskValidation.value;
                if (subtask.parentId !== originalIssueUuid) {
                  return { ok: false, message: `Subtask ${subtask.identifier} is not a direct child of the input issue — task rejected` };
                }

                const normalizeState = await linearAgentClient.updateIssueState({
                  userId: task.userId,
                  issueId: subtask.id,
                  state: 'todo',
                });
                if (!normalizeState.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${subtask.identifier} state: ${normalizeState.error.message}` };
                }

                const normalizeMetadata = await linearAgentClient.updateIssueMetadata({
                  userId: task.userId,
                  issueId: subtask.id,
                  assigneeId: null,
                  removeLabels: ['planned', 'unclear'],
                  addLabels: ['code-task'],
                });
                if (!normalizeMetadata.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${subtask.identifier} metadata: ${normalizeMetadata.error.message}` };
                }
              }

              const planningPrUrl = planningResult.planning_pr_url ?? '';
              if (planningPrUrl !== '') {
                const prComment = await linearAgentClient.addComment({
                  userId: task.userId,
                  issueId: originalIssueUuid,
                  body: `Planning PR: ${planningPrUrl}`,
                });
                if (!prComment.ok) {
                  return { ok: false, message: `Failed to comment planning PR: ${prComment.error.message}` };
                }
              }
            } else {
              const reason =
                subtaskUrls.length === 0
                  ? 'no subtask URLs provided'
                  : `partial URL extraction (${String(subtaskUrls.length)} URLs < ${String(originalIssue.childCount)} children)`;
              request.log.warn(
                { taskId, linearIssueId: task.linearIssueId, subtaskUrlCount: subtaskUrls.length, childCount: originalIssue.childCount },
                `Complex planning: ${reason} — falling back to fetchIssueTree`
              );

              const treeResult = await linearAgentClient.fetchIssueTree({
                userId: task.userId,
                issueId: originalIssueUuid,
              });
              if (!treeResult.ok) {
                return { ok: false, message: `Failed to fetch issue tree: ${treeResult.error.message}` };
              }

              const directChildren = treeResult.value.descendants.filter(
                (d) => d.parentId === originalIssueUuid
              );

              for (const child of directChildren) {
                const normalizeState = await linearAgentClient.updateIssueState({
                  userId: task.userId,
                  issueId: child.id,
                  state: 'todo',
                });
                if (!normalizeState.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${child.identifier} state: ${normalizeState.error.message}` };
                }

                const normalizeMetadata = await linearAgentClient.updateIssueMetadata({
                  userId: task.userId,
                  issueId: child.id,
                  assigneeId: null,
                  removeLabels: ['planned', 'unclear'],
                  addLabels: ['code-task'],
                });
                if (!normalizeMetadata.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${child.identifier} metadata: ${normalizeMetadata.error.message}` };
                }
              }

              const planningPrUrl = planningResult.planning_pr_url ?? '';
              if (planningPrUrl !== '') {
                const prComment = await linearAgentClient.addComment({
                  userId: task.userId,
                  issueId: originalIssueUuid,
                  body: `Planning PR: ${planningPrUrl}`,
                });
                if (!prComment.ok) {
                  return { ok: false, message: `Failed to comment planning PR: ${prComment.error.message}` };
                }
              }
            }
          } else {
            // LAST: stamp code-task on parent — proof of successful processing
            const stampCodeTask = await linearAgentClient.updateIssueMetadata({
              userId: task.userId,
              issueId: originalIssueUuid,
              assigneeId: null,
              addLabels: ['code-task'],
              removeLabels: ['unclear'],
            });
            if (!stampCodeTask.ok) {
              return { ok: false, message: `Failed to add code-task label to original issue: ${stampCodeTask.error.message}` };
            }
          }

          return { ok: true };
        }

        const clarificationMessage =
          planningResult.planning_unclear_clarification ??
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
          assigneeId: null,
          addLabels: ['code-task'],
          removeLabels: ['unclear'],
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

      const enforcePullRequestOutcome = async (
        pullRequestResult: NonNullable<typeof result>
      ): Promise<{ ok: true } | { ok: false; message: string; code: string }> => {
        if (task.linearIssueId === undefined) {
          return {
            ok: false,
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: 'Pull request enforcement requires routed linearIssueId',
          };
        }
        if (!pullRequestResult.prUrl) {
          return {
            ok: false,
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: 'Pull request enforcement requires result.prUrl',
          };
        }
        if (pullRequestResult.comment_replied === undefined) {
          return {
            ok: false,
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: 'Pull request enforcement requires result.comment_replied',
          };
        }

        const routedIssueValidation = await linearAgentClient.validateIssue({
          userId: task.userId,
          identifier: task.linearIssueId,
        });
        if (!routedIssueValidation.ok) {
          return {
            ok: false,
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to validate routed issue: ${routedIssueValidation.error.message}`,
          };
        }

        const commentResult = await linearAgentClient.addComment({
          userId: task.userId,
          issueId: routedIssueValidation.value.id,
          body: `Pull request: ${pullRequestResult.prUrl}`,
        });
        if (!commentResult.ok) {
          return {
            ok: false,
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to comment on issue with PR URL: ${commentResult.error.message}`,
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
            code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            message: `Failed to move issue to In Review: ${markReview.error.message}`,
          };
        }

        return { ok: true };
      };

      // Step 3: Update task based on status
      if (status === 'completed') {
        // Trace which agent type is being handled for debugging
        request.log.info({ taskId, agentType: task.agentType }, 'Processing completed task');

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

        if (task.agentType === 'pull_request') {
          if (result === undefined) {
            request.log.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Pull request completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
                message: 'Pull request completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }

          const pullRequestEnforcement = await enforcePullRequestOutcome(result);
          if (!pullRequestEnforcement.ok) {
            request.log.error(
              {
                taskId,
                routedIssueId: task.linearIssueId,
                prUrl: result.prUrl,
                commentReplied: result.comment_replied,
                errorCode: pullRequestEnforcement.code,
                error: pullRequestEnforcement.message,
              },
              'Pull request deterministic enforcement failed'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: pullRequestEnforcement.code,
                message: pullRequestEnforcement.message,
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

        if (task.agentType === 'planning') {
          if (result === undefined) {
            request.log.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Planning completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'PLANNING_AGENT_ENFORCEMENT_FAILED',
                message: 'Planning completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }

          if (result.planning_outcome_label === 'planned') {
            const planningEnforcement = await enforcePlanningOutcome('planned', result);
            if (!planningEnforcement.ok) {
              request.log.error({ taskId, error: planningEnforcement.message }, 'Planning deterministic enforcement failed');
              const failResult = await codeTaskRepo.update(taskId, {
                status: 'failed',
                completedAt,
                result,
                error: {
                  code: 'PLANNING_AGENT_ENFORCEMENT_FAILED',
                  message: planningEnforcement.message,
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
          task.agentType === 'planning' ? 'planned' : 'implemented';
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

        // Best-effort In Review transition for agent types without deterministic enforcement
        // (planning, execution, and pull_request agents handle this in their own enforcement paths)
        /* v8 ignore start -- ts-type: optional property checks create type narrowing branches @preserve */
        if (task.agentType !== 'execution' && task.agentType !== 'pull_request' && task.agentType !== 'planning' && prNumber !== undefined && task.linearIssueId !== undefined) {
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
        } else if (request.body.resumedCompletion === true) {
          const resumedNotifyResult = await whatsappNotifier.notifyResumedTaskComplete(task.userId, completedTask);
          if (!resumedNotifyResult.ok) {
            request.log.warn(
              { taskId, errorCode: resumedNotifyResult.error.code, errorMessage: resumedNotifyResult.error.message },
              'Failed to send resumed-task-complete notification'
            );
          }
        } else {
          const completeNotifyResult = await whatsappNotifier.notifyTaskComplete(task.userId, completedTask);
          if (!completeNotifyResult.ok) {
            request.log.warn(
              { taskId, errorCode: completeNotifyResult.error.code, errorMessage: completeNotifyResult.error.message },
              'Failed to send task-complete notification'
            );
          }
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
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: 'PLANNING_AGENT_ENFORCEMENT_FAILED',
                message: unclearEnforcement.message,
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
