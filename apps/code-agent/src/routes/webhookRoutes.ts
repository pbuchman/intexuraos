/* eslint-disable */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { Timestamp } from '@google-cloud/firestore';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { extractOrGenerateTraceId } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { validateWebhookSignature, validateOrchestratorSignature } from '../infra/webhookValidation.js';
import {
  formatLogChunkForRuntime,
  flushLogChunkFormatterForRuntime,
  createFormatterState,
  type FormatterState,
  type LogRuntime,
} from '../domain/services/logFormatter.js';
import { loadConfig } from '../config.js';
import type { TurnMetrics } from '../domain/models/turnMetrics.js';
import { formatMetricsLogLines } from '../domain/formatters/metricsLogFormatter.js';
import { deletePRTaskLock } from '../domain/utils/prTaskLock.js';
import { parseLinearIdentifierFromUrl } from '../domain/utils/linearIdentifierParser.js';
import { parseOwnerRepo } from '../domain/utils/parseOwnerRepo.js';
import { drainTaskQueue } from '../domain/usecases/drainTaskQueue.js';
import { isMemoryEligibleAgent } from '../domain/utils/memoryEligibility.js';

/**
 * Best-effort: record a task_failed automation log event for PR-linked tasks.
 * Encapsulates the repeated guard + fire-and-forget pattern used across enforcement checks.
 */
function recordTaskFailed(params: {
  task: { repository: string; prNumber?: number; dispatchedAt?: Timestamp; userId: string };
  taskId: string;
  completedAt: Date;
  error: string;
  errorCode: string;
}): void {
  if (params.task.prNumber === undefined) return;
  getServices().automationLog.record(
    { repository: params.task.repository, prNumber: params.task.prNumber },
    {
      type: 'task_failed',
      taskId: params.taskId,
      error: params.error,
      errorCode: params.errorCode,
      /* v8 ignore start -- test-infra: FakeFirestore cannot simulate Firestore Timestamp for dispatchedAt in task_failed scenarios @preserve */
      ...(params.task.dispatchedAt !== undefined && {
        duration: params.completedAt.getTime() - new Date(params.task.dispatchedAt.toDate()).getTime(),
      }),
      /* v8 ignore stop @preserve */
    },
    params.task.userId,
  ).catch((e: unknown) => {
    getServices().logger.warn({ error: e, taskId: params.taskId }, 'Failed to record automation log for task failure');
  });
}

function shouldQueueExecutionMemoryPostRun(params: {
  agentType: string | undefined; // @allow-undefined-type -- required parameter, not optional property
  existingStatus: string | undefined; // @allow-undefined-type -- required parameter, not optional property
}): boolean {
  return (
    loadConfig().executionMemoryEnabled
    && isMemoryEligibleAgent(params.agentType)
    && params.existingStatus === undefined
  );
}

function recordRemediationDecision(params: {
  repository: string;
  prNumber: number;
  userId: string;
  required: boolean;
  signal: '0' | '1' | 'missing';
  taskId?: string;
}): void {
  getServices().automationLog.record(
    { repository: params.repository, prNumber: params.prNumber },
    {
      type: 'remediation_decision',
      required: params.required,
      source: 'review_result',
      signal: params.signal,
      ...(params.taskId !== undefined && { taskId: params.taskId }),
    },
    params.userId,
  ).catch((e: unknown) => {
    getServices().logger.warn(
      { error: e, repository: params.repository, prNumber: params.prNumber },
      'Failed to record remediation decision automation log',
    );
  });
}

function resolveLogRuntime(workerType: string): LogRuntime {
  return workerType.startsWith('codex') ? 'codex' : 'claude';
}

interface TaskFormatterEntry {
  runtime: LogRuntime;
  state: FormatterState;
  lastSequence: number;
}

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Per-task formatter state: persists tool_use_id→name mappings across HTTP requests
  // so Read suppression works even when assistant + tool_result land in different log chunks
  const taskFormatterStates = new Map<string, TaskFormatterEntry>();

  async function flushPendingTaskLogLines(taskId: string): Promise<void> {
    const formatterEntry = taskFormatterStates.get(taskId);
    if (formatterEntry === undefined) return;

    taskFormatterStates.delete(taskId);

    const pendingLines = flushLogChunkFormatterForRuntime(
      formatterEntry.runtime,
      formatterEntry.lastSequence + 1,
      Timestamp.now(),
      formatterEntry.state,
    );

    if (pendingLines.length === 0) {
      return;
    }

    const lineResult = await getServices().logLineRepo.storeBatch(taskId, pendingLines);
    if (!lineResult.ok) {
      getServices().logger.error(
        { taskId, error: lineResult.error },
        'Failed to flush pending log lines on task completion',
      );
    }
  }

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
      execution_outcome_label?: 'implemented' | 'already_completed';
      execution_superpowers_subagent_driven_dev_used?: '0' | '1';
      execution_superpowers_requesting_code_review_used?: '0' | '1';
      execution_memory_ids_used?: string;
      execution_memory_ids_rejected?: string;
      execution_memory_usage_summary?: string;
      execution_linear_issue_url?: string;
      review_id?: string;
      review_comments_posted?: string;
      review_types?: string;
      requirements_tracker_updated?: string;
      gh_actions_status?: string;
      needs_remediation?: string;
      requires_re_review?: string;
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
                execution_superpowers_subagent_driven_dev_used: { type: 'string' },
                execution_superpowers_requesting_code_review_used: { type: 'string' },
                execution_memory_ids_used: { type: 'string' },
                execution_memory_ids_rejected: { type: 'string' },
                execution_memory_usage_summary: { type: 'string' },
                review_id: { type: 'string' },
                review_comments_posted: { type: 'string' },
                review_types: { type: 'string' },
                requirements_tracker_updated: { type: 'string' },
                gh_actions_status: { type: 'string' },
                needs_remediation: { type: 'string' },
                requires_re_review: { type: 'string' },
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
        // @allow-raw-send: preserve domain-specific signature error codes for webhook validation
        return reply.status(401).send({
          success: false,
          error: {
            code: signatureResult.error.code.toUpperCase(),
            message: signatureResult.error.message,
          },
        });
      }

      const {
        codeTaskRepo,
        statusMirrorService,
        whatsappNotifier,
        rateLimitService,
        metricsClient,
        linearIssueService,
        linearAgentClient,
        logger,
        firestore,
        gitHubPRSummaryRepo,
        gitHubPRClient,
        userServiceClient,
      } = getServices();
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
      const taskResult = await codeTaskRepo.findById(taskId);
      if (!taskResult.ok) {
        request.log.error({ taskId, error: taskResult.error }, 'Task not found');
        return reply.fail('NOT_FOUND', 'Task not found');
      }

      const task = taskResult.value;
      const completedAt = new Date();

      // Step 2.5: Ignore stale callbacks for already-cancelled tasks
      if (task.status === 'cancelled') {
        if (status !== 'cancelled') {
          request.log.info({ taskId, incomingStatus: status }, 'Ignoring stale callback for cancelled task');
        } else {
          request.log.info({ taskId }, 'Ignoring duplicate cancelled callback');
        }
        // @allow-raw-send: external webhook callback contract requires simple acknowledgment
        return await reply.send({ received: true });
      }

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
              addLabels: isComplex ? ['complex-task'] : [],
              removeLabels: isComplex ? ['unclear', 'code-task', 'planning-task'] : ['unclear', 'complex-task', 'planning-task'],
            }),
          ]);
          if (!markTodo.ok) {
            return { ok: false, message: `Failed to normalize original issue state: ${markTodo.error.message}` };
          }
          if (!parentLabels.ok) {
            return { ok: false, message: `Failed to normalize original issue labels: ${parentLabels.error.message}` };
          }

          if (isComplex) {
            /* v8 ignore start -- ts-type: result field ?? fallback for optional webhook payload fields @preserve */
            const subtaskUrls = (planningResult.planning_subtask_urls ?? '')
            /* v8 ignore stop @preserve */
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
                  removeLabels: ['complex-task', 'unclear', 'planning-task'],
                  addLabels: ['code-task'],
                });
                if (!normalizeMetadata.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${subtask.identifier} metadata: ${normalizeMetadata.error.message}` };
                }
              }

              /* v8 ignore start -- ts-type: result field ?? fallback for optional webhook payload fields @preserve */
              const planningPrUrl = planningResult.planning_pr_url ?? '';
              /* v8 ignore stop @preserve */
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
                `Complex planning: ${reason} — falling back to fetchDirectChildrenLive`
              );

              const directChildrenResult = await linearAgentClient.fetchDirectChildrenLive({
                userId: task.userId,
                issueId: originalIssueUuid,
              });
              if (!directChildrenResult.ok) {
                return { ok: false, message: `Failed to fetch live direct children: ${directChildrenResult.error.message}` };
              }

              const directChildren = directChildrenResult.value.filter(
                (child) => child.parentId === originalIssueUuid
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
                  removeLabels: ['complex-task', 'unclear', 'planning-task'],
                  addLabels: ['code-task'],
                });
                if (!normalizeMetadata.ok) {
                  return { ok: false, message: `Failed to normalize subtask ${child.identifier} metadata: ${normalizeMetadata.error.message}` };
                }
              }

              /* v8 ignore start -- ts-type: result field ?? fallback for optional webhook payload fields @preserve */
              const planningPrUrl = planningResult.planning_pr_url ?? '';
              /* v8 ignore stop @preserve */
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
              removeLabels: ['unclear', 'planning-task'],
            });
            if (!stampCodeTask.ok) {
              return { ok: false, message: `Failed to add code-task label to original issue: ${stampCodeTask.error.message}` };
            }
          }

          return { ok: true };
        }

        /* v8 ignore start -- ts-type: result field ?? fallback for optional webhook payload fields @preserve */
        const clarificationMessage =
          planningResult.planning_unclear_clarification ??
          taskErrorForUnclear?.message ??
          'Planning agent reported unclear outcome';
        /* v8 ignore stop @preserve */

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
          removeLabels: ['complex-task', 'code-task', 'planning-task'],
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

        if (executionResult.execution_outcome_label === 'already_completed') {
          if (executionResult.prUrl == null || executionResult.prUrl === '') {
            return {
              ok: false,
              code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
              message: 'already_completed outcome requires a PR URL as evidence',
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

          const summaryText = executionResult.summary ?? 'No details provided';
          const commentResult = await linearAgentClient.addComment({
            userId: task.userId,
            issueId: routedIssueValidation.value.id,
            body: `Work already completed: ${summaryText}`,
          });
          if (!commentResult.ok) {
            return {
              ok: false,
              code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
              message: `Failed to comment already-completed issue: ${commentResult.error.message}`,
            };
          }

          const markDone = await linearAgentClient.updateIssueState({
            userId: task.userId,
            issueId: routedIssueValidation.value.id,
            state: 'done',
          });
          if (!markDone.ok) {
            return {
              ok: false,
              code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
              message: `Failed to move already-completed issue to Done: ${markDone.error.message}`,
            };
          }

          const keepCodeTaskLabel = await linearAgentClient.updateIssueMetadata({
            userId: task.userId,
            issueId: routedIssueValidation.value.id,
            assigneeId: null,
            addLabels: ['code-task'],
            removeLabels: ['unclear', 'planning-task'],
          });
          if (!keepCodeTaskLabel.ok) {
            return {
              ok: false,
              code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
              message: `Failed to preserve code-task label on already-completed issue: ${keepCodeTaskLabel.error.message}`,
            };
          }

          return { ok: true };
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
          removeLabels: ['unclear', 'planning-task'],
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

      const enforceReviewOutcome = (
        reviewResult: NonNullable<typeof result>
      ): { ok: true } | { ok: false; message: string; code: string } => {
        if (reviewResult.review_comments_posted === undefined) {
          return {
            ok: false,
            code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
            message: 'Review enforcement requires result.review_comments_posted',
          };
        }

        if (!/^\d+$/.test(reviewResult.review_comments_posted)) {
          return {
            ok: false,
            code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
            message: 'Review enforcement requires result.review_comments_posted to be a non-negative integer string',
          };
        }

        const trimmedReviewTypes = reviewResult.review_types?.trim();
        if (trimmedReviewTypes === undefined || trimmedReviewTypes === '') {
          return {
            ok: false,
            code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
            message: 'Review enforcement requires result.review_types',
          };
        }

        return { ok: true };
      };

      // Helper: clean up PR task lock for PR-originated tasks reaching terminal state.
      // Only the original lock-owning task (parentTaskId === undefined) should delete the lock.
      // Follow-up tasks copy prNumber but don't own the lock — deleting here could remove
      // a lock that belongs to a different in-flight PR-comment task.
      const cleanupLockIfPR = async (): Promise<void> => {
        if (task.prNumber !== undefined && task.parentTaskId === undefined) {
          await deletePRTaskLock(firestore, task.repository, task.prNumber, request.log);
        }
      };

      const triggerDrainForPR = async (): Promise<void> => {
        if (task.prNumber === undefined) return;
        logger.info({ taskId, prNumber: task.prNumber }, 'Triggering post-completion drain for same-PR queued tasks');
        try {
          const services = getServices();
          await drainTaskQueue({
            logger,
            codeTaskRepo: services.codeTaskRepo,
            taskDispatcher: services.taskDispatcher,
            linearAgentClient: services.linearAgentClient,
            whatsappNotifier: services.whatsappNotifier,
            workerSettingsRepo: services.workerSettingsRepo,
            taskEnqueueService: services.taskEnqueueService,
            orchestratorSecret: loadConfig().orchestratorSecret,
            executionMemory: {
              /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
              ...(services.executionMemoryQueryClient !== undefined && {
                queryClient: services.executionMemoryQueryClient,
              }),
              ...(services.executionMemoryEmbeddingClient !== undefined && {
                embeddingClient: services.executionMemoryEmbeddingClient,
              }),
              ...(services.executionMemoryRepo !== undefined && {
                executionMemoryRepo: services.executionMemoryRepo,
              }),
              ...(services.executionMemoryApplicationRepo !== undefined && {
                executionMemoryApplicationRepo: services.executionMemoryApplicationRepo,
              }),
              /* v8 ignore stop @preserve */
            },
          });
        } catch (drainErr) {
          logger.warn({ taskId, prNumber: task.prNumber, error: drainErr }, 'Post-completion drain failed (non-blocking)');
        }
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
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Execution completion missing result payload',
              errorCode: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            });

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
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: executionEnforcement.message,
              errorCode: executionEnforcement.code,
            });

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
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Pull request completion missing result payload',
              errorCode: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            });

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
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: pullRequestEnforcement.message,
              errorCode: pullRequestEnforcement.code,
            });

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
            await cleanupLockIfPR();
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
              await cleanupLockIfPR();
              // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
              return await reply.send({ received: true });
            }
          }
        }

        if (task.agentType === 'review') {
          if (result === undefined) {
            request.log.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Review completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
                message: 'Review completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Review completion missing result payload',
              errorCode: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }

          const reviewEnforcement = enforceReviewOutcome(result);
          if (!reviewEnforcement.ok) {
            request.log.error(
              {
                taskId,
                routedIssueId: task.linearIssueId,
                reviewCommentsPosted: result.review_comments_posted,
                reviewTypes: result.review_types,
                errorCode: reviewEnforcement.code,
                error: reviewEnforcement.message,
              },
              'Review deterministic enforcement failed'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: reviewEnforcement.code,
                message: reviewEnforcement.message,
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return reply.fail('INTERNAL_ERROR', failResult.error.message);
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: reviewEnforcement.message,
              errorCode: reviewEnforcement.code,
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }
        }

        // Extract PR number from prUrl for findByPR correlation (INT-465).
        let prNumber: number | undefined;
        if (result?.prUrl) {
          const match = /\/pull\/(\d+)/.exec(result.prUrl);
          if (match?.[1] !== undefined) {
            prNumber = Number(match[1]);
          }
        }
        if (prNumber === undefined && task.prNumber !== undefined) {
          prNumber = task.prNumber;
        }

        const resolvedStatus =
          task.agentType === 'planning' ? 'planned' :
          task.agentType === 'review' ? 'reviewed' : 'implemented';
        const executionMemoryPostRun = shouldQueueExecutionMemoryPostRun({
          agentType: task.agentType,
          existingStatus: task.executionMemoryPostRun?.status,
        })
          ? {
              status: 'pending' as const,
              attempts: 0,
              generatedMemoryIds: [],
            }
          : undefined;
        const remediationRequiresReReview =
          task.agentType === 'remediation' && result?.requires_re_review !== undefined
            ? result.requires_re_review === '1'
            : undefined;
        const updateResult = await codeTaskRepo.update(taskId, {
          status: resolvedStatus,
          completedAt,
          ...(result !== undefined && {
            result: request.body.resumedCompletion === true && task.result !== undefined
              ? { ...task.result, ...result }
              : result,
          }),
          error: null,
          ...(prNumber !== undefined && { prNumber }),
          ...(result?.branch !== undefined && { prBranch: result.branch }),
          ...(executionMemoryPostRun !== undefined && { executionMemoryPostRun }),
          ...(remediationRequiresReReview !== undefined && {
              requiresReReview: remediationRequiresReReview,
            }),
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as completed');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }
        await cleanupLockIfPR();

        // Best-effort: update PR summary when review completes
        if (resolvedStatus === 'reviewed' && prNumber !== undefined) {
          try {
            const tokenResult = await userServiceClient.getOAuthToken(task.userId, 'github');
            if (tokenResult.ok) {
              const parsed = parseOwnerRepo(task.repository);
              /* v8 ignore start -- ts-type: parseOwnerRepo cannot return null for valid task.repository (always owner/repo format) @preserve */
              if (parsed !== null) {
              /* v8 ignore stop @preserve */
                const detailsResult = await gitHubPRClient.getPullRequestDetails(tokenResult.value.accessToken, parsed.owner, parsed.repo, prNumber);
                if (detailsResult.ok) {
                  await gitHubPRSummaryRepo.upsert({
                    repository: task.repository,
                    pullRequestNumber: prNumber,
                    lastActivityAt: new Date(),
                    lastReviewedCommitSha: detailsResult.value.headSha,
                    lastReviewNeedsRemediation: result?.needs_remediation ?? null,
                  });
                  request.log.info({ taskId, prNumber, headSha: detailsResult.value.headSha }, 'Updated lastReviewedCommitSha on PR summary');
                }
              }
            }
          } catch (reviewShaError: unknown) {
            request.log.warn({ error: reviewShaError, taskId, prNumber }, 'Failed to update lastReviewedCommitSha (best-effort)');
          }
        }

        // Best-effort: create remediation task when review finds actionable issues
        if (task.agentType === 'review' && prNumber !== undefined && result !== undefined) {
          try {
            const remediationSignal: '0' | '1' | 'missing' =
              result.needs_remediation === '0' || result.needs_remediation === '1'
                ? result.needs_remediation
                : 'missing';
            if (result.needs_remediation === '0') {
              recordRemediationDecision({
                repository: task.repository,
                prNumber,
                userId: task.userId,
                required: false,
                signal: remediationSignal,
              });

              // Best-effort: set review-outcome label on the associated Linear issue
              // Skip if PR is already merged — handlePrClose already cleaned up labels.
              let prAlreadyMerged = false;
              try {
                const prMergeSummary = await gitHubPRSummaryRepo.findByPullRequest(task.repository, prNumber);
                prAlreadyMerged = prMergeSummary.ok && prMergeSummary.value !== null && prMergeSummary.value.mergedAt !== null;
              } catch {
                // gitHubPRSummaryRepo may not be fully initialized — assume not merged
              }

              // Fallback: if summary says not-merged, check GitHub API directly.
              // The summary is updated by a webhook that may arrive after this callback.
              if (!prAlreadyMerged) {
                try {
                  const tokenResult = await userServiceClient.getOAuthToken(task.userId, 'github');
                  if (tokenResult.ok) {
                    const parsed = parseOwnerRepo(task.repository);
                    if (parsed !== null) {
                      const prStatus = await gitHubPRClient.getPullRequestStatus(tokenResult.value.accessToken, parsed.owner, parsed.repo, prNumber);
                      if (prStatus.ok && prStatus.value.mergedAt !== null) {
                        prAlreadyMerged = true;
                        request.log.info({ taskId, prNumber },
                          'prAlreadyMerged detected via GitHub API fallback (summary was stale)');
                      }
                    }
                  }
                } catch {
                  // GitHub API unavailable — proceed with summary-based decision
                }
              }

              if (prAlreadyMerged) {
                request.log.debug({ taskId, prNumber }, 'Skipping review-outcome label — PR already merged');
              } else {
              try {
                const originResult = await codeTaskRepo.findOriginTaskByPR(task.repository, prNumber);
                let targetLinearIssueId: string | undefined;
                let targetUserId: string | undefined;
                let label: string | undefined;
                let source: string | undefined;

                if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
                  if (originResult.value.agentType === 'planning') {
                    // Plan-phase reviews do not auto-advance to execution.
                    // The user must explicitly trigger execution from the UI.
                    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
                      'Plan review passed — skipping ready-to-implement label (user must explicitly trigger execution)');
                  } else {
                    targetLinearIssueId = originResult.value.linearIssueId;
                    targetUserId = originResult.value.userId;
                    label = 'ready-to-merge';
                    source = 'origin';
                  }
                } else {
                  // Fallback: use review task's own issue (common for external PRs)
                  targetLinearIssueId = task.linearIssueId;
                  targetUserId = task.userId;
                  label = 'ready-to-merge';
                  source = 'review-fallback';

                  if (!originResult.ok) {
                    request.log.warn({ taskId, prNumber, error: originResult.error },
                      'Origin task lookup failed, falling back to review task issue');
                  } else {
                    request.log.info({ taskId, prNumber,
                      originFound: originResult.value !== null,
                      originHasLinearId: originResult.value?.linearIssueId !== undefined },
                      'No origin task with linearIssueId, falling back to review task issue');
                  }
                }

                if (targetLinearIssueId === undefined) {
                  request.log.warn({ taskId, prNumber },
                    'No Linear issue available for review-outcome label — skipping');
                } else {
                  const issueValidation = await linearAgentClient.validateIssue({
                    userId: targetUserId!,
                    identifier: targetLinearIssueId,
                  });
                  if (issueValidation.ok) {
                    const labelResult = await linearAgentClient.updateIssueMetadata({
                      userId: targetUserId!,
                      issueId: issueValidation.value.id,
                      addLabels: [label!],
                    });
                    if (labelResult.ok) {
                      if (labelResult.value.droppedLabels.length > 0) {
                        request.log.warn({ taskId, prNumber, droppedLabels: labelResult.value.droppedLabels, linearIssueId: targetLinearIssueId },
                          'Review-outcome label not found in Linear team — label not applied');
                      } else {
                        request.log.info({ taskId, prNumber, label, linearIssueId: targetLinearIssueId, source },
                          'Set review-outcome label');

                        // Best-effort: recompute group summary with the new label so
                        // cached aggregateStatus reflects the actionable state.
                        const { groupSummaryRepo: summaryRepoForLabel } = getServices();
                        if (summaryRepoForLabel !== undefined && targetLinearIssueId !== undefined) {
                          const updatedLabels: { id: string; name: string }[] = [
                            ...issueValidation.value.labels.map((l) => ({ id: '', name: l })),
                            { id: '', name: label! },
                          ];
                          void summaryRepoForLabel.recomputeWithLabels(
                            targetUserId!, targetLinearIssueId, updatedLabels, completedAt.toISOString(),
                          ).catch((recomputeErr: unknown) => {
                            request.log.warn({ linearIssueId: targetLinearIssueId, error: recomputeErr },
                              'Failed to recompute group summary after review-outcome label (best-effort)');
                          });
                        }
                      }
                    } else {
                      request.log.warn({ taskId, prNumber, label, error: labelResult.error },
                        'Failed to set review-outcome label (best-effort)');
                    }
                  } else {
                    request.log.warn({ taskId, prNumber, linearIssueId: targetLinearIssueId, error: issueValidation.error },
                      'Failed to validate issue for review-outcome label (best-effort)');
                  }
                }
              } catch (labelError: unknown) {
                request.log.warn({ error: labelError, taskId, prNumber }, 'Failed to set review-outcome label (best-effort)');
              }
              }
            } else {
              // Best-effort: remove stale review-outcome label from the associated Linear issue.
              // A prior passing review may have set ready-to-merge / ready-to-implement;
              // now that remediation is needed, clear it so the UI no longer shows merge-ready.
              try {
                const originResult = await codeTaskRepo.findOriginTaskByPR(task.repository, prNumber);
                let targetLinearIssueId: string | undefined; // @allow-undefined-type -- let binding requires union, not optional property
                let targetUserId: string;
                let labelToRemove: string;

                if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
                  targetLinearIssueId = originResult.value.linearIssueId;
                  targetUserId = originResult.value.userId;
                  labelToRemove = originResult.value.agentType === 'planning' ? 'ready-to-implement' : 'ready-to-merge';
                } else {
                  targetLinearIssueId = task.linearIssueId;
                  targetUserId = task.userId;
                  labelToRemove = 'ready-to-merge';
                }

                if (targetLinearIssueId !== undefined) {
                  await linearIssueService.removeLabel(targetUserId, targetLinearIssueId, labelToRemove);
                  request.log.info({ taskId, prNumber, label: labelToRemove, linearIssueId: targetLinearIssueId },
                    'Removed stale review-outcome label after negative review');

                  // Passing [] clears all label flags in the summary (same pattern as handlePrClose).
                  // Safe because latestReviewNeedsRemediation is already true, which independently
                  // blocks the merge-readiness check in deriveAggregateStatusFromSummary.
                  const { groupSummaryRepo: summaryRepoForRemoval } = getServices();
                  if (summaryRepoForRemoval !== undefined) {
                    void summaryRepoForRemoval.recomputeWithLabels(
                      targetUserId, targetLinearIssueId, [], completedAt.toISOString(),
                    ).catch((recomputeErr: unknown) => {
                      request.log.warn({ linearIssueId: targetLinearIssueId, error: recomputeErr },
                        'Failed to recompute group summary after label removal (best-effort)');
                    });
                  }
                }
              } catch (labelRemovalError: unknown) {
                request.log.warn({ error: labelRemovalError, taskId, prNumber },
                  'Failed to remove stale review-outcome label (best-effort)');
              }

              const { createRemediationTaskFn, logger: remediationLogger } = getServices();
              if (createRemediationTaskFn !== undefined) {
                const remediationResult = await createRemediationTaskFn(
                  remediationLogger,
                  {
                    repository: task.repository,
                    prNumber,
                    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard, repository always contains '/' @preserve */
                    senderLogin: task.repository.split('/')[0] ?? task.userId,
                    /* v8 ignore stop @preserve */
                    workerType: 'auto',
                    eventId: taskId,
                    ...(task.baseBranch !== undefined && { baseBranch: task.baseBranch }),
                    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
                    ...(task.prBranch !== undefined && { prBranch: task.prBranch }),
                  },
                );
                if (remediationResult.ok) {
                  request.log.info(
                    { taskId, prNumber, remediationTaskId: remediationResult.value.taskId },
                    'Created remediation task from review task-complete',
                  );
                  recordRemediationDecision({
                    repository: task.repository,
                    prNumber,
                    userId: task.userId,
                    required: true,
                    signal: remediationSignal,
                    taskId: remediationResult.value.taskId,
                  });
                } else {
                  request.log.warn(
                    { taskId, prNumber, error: remediationResult.error },
                    'Failed to create remediation task from review task-complete (best-effort)',
                  );
                  recordRemediationDecision({
                    repository: task.repository,
                    prNumber,
                    userId: task.userId,
                    required: true,
                    signal: remediationSignal,
                  });
                }
              } else {
                request.log.warn({ taskId, prNumber }, 'createRemediationTaskFn not configured, skipping remediation creation');
                recordRemediationDecision({
                  repository: task.repository,
                  prNumber,
                  userId: task.userId,
                  required: true,
                  signal: remediationSignal,
                });
              }
            }
          } catch (remediationError: unknown) {
            request.log.warn({ error: remediationError, taskId, prNumber }, 'Unexpected error during remediation task creation (best-effort)');
            recordRemediationDecision({
              repository: task.repository,
              prNumber,
              userId: task.userId,
              required: true,
              signal:
                result.needs_remediation === '0' || result.needs_remediation === '1'
                  ? result.needs_remediation
                  : 'missing',
            });
          }
        }

        // Best-effort In Review transition for agent types without deterministic enforcement
        // (planning, execution, and pull_request agents handle this in their own enforcement paths)
        if (task.agentType !== 'execution' && task.agentType !== 'pull_request' && task.agentType !== 'planning' && task.agentType !== 'remediation' && prNumber !== undefined && task.linearIssueId !== undefined) {
          await linearIssueService.markInReview(task.userId, task.linearIssueId);
        }

        await statusMirrorService.mirrorStatus({
          actionId: task.actionId,
          taskStatus: resolvedStatus,
          ...(result?.prUrl !== undefined && { resourceUrl: result.prUrl }),
          traceId,
        });

        // Send WhatsApp notification (use updated task with result populated)
        const completedTask = { ...task, status: resolvedStatus, ...(result !== undefined && { result }) } as typeof task;

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

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });
        metricsClient.incrementTasksCompleted(task.workerType, resolvedStatus).catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        // Verify result was stored
        const verifyResult = await codeTaskRepo.findById(taskId);
        logger.info(
          {
            taskId,
            resultKeys: result ? Object.keys(result) : [],
            prUrl: result?.prUrl,
            branch: result?.branch,
            storedHasResult: verifyResult.ok && verifyResult.value.result !== undefined,
            storedResultKeys: verifyResult.ok && verifyResult.value.result ? Object.keys(verifyResult.value.result) : [],
          },
          'Task marked as completed'
        );
        await flushPendingTaskLogLines(taskId);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

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
            await cleanupLockIfPR();
            await flushPendingTaskLogLines(taskId);
            await triggerDrainForPR();
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
          ...(shouldQueueExecutionMemoryPostRun({
            agentType: task.agentType,
            existingStatus: task.executionMemoryPostRun?.status,
          })
            /* v8 ignore start -- source-map: multiline ternary is misattributed despite execution and planning webhook tests covering both branches @preserve */
            ? {
                executionMemoryPostRun: {
                  status: 'pending' as const,
                  attempts: 0,
                  generatedMemoryIds: [],
                },
              }
            : {}),
          /* v8 ignore stop @preserve */
          callbackReceived: true,
        });

        if (!updateResult.ok) {
          request.log.error({ taskId, error: updateResult.error }, 'Failed to update task as failed');
          return reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }
        await cleanupLockIfPR();

        await statusMirrorService.mirrorStatus({
          actionId: task.actionId,
          taskStatus: 'failed',
          errorMessage: taskError.message,
          traceId,
        });

        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          taskError
        );

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });
        metricsClient.incrementTasksCompleted(task.workerType, 'failed').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info({ taskId, error: taskError }, 'Task marked as failed');
        await flushPendingTaskLogLines(taskId);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

      if (status === 'interrupted') {
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
        await cleanupLockIfPR();

        await statusMirrorService.mirrorStatus({
          actionId: task.actionId,
          taskStatus: 'interrupted',
          errorMessage: 'Worker was interrupted during task execution',
          traceId,
        });

        // Send WhatsApp notification for interrupted task
        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          {
            code: 'worker_interrupted',
            message: 'Worker was interrupted during task execution',
          }
        );

        rateLimitService.recordTaskComplete(task.userId).catch((err) => {
          request.log.error({ taskId, userId: task.userId, error: err }, 'Failed to record task completion for rate limiting');
        });
        metricsClient.incrementTasksCompleted(task.workerType, 'interrupted').catch((err) => {
          request.log.warn({ taskId, error: err }, 'Failed to record task completion metric');
        });
        if (request.body.duration) {
          metricsClient.recordTaskDuration(task.workerType, request.body.duration).catch((err) => {
            request.log.warn({ taskId, error: err }, 'Failed to record task duration metric');
          });
        }

        request.log.info({ taskId }, 'Task marked as interrupted');
        await flushPendingTaskLogLines(taskId);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return await reply.send({ received: true });
      }

      /* v8 ignore start -- schema: webhook status enum is exhaustive — cancelled is the last branch, false path unreachable @preserve */
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
        await cleanupLockIfPR();

        await statusMirrorService.mirrorStatus({
          actionId: task.actionId,
          taskStatus: 'cancelled',
          traceId,
        });

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
        await flushPendingTaskLogLines(taskId);
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
        getWebhookSecret: async (taskId) => {
          const services = getServices();
          const taskResult = await services.codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
            return null;
          }
          /* v8 ignore start -- test-infra: FakeFirestore task fixtures always include webhookSecret so null path unreachable @preserve */
          return taskResult.value.webhookSecret ?? null;
          /* v8 ignore stop @preserve */
        },
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
      let formatterEntry = taskFormatterStates.get(taskId);
      /* v8 ignore start -- test-infra: FakeFirestore cannot simulate stateful multi-request log delivery with dispatched task @preserve */
      if (formatterEntry === undefined) {
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
        if (taskResult.ok) {
          const resolvedFormatterEntry: TaskFormatterEntry = {
            runtime: resolveLogRuntime(taskResult.value.workerType),
            state: createFormatterState(),
            lastSequence: 0,
          };
          formatterEntry = resolvedFormatterEntry;
          taskFormatterStates.set(taskId, resolvedFormatterEntry);
        }
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

      const formatter = formatterEntry ?? {
        runtime: 'claude' as const,
        state: createFormatterState(),
        lastSequence: chunks[chunks.length - 1]?.sequence ?? 0,
      };
      const allLines = chunks.flatMap((chunk) => {
        const chunkTimestamp = Timestamp.fromDate(new Date(chunk.timestamp));
        return formatLogChunkForRuntime(formatter.runtime, chunk.content, chunk.sequence, chunkTimestamp, formatter.state);
      });
      formatter.lastSequence = chunks[chunks.length - 1]?.sequence ?? formatter.lastSequence;
      if (formatterEntry !== undefined) {
        taskFormatterStates.set(taskId, formatter);
      }

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
