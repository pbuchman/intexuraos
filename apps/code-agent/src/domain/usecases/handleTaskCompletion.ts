/**
 * Use case: Handle task-complete callback from the orchestrator.
 *
 * This use case consolidates the domain logic previously inline in the
 * `POST /internal/webhooks/task-complete` Fastify handler:
 *
 *   - Task completion state transitions (completed/failed/interrupted/cancelled)
 *   - Deterministic per-agent enforcement (execution, pull_request, planning,
 *     review, remediation)
 *   - Execution-memory post-run queueing decisions
 *   - Remediation decision + automation log recording
 *   - Task failure automation logging
 *   - WhatsApp notifications and metrics emission
 *   - PR task lock cleanup + post-completion drain triggering
 *   - Log-line flushing on terminal transitions
 *
 * Route handlers call this function after internal auth + HMAC signature
 * validation succeed. The return shape drives the Fastify reply.
 */
/*
 * Targeted ESLint suppressions for verbatim extraction from webhookRoutes.ts.
 *
 * The code inside this file is an as-is lift of the 1,700-line task-complete
 * handler, preserved unchanged for safety (see INT-1431 PR description). The
 * rules below are disabled at file-level only for patterns that are pervasive
 * in the verbatim extraction:
 *
 *   - `strict-boolean-expressions` / `no-unnecessary-condition`: the original
 *     handler used truthy checks on webhook payload strings/numbers that are
 *     typed as `string | undefined` via the `result` record.
 *   - `no-non-null-assertion`: a few places guard-set `let` variables and then
 *     assert via `!` inside inner branches the guard proved non-null.
 *   - `use-unknown-in-catch-callback-variable` / `no-unsafe-assignment`:
 *     catch callbacks use `any` (returned by `.catch((err) => …)`).
 *   - `prefer-optional-chain`: some nested null checks are written as
 *     `a.ok && a.value !== null && a.value.field !== undefined`.
 *   - `consistent-type-definitions`: TaskCompleteWebhookBody is a type alias
 *     (matches the original verbatim shape).
 *   - `eqeqeq`: one `==` comparison in a boolean coercion pattern.
 *
 * Follow-up (tracked in INT-1431 comments): fix individual occurrences and
 * remove each rule from the list below. Do NOT reintroduce a blanket disable.
 */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/use-unknown-in-catch-callback-variable */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/prefer-optional-chain */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
/* eslint-disable eqeqeq */
import type { Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';
import { parseLinearIdentifierFromUrl } from '../utils/linearIdentifierParser.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import { drainTaskQueue } from './drainTaskQueue.js';
import { triageFailedTask } from './triageFailedTask.js';
import { deletePRTaskLock } from '../utils/prTaskLock.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';
import { resolveCompletedTaskStatus } from '../utils/resolveCompletedTaskStatus.js';
import { validatePrUrl } from '../utils/validatePrUrl.js';
import {
  flushPendingTaskLogLines,
  recordRemediationDecision,
  recordTaskFailed,
  shouldQueueExecutionMemoryPostRun,
  type TaskFormatterEntry,
} from '../services/webhookHelpers.js';

export type TaskCompleteWebhookBody = {
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
    sentry_issue_url?: string;
    sentry_linear_issue?: string;
    sentry_outcome?: 'fixed' | 'suppressed';
    sentry_verification?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      action?: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
  duration?: number;
  resumedCompletion?: boolean;
};

export type HandleTaskCompletionResult =
  | { kind: 'received' }
  | { kind: 'fail'; code: string; message: string };

export interface HandleTaskCompletionInput {
  body: TaskCompleteWebhookBody;
  requestLog: Logger;
  traceId: string;
  taskFormatterStates: Map<string, TaskFormatterEntry>;
}

/**
 * Process a task-complete webhook payload. Caller is expected to have
 * validated internal auth + HMAC signature before invoking.
 */
export async function handleTaskCompletion(
  logger: Logger,
  input: HandleTaskCompletionInput,
): Promise<HandleTaskCompletionResult> {
  const { body, requestLog, traceId, taskFormatterStates } = input;
      const {
        codeTaskRepo,
        whatsappNotifier,
        metricsClient,
        linearIssueService,
        linearAgentClient,
        firestore,
        gitHubPRSummaryRepo,
        gitHubPRClient,
        userServiceClient,
      } = getServices();
      const { taskId, status, result, error } = body;

      logger.info(
        {
          taskId,
          status,
          traceId,
          hasResult: result !== undefined,
          resultKeys: result ? Object.keys(result) : [],
          resultBranch: result?.branch,
          resultPrUrl: result?.prUrl,
          bodyKeys: Object.keys(body),
        },
        'Processing task-complete webhook'
      );

      // Get task details first so downstream notifications can use persisted context.
      const taskResult = await codeTaskRepo.findById(taskId);
      if (!taskResult.ok) {
        requestLog.error({ taskId, error: taskResult.error }, 'Task not found');
        return { kind: 'fail' as const, code: 'NOT_FOUND', message: 'Task not found' };
      }

      const task = taskResult.value;
      const completedAt = new Date();

      // Set `ready-to-merge` on the Linear issue associated with a PR.
      // Shared between two callbacks that produce the same outcome:
      //   1. review completed with `needs_remediation='0'`
      //   2. remediation completed with `requires_re_review='0'` and
      //      `execution_outcome_label='already_completed'` (no new commits pushed)
      // Guarded by a PR-already-merged check (summary + GitHub API fallback) and
      // a planning-origin guard that auto-merges the plan PR instead of labeling.
      const applyReadyToMergeLabel = async (prNumber: number): Promise<void> => {
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
              /* v8 ignore start -- ts-type: task creation helpers always defined with valid owner/repo strings; no fake mechanism can inject a malformed repository field post-task-creation @preserve */
              if (parsed !== null) {
              /* v8 ignore stop @preserve */
                const prStatus = await gitHubPRClient.getPullRequestStatus(tokenResult.value.accessToken, parsed.owner, parsed.repo, prNumber);
                if (prStatus.ok && prStatus.value.mergedAt !== null) {
                  prAlreadyMerged = true;
                  requestLog.info({ taskId, prNumber },
                    'prAlreadyMerged detected via GitHub API fallback (summary was stale)');
                }
              }
            }
          } catch {
            // GitHub API unavailable — proceed with summary-based decision
          }
        }

        if (prAlreadyMerged) {
          requestLog.debug({ taskId, prNumber }, 'Skipping review-outcome label — PR already merged');
          return;
        }

        try {
          const originResult = await codeTaskRepo.findOriginTaskByPR(task.repository, prNumber);
          let targetLinearIssueId: string | undefined;
          let targetUserId: string | undefined;
          let label: string | undefined;
          let source: string | undefined;

          if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
            if (originResult.value.agentType === 'planning') {
              // Plan-phase reviews do not auto-advance to execution and do NOT auto-merge the plan PR.
              // The user must explicitly click "Code" in the dashboard; `submitToExecutionAgent` then
              // merges the plan PR as part of the execution kickoff. Keeping the plan PR open after
              // review pass lets the user add follow-up comments on the plan before execution starts.
              // Reversal of INT-1282, per INT-1424 (docs/plans/INT-1424-no-auto-merge-plan-pr-on-review-pass.md).
              requestLog.info(
                { taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
                'Plan review passed — plan PR left open; user must explicitly trigger execution',
              );
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
              requestLog.warn({ taskId, prNumber, error: originResult.error },
                'Origin task lookup failed, falling back to review task issue');
            } else {
              requestLog.info({ taskId, prNumber,
                originFound: originResult.value !== null,
                originHasLinearId: originResult.value?.linearIssueId !== undefined },
                'No origin task with linearIssueId, falling back to review task issue');
            }
          }

          if (targetLinearIssueId === undefined) {
            requestLog.warn({ taskId, prNumber, [SKIP_SENTRY_KEY]: true },
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
                  requestLog.warn({ taskId, prNumber, droppedLabels: labelResult.value.droppedLabels, linearIssueId: targetLinearIssueId },
                    'Review-outcome label not found in Linear team — label not applied');
                } else {
                  requestLog.info({ taskId, prNumber, label, linearIssueId: targetLinearIssueId, source },
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
                      requestLog.warn({ linearIssueId: targetLinearIssueId, error: recomputeErr },
                        'Failed to recompute group summary after review-outcome label (best-effort)');
                    });
                  }
                }
              } else {
                requestLog.warn({ taskId, prNumber, label, error: labelResult.error },
                  'Failed to set review-outcome label (best-effort)');
              }
            } else {
              requestLog.warn({ taskId, prNumber, linearIssueId: targetLinearIssueId, error: issueValidation.error },
                'Failed to validate issue for review-outcome label (best-effort)');
            }
          }
        } catch (labelError: unknown) {
          requestLog.warn({ error: labelError, taskId, prNumber }, 'Failed to set review-outcome label (best-effort)');
        }
      };

      // Step 2.5: Ignore stale callbacks for already-cancelled tasks
      if (task.status === 'cancelled') {
        if (status !== 'cancelled') {
          requestLog.info({ taskId, incomingStatus: status }, 'Ignoring stale callback for cancelled task');
        } else {
          requestLog.info({ taskId }, 'Ignoring duplicate cancelled callback');
        }
        // @allow-raw-send: external webhook callback contract requires simple acknowledgment
        return { kind: 'received' as const };
      }

      const enforcePlanningOutcome = async (
        outcome: 'planned' | 'unclear',
        planningResult: NonNullable<typeof result>,
        taskErrorForUnclear?: { code: string; message: string }
      ): Promise<{ ok: true } | { ok: false; message: string }> => {
        if (task.linearIssueId === undefined) {
          return { ok: false, message: 'Planning enforcement requires original linearIssueId' };
        }

        if (outcome === 'planned') {
          const prUrl = planningResult.planning_pr_url ?? planningResult.prUrl;
          if (!prUrl) {
            return {
              ok: false,
              message: 'Planning enforcement requires a PR URL for planned outcomes — all planned tasks must produce an evidence PR',
            };
          }
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
            /* v8 ignore start -- ts-type: planning_subtask_urls ?? '' fallback unreachable — webhook payload always sets the field on complex-path success @preserve */
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

              /* v8 ignore start -- ts-type: planning_pr_url ?? '' fallback unreachable in complex-success branch — webhook always sets pr_url after planning PR creation @preserve */
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
              requestLog.warn(
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

              /* v8 ignore start -- ts-type: planning_pr_url ?? '' fallback unreachable in complex-fallback branch (live-fetch path) — webhook always sets pr_url after planning PR creation @preserve */
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

        /* v8 ignore start -- ts-type: planning_unclear_clarification + taskErrorForUnclear?.message ?? string-literal fallback unreachable — unclear-status webhook always carries one of these fields @preserve */
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
      ): Promise<{ ok: true } | { ok: false; message: string; code: string; prUrlValidationErrors?: string[] }> => {
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

        // PR URL validation (INT-1361): verify PR exists, title matches, and recency
        const prNumberFromUrl = /\/pull\/(\d+)/.exec(executionResult.prUrl);
        /* v8 ignore start -- ts-type: prUrl always returns a match for /pull/N after enforcement check at line 658; parseOwnerRepo cannot return null for valid task.repository @preserve */
        if (prNumberFromUrl?.[1] !== undefined) {
          const parsedOwnerRepo = parseOwnerRepo(task.repository);
          if (parsedOwnerRepo !== null) {
          /* v8 ignore stop @preserve */
            const token = await fetchGitHubToken(userServiceClient, task.userId, logger);
            if (token !== null) {
              const validationResult = await validatePrUrl({
                prUrl: executionResult.prUrl,
                prNumber: Number(prNumberFromUrl[1]),
                linearIssueId: task.linearIssueId,
                /* v8 ignore start -- ts-type: conditional spread for optional Timestamp field @preserve */
                ...(task.dispatchedAt !== undefined && { dispatchedAt: task.dispatchedAt.toDate() }),
                /* v8 ignore stop @preserve */
                token,
                owner: parsedOwnerRepo.owner,
                repo: parsedOwnerRepo.repo,
                gitHubPRClient,
                logger,
              });
              if (validationResult.failed) {
                return {
                  ok: false,
                  code: 'EXECUTION_AGENT_PR_URL_VALIDATION_FAILED',
                  message: validationResult.errors.join('; '),
                  prUrlValidationErrors: validationResult.errors,
                };
              }
            } else {
              logger.warn({ taskId, userId: task.userId }, 'PR URL validation skipped: no GitHub token available');
            }
          }
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
        // [INT-1570] Soft-default review_comments_posted when review_id proves a
        // review was actually posted. The orchestrator block-parser silently drops
        // annotated integers (e.g. "0 (no inline comments)") and we must not fail
        // an otherwise-successful review on bookkeeping. If review_id is missing
        // OR present-but-non-numeric, the value is unrecoverable — hard fail.
        const hasReviewId =
          typeof reviewResult.review_id === 'string' && reviewResult.review_id.trim() !== '';
        const rawCount = reviewResult.review_comments_posted;
        const countIsValid = typeof rawCount === 'string' && /^\d+$/.test(rawCount);

        if (!countIsValid) {
          if (hasReviewId) {
            requestLog.warn(
              { taskId, rawReviewCommentsPosted: rawCount, [SKIP_SENTRY_KEY]: true },
              'review_comments_posted missing or non-numeric; defaulting to "0" because review_id is present'
            );
            reviewResult.review_comments_posted = '0';
          } else {
            return {
              ok: false,
              code: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
              message:
                rawCount === undefined
                  ? 'Review enforcement requires result.review_comments_posted'
                  : 'Review enforcement requires result.review_comments_posted to be a non-negative integer string',
            };
          }
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

      const enforceSentryOutcome = (
        sentryResult: NonNullable<typeof result>
      ): { ok: true } | { ok: false; message: string; code: string } => {
        if (task.sentryIssue === undefined) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires task.sentryIssue context',
          };
        }
        if (task.linearIssueId === undefined) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires routed linearIssueId',
          };
        }
        if (!sentryResult.prUrl) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.prUrl',
          };
        }
        if (sentryResult.sentry_outcome !== 'fixed' && sentryResult.sentry_outcome !== 'suppressed') {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.sentry_outcome fixed or suppressed',
          };
        }
        if (!sentryResult.sentry_issue_url) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.sentry_issue_url',
          };
        }
        if (sentryResult.sentry_issue_url !== task.sentryIssue.issueUrl) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.sentry_issue_url to match the task Sentry issue',
          };
        }
        if (!sentryResult.sentry_linear_issue) {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.sentry_linear_issue',
          };
        }
        if (sentryResult.sentry_verification === undefined || sentryResult.sentry_verification.trim() === '') {
          return {
            ok: false,
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.sentry_verification',
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
          await deletePRTaskLock(firestore, task.repository, task.prNumber, requestLog);
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
            logLineRepo: services.logLineRepo,
            taskDispatcher: services.taskDispatcher,
            linearAgentClient: services.linearAgentClient,
            whatsappNotifier: services.whatsappNotifier,
            automationLog: services.automationLog,
            /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production initServices always provides codeTaskDispatchNotificationRepo @preserve */
            ...(services.codeTaskDispatchNotificationRepo !== undefined && {
              codeTaskDispatchNotificationRepo: services.codeTaskDispatchNotificationRepo,
            }),
            /* v8 ignore stop @preserve */
            workerSettingsRepo: services.workerSettingsRepo,
            /* v8 ignore start -- ts-type: optional property conditional spread for exactOptionalPropertyTypes; production initServices always provides codeTaskDispatchStatusService @preserve */
            ...(services.codeTaskDispatchStatusService !== undefined && {
              codeTaskDispatchStatusService: services.codeTaskDispatchStatusService,
            }),
            /* v8 ignore stop @preserve */
            taskEnqueueService: services.taskEnqueueService,
            orchestratorSecret: loadConfig().orchestratorSecret,
            executionMemory: {
              /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
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
            userServiceClient: services.userServiceClient,
          });
        } catch (drainErr) {
          logger.warn({ taskId, prNumber: task.prNumber, error: drainErr }, 'Post-completion drain failed (non-blocking)');
        }
      };

      // Step 3: Update task based on status
      if (status === 'completed') {
        // Trace which agent type is being handled for debugging
        requestLog.info({ taskId, agentType: task.agentType }, 'Processing completed task');
        if (task.agentType === 'execution') {
          if (result === undefined) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Execution completion missing result payload',
              errorCode: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          const executionEnforcement = await enforceExecutionOutcome(result);
          if (!executionEnforcement.ok) {
            requestLog.error(
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
              ...(executionEnforcement.prUrlValidationErrors !== undefined && {
                prUrlValidationFailed: true,
                prUrlValidationErrors: executionEnforcement.prUrlValidationErrors,
              }),
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: executionEnforcement.message,
              errorCode: executionEnforcement.code,
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }
        }

        if (task.agentType === 'pull_request') {
          if (result === undefined) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Pull request completion missing result payload',
              errorCode: 'PULL_REQUEST_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          const pullRequestEnforcement = await enforcePullRequestOutcome(result);
          if (!pullRequestEnforcement.ok) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: pullRequestEnforcement.message,
              errorCode: pullRequestEnforcement.code,
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

        }

        if (task.agentType === 'planning') {
          if (result === undefined) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          if (result.planning_outcome_label === 'planned') {
            const planningEnforcement = await enforcePlanningOutcome('planned', result);
            if (!planningEnforcement.ok) {
              requestLog.error({ taskId, error: planningEnforcement.message }, 'Planning deterministic enforcement failed');
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
                return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
              }
              await cleanupLockIfPR();
              // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
              return { kind: 'received' as const };
            }
          }
        }

        if (task.agentType === 'review') {
          if (result === undefined) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Review completion missing result payload',
              errorCode: 'REVIEW_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          const reviewEnforcement = enforceReviewOutcome(result);
          if (!reviewEnforcement.ok) {
            requestLog.error(
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: reviewEnforcement.message,
              errorCode: reviewEnforcement.code,
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }
        }

        if (task.agentType === 'remediation') {
          if (result === undefined) {
            requestLog.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Remediation completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'REMEDIATION_AGENT_ENFORCEMENT_FAILED',
                message: 'Remediation completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Remediation completion missing result payload',
              errorCode: 'REMEDIATION_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          if (result.execution_outcome_label === 'implemented' && !result.prUrl) {
            requestLog.error(
              { taskId, routedIssueId: task.linearIssueId },
              'Remediation deterministic enforcement failed: no PR URL for implemented outcome'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: 'REMEDIATION_AGENT_ENFORCEMENT_FAILED',
                message: 'Remediation enforcement requires result.prUrl for implemented outcome',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Remediation enforcement requires result.prUrl for implemented outcome',
              errorCode: 'REMEDIATION_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }
        }

        if (task.agentType === 'sentry') {
          if (result === undefined) {
            requestLog.error(
              { taskId, routedIssueId: task.linearIssueId, sentryIssue: task.sentryIssue },
              'Sentry completion missing result payload'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              error: {
                code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
                message: 'Sentry completion missing result payload',
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: 'Sentry completion missing result payload',
              errorCode: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }

          const sentryEnforcement = enforceSentryOutcome(result);
          if (!sentryEnforcement.ok) {
            requestLog.error(
              {
                taskId,
                routedIssueId: task.linearIssueId,
                sentryIssueUrl: task.sentryIssue?.issueUrl,
                prUrl: result.prUrl,
                errorCode: sentryEnforcement.code,
                error: sentryEnforcement.message,
              },
              'Sentry deterministic enforcement failed'
            );
            const failResult = await codeTaskRepo.update(taskId, {
              status: 'failed',
              completedAt,
              result,
              error: {
                code: sentryEnforcement.code,
                message: sentryEnforcement.message,
              },
              callbackReceived: true,
            });
            if (!failResult.ok) {
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();

            recordTaskFailed({
              task, taskId, completedAt,
              error: sentryEnforcement.message,
              errorCode: sentryEnforcement.code,
            });

            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
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

        const resolvedStatus = resolveCompletedTaskStatus(task.agentType);
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
            result: body.resumedCompletion === true && task.result !== undefined
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
          requestLog.error({ taskId, error: updateResult.error }, 'Failed to update task as completed');
          return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: updateResult.error.message };
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
                  requestLog.info({ taskId, prNumber, headSha: detailsResult.value.headSha }, 'Updated lastReviewedCommitSha on PR summary');
                }
              }
            }
          } catch (reviewShaError: unknown) {
            requestLog.warn({ error: reviewShaError, taskId, prNumber }, 'Failed to update lastReviewedCommitSha (best-effort)');
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

              await applyReadyToMergeLabel(prNumber);
            } else {
              if (task.prMergedAt !== undefined || task.prClosedAt !== undefined) {
                requestLog.info(
                  {
                    taskId,
                    prNumber,
                    hasPrMergedAt: task.prMergedAt !== undefined,
                    hasPrClosedAt: task.prClosedAt !== undefined,
                  },
                  'Skipping remediation task creation because PR is already merged or closed',
                );
                recordRemediationDecision({
                  repository: task.repository,
                  prNumber,
                  userId: task.userId,
                  required: true,
                  signal: remediationSignal,
                });
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
                    requestLog.info({ taskId, prNumber, label: labelToRemove, linearIssueId: targetLinearIssueId },
                      'Removed stale review-outcome label after negative review');

                    // Passing [] clears all label flags in the summary (same pattern as handlePrClose).
                    // Safe because latestReviewNeedsRemediation is already true, which independently
                    // blocks the merge-readiness check in deriveAggregateStatusFromSummary.
                    const { groupSummaryRepo: summaryRepoForRemoval } = getServices();
                    if (summaryRepoForRemoval !== undefined) {
                      void summaryRepoForRemoval.recomputeWithLabels(
                        targetUserId, targetLinearIssueId, [], completedAt.toISOString(),
                      ).catch((recomputeErr: unknown) => {
                        requestLog.warn({ linearIssueId: targetLinearIssueId, error: recomputeErr },
                          'Failed to recompute group summary after label removal (best-effort)');
                      });
                    }
                  }
                } catch (labelRemovalError: unknown) {
                  requestLog.warn({ error: labelRemovalError, taskId, prNumber },
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
                    requestLog.info(
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
                    requestLog.warn(
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
                  requestLog.warn({ taskId, prNumber }, 'createRemediationTaskFn not configured, skipping remediation creation');
                  recordRemediationDecision({
                    repository: task.repository,
                    prNumber,
                    userId: task.userId,
                    required: true,
                    signal: remediationSignal,
                  });
                }
              }
            }
          } catch (remediationError: unknown) {
            requestLog.warn({ error: remediationError, taskId, prNumber }, 'Unexpected error during remediation task creation (best-effort)');
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

        // Remediation-complete with "already_completed" outcome: restore ready-to-merge.
        // A prior review (needs_remediation='1') removed the label and queued this
        // remediation. The remediation concluded all findings were already fixed by an
        // earlier run (requires_re_review='0', execution_outcome_label='already_completed').
        // Since no new commits were pushed, the existing review state is still valid —
        // re-apply the label so the UI surfaces the Merge action again.
        //
        // GUARD: execution_outcome_label MUST be 'already_completed'. If the remediation
        // actually pushed commits ('implemented'), a fresh review MUST run and set the
        // label via the normal review-complete path — short-circuiting here would skip
        // review of new code.
        if (
          task.agentType === 'remediation' &&
          prNumber !== undefined &&
          result?.requires_re_review === '0' &&
          result.execution_outcome_label === 'already_completed'
        ) {
          await applyReadyToMergeLabel(prNumber);
        }

        // Best-effort In Review transition for agent types without deterministic enforcement
        // (planning, execution, and pull_request agents handle this in their own enforcement paths)
        if (task.agentType !== 'execution' && task.agentType !== 'pull_request' && task.agentType !== 'planning' && task.agentType !== 'remediation' && prNumber !== undefined && task.linearIssueId !== undefined) {
          await linearIssueService.markInReview(task.userId, task.linearIssueId);
        }

        // Send WhatsApp notification (use updated task with result populated)
        const completedTask = { ...task, status: resolvedStatus, ...(result !== undefined && { result }) } as typeof task;

        // INT-628: If planning agent completed, send notification with button to proceed to execution
        if (task.agentType === 'planning') {
          const notifyResult = await whatsappNotifier.notifyDesignComplete(task.userId, completedTask);
          if (!notifyResult.ok) {
            requestLog.warn(
              { taskId, errorCode: notifyResult.error.code, errorMessage: notifyResult.error.message },
              'Failed to send design-complete notification — user may not receive Phase 2 button'
            );
          }
        } else if (body.resumedCompletion === true) {
          const resumedNotifyResult = await whatsappNotifier.notifyResumedTaskComplete(task.userId, completedTask);
          if (!resumedNotifyResult.ok) {
            requestLog.warn(
              { taskId, errorCode: resumedNotifyResult.error.code, errorMessage: resumedNotifyResult.error.message },
              'Failed to send resumed-task-complete notification'
            );
          }
        } else {
          const completeNotifyResult = await whatsappNotifier.notifyTaskComplete(task.userId, completedTask);
          if (!completeNotifyResult.ok) {
            requestLog.warn(
              { taskId, errorCode: completeNotifyResult.error.code, errorMessage: completeNotifyResult.error.message },
              'Failed to send task-complete notification'
            );
          }
        }

        metricsClient.incrementTasksCompleted(task.workerType, resolvedStatus).catch((err) => {
          requestLog.warn(
            { taskId, [SKIP_SENTRY_KEY]: true, error: err },
            'Failed to record task completion metric'
          );
        });
        if (body.duration) {
          metricsClient.recordTaskDuration(task.workerType, body.duration).catch((err) => {
            requestLog.warn(
              { taskId, [SKIP_SENTRY_KEY]: true, error: err },
              'Failed to record task duration metric'
            );
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
        await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return { kind: 'received' as const };
      }

      if (status === 'failed') {
        const taskError = error ?? { code: 'UNKNOWN_FAILURE', message: 'Task failed without error details' };
        if (taskError.code === 'PLANNING_AGENT_UNCLEAR' && result?.planning_outcome_label === 'unclear') {
          const unclearEnforcement = await enforcePlanningOutcome('unclear', result, taskError);
          if (!unclearEnforcement.ok) {
            requestLog.error({ taskId, error: unclearEnforcement.message }, 'Planning unclear deterministic enforcement failed');
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
              return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: failResult.error.message };
            }
            await cleanupLockIfPR();
            await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
            await triggerDrainForPR();
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }
        }
        const updateResult = await codeTaskRepo.update(taskId, {
          status: 'failed',
          completedAt,
          ...(result !== undefined && { result }),
          error: {
            code: taskError.code,
            message: taskError.message,
            ...(taskError.remediation !== undefined && { remediation: taskError.remediation }),
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
          requestLog.error({ taskId, error: updateResult.error }, 'Failed to update task as failed');
          return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: updateResult.error.message };
        }

        // Auto-retry triage (INT-1375)
        // Skip triage for PLANNING_AGENT_UNCLEAR (already handled above with early return)
        if (taskError.code !== 'PLANNING_AGENT_UNCLEAR') {
          const { logLineRepo, taskEnqueueService } = getServices();
          const triageResult = await triageFailedTask(
            {
              logger: requestLog,
              codeTaskRepo,
              taskEnqueueService,
              whatsappNotifier,
              logLineRepo,
              userServiceClient,
              orchestratorSecret: loadConfig().orchestratorSecret,
            },
            { task, completedAt, taskError }
          );

          if (triageResult.action !== 'permanent_failure') {
            requestLog.info(
              { taskId, action: triageResult.action, retryTaskId: triageResult.retryTaskId },
              'Task auto-retried by failure triage'
            );

            await cleanupLockIfPR();

            metricsClient.incrementTasksCompleted(task.workerType, 'failed').catch((metricsErr) => {
              requestLog.warn(
                { taskId, [SKIP_SENTRY_KEY]: true, error: metricsErr },
                'Failed to record task completion metric'
              );
            });
            if (body.duration) {
              metricsClient.recordTaskDuration(task.workerType, body.duration).catch((metricsErr) => {
                requestLog.warn(
                  { taskId, [SKIP_SENTRY_KEY]: true, error: metricsErr },
                  'Failed to record task duration metric'
                );
              });
            }

            await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
            // Skip immediate drain for retried_after_cooloff — rely on scheduler tick as natural cooloff
            if (triageResult.action !== 'retried_after_cooloff') {
              await triggerDrainForPR();
            }
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return { kind: 'received' as const };
          }
          // Fall through to permanent failure path
          requestLog.info(
            { taskId, reason: triageResult.reason },
            'Failure triage: permanent failure'
          );
        }

        await cleanupLockIfPR();

        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          taskError
        );

        metricsClient.incrementTasksCompleted(task.workerType, 'failed').catch((err) => {
          requestLog.warn(
            { taskId, [SKIP_SENTRY_KEY]: true, error: err },
            'Failed to record task completion metric'
          );
        });
        if (body.duration) {
          metricsClient.recordTaskDuration(task.workerType, body.duration).catch((err) => {
            requestLog.warn(
              { taskId, [SKIP_SENTRY_KEY]: true, error: err },
              'Failed to record task duration metric'
            );
          });
        }

        requestLog.info({ taskId, error: taskError }, 'Task marked as failed');
        await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return { kind: 'received' as const };
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
          requestLog.error({ taskId, error: updateResult.error }, 'Failed to update task as interrupted');
          return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: updateResult.error.message };
        }
        await cleanupLockIfPR();

        // Send WhatsApp notification for interrupted task
        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          {
            code: 'worker_interrupted',
            message: 'Worker was interrupted during task execution',
          }
        );

        metricsClient.incrementTasksCompleted(task.workerType, 'interrupted').catch((err) => {
          requestLog.warn(
            { taskId, [SKIP_SENTRY_KEY]: true, error: err },
            'Failed to record task completion metric'
          );
        });
        if (body.duration) {
          metricsClient.recordTaskDuration(task.workerType, body.duration).catch((err) => {
            requestLog.warn(
              { taskId, [SKIP_SENTRY_KEY]: true, error: err },
              'Failed to record task duration metric'
            );
          });
        }

        requestLog.info({ taskId }, 'Task marked as interrupted');
        await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
        await triggerDrainForPR();
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return { kind: 'received' as const };
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
          requestLog.error({ taskId, error: updateResult.error }, 'Failed to update task as cancelled');
          return { kind: 'fail' as const, code: 'INTERNAL_ERROR', message: updateResult.error.message };
        }
        await cleanupLockIfPR();

        await whatsappNotifier.notifyTaskFailed(
          task.userId,
          task,
          {
            code: 'task_cancelled',
            message: 'Task was cancelled by user',
          }
        );

        metricsClient.incrementTasksCompleted(task.workerType, 'cancelled').catch((err) => {
          requestLog.warn(
            { taskId, [SKIP_SENTRY_KEY]: true, error: err },
            'Failed to record task completion metric'
          );
        });
        if (body.duration) {
          metricsClient.recordTaskDuration(task.workerType, body.duration).catch((err) => {
            requestLog.warn(
              { taskId, [SKIP_SENTRY_KEY]: true, error: err },
              'Failed to record task duration metric'
            );
          });
        }

        requestLog.info({ taskId }, 'Task marked as cancelled');
        await flushPendingTaskLogLines(taskFormatterStates, taskId, logger);
        // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
        return { kind: 'received' as const };
      }

      // Should not reach here, but TypeScript needs it
      return { kind: 'fail' as const, code: 'INVALID_REQUEST', message: 'Unknown task status' };
}
