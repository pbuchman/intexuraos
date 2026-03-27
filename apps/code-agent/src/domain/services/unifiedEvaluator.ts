/**
 * UnifiedEvaluator service.
 *
 * Single entry point for webhook event evaluation:
 * 1. Hard rules (deterministic) → dispatch / skip / needs_triage
 * 2. LLM triage (if needs_triage) → dispatch / skip / request_review
 * 3. Audit trail via EventDecision
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { CreateEventDecisionInput } from '../models/eventDecision.js';
import type { EventDecisionReviewType } from '../models/eventDecision.js';
import type { WebhookRulesService, RuleOutcome } from './gitHubWebhookRules.js';
import { CIFailureRule } from './gitHubWebhookRules.js';
import type { WebhookDispatchService, CIFailureDispatchService } from './gitHubDispatchService.js';
import { resolveLoginForTaskCreation } from './gitHubDispatchService.js';
import type { EventDecisionRepository } from '../repositories/eventDecisionRepository.js';
import type { GitHubAgentEvalResult, GitHubAgentError } from '../usecases/githubAgent.js';
import type {
  CreateReviewTaskRequest,
  CreateReviewTaskError,
  CreateReviewTaskResult,
} from '../usecases/createReviewTask.js';
import { isReviewCommandComment, extractReviewWorkerType } from '../utils/reviewTriage.js';
import type { GitHubEventLogEntryRepository } from '../repositories/gitHubEventLogEntryRepository.js';
import type { AutomationLog } from '../ports/automationLog.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { CodeTask } from '../models/codeTask.js';

export interface UnifiedEvaluatorDeps {
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  ciFailureDispatchService?: CIFailureDispatchService;
  eventDecisionRepo: EventDecisionRepository;
  gitHubEventLogEntryRepo?: GitHubEventLogEntryRepository;
  evaluateEvent?: ((event: GitHubPREvent, correctionContext?: string) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>) | undefined;
  /** Pre-bound review task creator. Logger is injected at call time; all other deps are closed over at wiring. */
  createReviewTask: (logger: Logger, request: CreateReviewTaskRequest) => Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>>;
  automationLog: AutomationLog;
  /** Resolve a GitHub login to a platform userId for OAuth token lookup. */
  resolveTokenUserId?: ((senderLogin: string) => Promise<string | undefined>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  allowedBots: Set<string>;
  /** Code task repository for remediation interception on synchronize events. */
  codeTaskRepo?: CodeTaskRepository | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  /** Best-effort callback to post a GitHub comment when an unauthorized sender is rejected. */
  onUnauthorizedSender?: ((event: GitHubPREvent) => Promise<void>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
}

export interface UnifiedEvaluator {
  evaluate(event: GitHubPREvent, logger: Logger): Promise<void>;
}

export function createUnifiedEvaluator(deps: UnifiedEvaluatorDeps): UnifiedEvaluator {
  const prRef = (event: GitHubPREvent): { repository: string; prNumber: number } => ({ repository: event.repository, prNumber: event.pullRequestNumber });

  // CIFailureRule must be evaluated BEFORE webhookRules.evaluate() because the rule chain
  // returns ALL_RULES_PASSED as the reason, not individual rule reasons. This means
  // the CHECK_SUITE_TASK_BRANCH reason check would never match if we relied on the chain.
  const ciFailureRule = new CIFailureRule();

  /** Best-effort automation log recording. Never throws. */
  const recordLog = (event: GitHubPREvent, automationEvent: Parameters<AutomationLog['record']>[1], userId?: string): void => {
    void deps.automationLog.record(prRef(event), automationEvent, userId).catch((recordErr: unknown) => {
      // Fire-and-forget — automation log failures must not affect webhook processing
      void recordErr;
    });
  };

  /** Resolve senderLogin → platform userId for OAuth token lookup. Best-effort; returns undefined on failure. */
  const resolveUserId = async (event: GitHubPREvent): Promise<string | undefined> => {
    if (deps.resolveTokenUserId === undefined) return undefined;
    try {
      const login = resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots);
      return await deps.resolveTokenUserId(login);
    } catch {
      return undefined;
    }
  };

  return {
    async evaluate(event: GitHubPREvent, logger: Logger): Promise<void> {
      const startTime = Date.now();

      // Special handling for check_suite events: CIFailureRule must be evaluated directly
      // because the webhookRules chain returns ALL_RULES_PASSED as the reason, not individual
      // rule reasons. This means CHECK_SUITE_TASK_BRANCH would never match via the chain.
      if (event.eventType === 'check_suite' && deps.ciFailureDispatchService !== undefined) {
        const ciRuleOutcome = ciFailureRule.evaluate(event);
        logger.info(
          { eventId: event.id, action: ciRuleOutcome.action, reason: ciRuleOutcome.reason },
          'CIFailureRule evaluated for check_suite event'
        );

        if (ciRuleOutcome.action === 'dispatch' && ciRuleOutcome.reason === 'CHECK_SUITE_TASK_BRANCH') {
          const ciResult = await deps.ciFailureDispatchService.dispatchCIFailure({ event, logger });

          if (ciResult.skipped === true) {
            const skipEvent: { type: 'ci_failure_skip'; reason: string; headBranch?: string } = {
              type: 'ci_failure_skip',
              reason: ciResult.skipReason ?? 'unknown',
              ...(event.baseBranch !== null && { headBranch: event.baseBranch }),
            };
            recordLog(event, skipEvent);

            await recordDecision(deps, event, {
              decidedBy: 'hard_rules',
              decision: 'skip',
              reason: `ci_failure_skipped: ${ciResult.skipReason ?? 'unknown'}`,
            }, startTime, logger);
          } else {
            await recordDecision(deps, event, {
              decidedBy: 'hard_rules',
              decision: 'dispatch',
              reason: 'ci_failure_fix_dispatched',
              dispatchSuccess: ciResult.success,
              dispatchAction: 'create_task',
              dispatchParams: ciResult.fixTaskId !== undefined ? { taskId: ciResult.fixTaskId } : undefined,
              ...(ciResult.error !== undefined && { dispatchError: ciResult.error }),
            }, startTime, logger);
          }
          return;
        }

        // For check_suite events that don't match (skip), we still record the decision
        // but don't dispatch via CI failure path
        /* v8 ignore start -- upstream: CIFailureRule only returns dispatch(CHECK_SUITE_TASK_BRANCH) or skip for check_suite events — false branch unreachable @preserve */
        if (ciRuleOutcome.action === 'skip') {
        /* v8 ignore stop @preserve */
          logger.info(
            { eventId: event.id, reason: ciRuleOutcome.reason },
            'CIFailureRule skipped check_suite event'
          );
          // Continue to normal webhook rules evaluation for consistent handling
        }
      }

      // Step 1: Hard rules
      const ruleOutcome = deps.webhookRules.evaluate(event);

      logger.info(
        { eventId: event.id, action: ruleOutcome.action, reason: ruleOutcome.reason },
        'Hard rules evaluated'
      );

      if (ruleOutcome.action === 'dispatch') {
        await dispatchAndRecord(deps, event, ruleOutcome, startTime, logger);
        return;
      }

      if (ruleOutcome.action === 'skip') {
        // Best-effort GitHub comment for unauthorized senders
        if (ruleOutcome.reason === 'SENDER_NOT_WHITELISTED' && deps.onUnauthorizedSender !== undefined) {
          void deps.onUnauthorizedSender(event).catch((commentErr: unknown) => {
            logger.warn({ commentErr, eventId: event.id }, 'Failed to post unauthorized sender comment');
          });
        }

        // Record automation log: hard_rules skip
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'skipped',
          decidedBy: 'hard_rules',
          reason: ruleOutcome.reason,
          ruleName: ruleOutcome.reason,
        }, userId);

        await recordDecision(deps, event, {
          decidedBy: 'hard_rules',
          decision: 'skip',
          reason: ruleOutcome.reason,
        }, startTime, logger);
        return;
      }

      // Step 2: needs_triage → LLM
      if (deps.evaluateEvent === undefined) {
        logger.warn({ eventId: event.id }, 'No LLM configured for triage, using fallback');
        await handleFallback(deps, event, 'no_llm_configured', startTime, logger, recordLog, resolveUserId);
        return;
      }

      let llmResult = await deps.evaluateEvent(event);

      // Retry once for pull_request events with corrective context —
      // includes the failed response so the LLM can learn from its mistake
      if (!llmResult.ok && event.eventType === 'pull_request') {
        const correctionContext = [
          'Your previous attempt produced the following error:',
          `"${llmResult.error.message}"`,
          '',
          'This is unacceptable. You MUST call one of the provided tools (request_review or skip) to make your triage decision.',
          'Empty responses, malformed output, and failing to call a tool are never valid outcomes.',
          'Analyze the PR again and use the correct tool.',
        ].join('\n');

        logger.warn(
          { eventId: event.id, error: llmResult.error },
          'LLM triage failed for pull_request event, retrying with correction context'
        );
        llmResult = await deps.evaluateEvent(event, correctionContext);
      }

      if (!llmResult.ok) {
        logger.warn(
          { eventId: event.id, error: llmResult.error },
          'LLM triage failed'
        );

        // Fail closed for explicit @review commands - do not fallback dispatch
        /* v8 ignore start -- upstream: FakeEventSource always provides body — cannot simulate undefined body on issue_comment @preserve */
        if (event.eventType === 'issue_comment' && isReviewCommandComment(event.body ?? '')) {
          const workerType = extractReviewWorkerType(event.body ?? '');
          /* v8 ignore stop @preserve */

          // Record automation log: triage_failed for @review
          const userId = await resolveUserId(event);
          recordLog(event, {
            type: 'triage_failed',
            error: llmResult.error.message,
            fallbackAction: 'skip',
          }, userId);

          await recordDecision(deps, event, {
            decidedBy: 'github_agent',
            decision: 'skip',
            reason: `review_triage_failed: ${llmResult.error.message}`,
            ...(workerType !== undefined && { dispatchParams: { workerType } }),
          }, startTime, logger);
          return;
        }

        await handleFallback(deps, event, llmResult.error.message, startTime, logger, recordLog, resolveUserId);
        return;
      }

      const { triage, usage, reasoning } = llmResult.value; // @allow-result-access -- narrowed by !llmResult.ok
      const toolCallSummaries = deduplicateToolCalls(usage.toolCalls);

      if (triage.action === 'dispatch') {
        const llmDispatchResult = await deps.dispatchService.dispatch({
          event,
          decision: { action: 'dispatch', reason: 'LLM_DISPATCH' },
          logger,
        });
        if (!llmDispatchResult.success) {
          logger.warn({ eventId: event.id, error: llmDispatchResult.error }, 'Dispatch failed for LLM decision');
        }

        // Record automation log: triage_dispatch (LLM dispatch)
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'triage_dispatch',
          cost: usage.costUsd,
          reasoning,
          toolCalls: toolCallSummaries,
        }, userId);

        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'dispatch',
          reason: `LLM dispatch: ${triage.template}`,
          llmCostUsd: usage.costUsd,
          ...(usage.model !== undefined && { llmModel: usage.model }),
          llmToolCalls: usage.toolCalls,
          llmReasoning: reasoning,
          dispatchSuccess: llmDispatchResult.success,
          ...(llmDispatchResult.error !== undefined && { dispatchError: llmDispatchResult.error }),
        }, startTime, logger);
        return;
      }

      if (triage.action === 'request_review') {
        // Synchronize remediation interception:
        // Before triggering a review for a synchronize event, check if a recent
        // remediation task already determined that no re-review is needed.
        if (event.eventType === 'pull_request' && event.action === 'synchronize' && deps.codeTaskRepo !== undefined) {
          const shouldSkip = await shouldSkipReviewForRemediation(
            deps.codeTaskRepo, event.repository, event.pullRequestNumber, event.id, logger,
          );
          if (shouldSkip) {
            const userId = await resolveUserId(event);
            recordLog(event, {
              type: 'skipped',
              decidedBy: 'llm_triage',
              reason: 'remediation_no_rereview',
              cost: usage.costUsd,
              reasoning,
              toolCalls: toolCallSummaries,
            }, userId);

            await recordDecision(deps, event, {
              decidedBy: 'github_agent',
              decision: 'skip',
              reason: 'remediation_no_rereview: recent remediation task determined no re-review needed',
              llmCostUsd: usage.costUsd,
              ...(usage.model !== undefined && { llmModel: usage.model }),
              llmToolCalls: usage.toolCalls,
              llmReasoning: reasoning,
            }, startTime, logger);
            return;
          }
        }

        const reviewResult = await deps.createReviewTask(
          logger,
          {
            repository: event.repository,
            prNumber: event.pullRequestNumber,
            senderLogin: resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
            reviewTypes: triage.reviewTypes,
            ...(triage.workerType !== undefined && { workerType: triage.workerType }),
            eventId: event.id,
            ...(event.title !== null && { prTitle: event.title }),
            ...(event.eventType === 'pull_request' && event.body !== null && { prBody: event.body }),
            ...(event.eventType === 'issue_comment' && event.body !== null && { reviewComment: event.body }),
            ...(event.baseBranch !== null && { baseBranch: event.baseBranch }),
          },
        );

        if (!reviewResult.ok) {
          logger.error(
            { eventId: event.id, error: reviewResult.error },
            'Failed to create review task'
          );

          // Record automation log: triage_failed for review task creation failure
          const userId = await resolveUserId(event);
          recordLog(event, {
            type: 'triage_failed',
            error: `review_task_failed: ${reviewResult.error.message}`,
            fallbackAction: 'skip',
          }, userId);

          await recordDecision(deps, event, {
            decidedBy: 'github_agent',
            decision: 'skip',
            reason: `review_task_failed: ${reviewResult.error.message}`,
            llmCostUsd: usage.costUsd,
            ...(usage.model !== undefined && { llmModel: usage.model }),
            llmToolCalls: usage.toolCalls,
            llmReasoning: reasoning,
          }, startTime, logger);
          return;
        }

        // Record automation log: triage_dispatch for review
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'triage_dispatch',
          reviewTypes: triage.reviewTypes,
          workerType: reviewResult.value.workerType, // @allow-result-access -- narrowed by !reviewResult.ok above
          cost: usage.costUsd,
          reasoning,
          toolCalls: toolCallSummaries,
        }, userId);

        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'request_review',
          reason: `LLM request_review: ${triage.reviewTypes.join(', ')}`,
          dispatchAction: 'create_review_task',
          dispatchParams: {
            taskId: reviewResult.value.taskId,
            reviewTypes: triage.reviewTypes as EventDecisionReviewType[],
            workerType: reviewResult.value.workerType,
          }, // @allow-result-access -- narrowed by !reviewResult.ok above
          llmCostUsd: usage.costUsd,
          ...(usage.model !== undefined && { llmModel: usage.model }),
          llmToolCalls: usage.toolCalls,
          llmReasoning: reasoning,
        }, startTime, logger);
        return;
      }

      // triage.action === 'skip'

      // Record automation log: llm_triage skip
      const userId = await resolveUserId(event);
      recordLog(event, {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: triage.reason,
        cost: usage.costUsd,
        reasoning,
        toolCalls: toolCallSummaries,
      }, userId);

      await recordDecision(deps, event, {
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: `LLM skip: ${triage.reason}`,
        llmCostUsd: usage.costUsd,
        ...(usage.model !== undefined && { llmModel: usage.model }),
        llmToolCalls: usage.toolCalls,
        llmReasoning: reasoning,
      }, startTime, logger);
    },
  };
}

async function dispatchAndRecord(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  decision: Extract<RuleOutcome, { action: 'dispatch' }>,
  startTime: number,
  logger: Logger,
): Promise<void> {
  const result = await deps.dispatchService.dispatch({ event, decision, logger });
  if (!result.success) {
    logger.warn({ eventId: event.id, error: result.error }, 'Dispatch failed for hard-rule decision');
  }
  await recordDecision(deps, event, {
    decidedBy: 'hard_rules',
    decision: 'dispatch',
    reason: decision.reason,
    dispatchSuccess: result.success,
    ...(result.error !== undefined && { dispatchError: result.error }),
  }, startTime, logger);
}

/**
 * Event-type-aware fallback when LLM is unavailable or fails.
 * - issue_comment → dispatch (don't miss human requests)
 * - pull_request → skip (don't waste review costs)
 */
async function handleFallback(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  reason: string,
  startTime: number,
  logger: Logger,
  recordLog: (event: GitHubPREvent, automationEvent: Parameters<AutomationLog['record']>[1], userId?: string) => void,
  resolveUserId: (event: GitHubPREvent) => Promise<string | undefined>,
): Promise<void> {
  if (event.eventType === 'issue_comment' || event.eventType === 'pull_request_review' || event.eventType === 'pull_request_review_comment') {
    logger.warn({ eventId: event.id }, 'Fallback: dispatching comment event');

    // Record automation log: triage_failed with fallback dispatch
    const userId = await resolveUserId(event);
    recordLog(event, {
      type: 'triage_failed',
      error: reason,
      fallbackAction: 'dispatch',
    }, userId);

    const fallbackResult = await deps.dispatchService.dispatch({
      event,
      decision: { action: 'dispatch', reason: `FALLBACK_DISPATCH: ${reason}` },
      logger,
    });
    if (!fallbackResult.success) {
      logger.warn({ eventId: event.id, error: fallbackResult.error }, 'Dispatch failed for fallback decision');
    }
    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'dispatch',
      reason: `fallback_dispatch: ${reason}`,
      dispatchSuccess: fallbackResult.success,
      ...(fallbackResult.error !== undefined && { dispatchError: fallbackResult.error }),
    }, startTime, logger);
  } else {
    // Record automation log: triage_failed with fallback skip
    const userId = await resolveUserId(event);
    recordLog(event, {
      type: 'triage_failed',
      error: reason,
      fallbackAction: 'skip',
    }, userId);

    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'skip',
      reason: `fallback_skip: ${reason}`,
    }, startTime, logger);
  }
}

async function recordDecision(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  fields: {
    decidedBy: 'hard_rules' | 'github_agent';
    decision: 'dispatch' | 'skip' | 'request_review';
    reason: string;
    dispatchAction?: 'create_task' | 'send_message' | 'create_review_task';
    dispatchParams?: CreateEventDecisionInput['dispatchParams'];
    llmCostUsd?: number;
    llmModel?: string;
    llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
    llmReasoning?: string;
    dispatchSuccess?: boolean;
    dispatchError?: string;
  },
  startTime: number,
  logger: Logger,
): Promise<void> {
  const eventId = event.auditEventId ?? event.id;
  const input: CreateEventDecisionInput = {
    eventId,
    ...(event.auditEventId !== undefined && { normalizedEventId: event.id }),
    repository: event.repository,
    pullRequestNumber: event.pullRequestNumber,
    eventType: event.eventType,
    eventAction: event.action ?? 'unknown',
    senderLogin: event.senderLogin,
    decidedBy: fields.decidedBy,
    decision: fields.decision,
    reason: fields.reason,
    ...(fields.dispatchAction !== undefined && { dispatchAction: fields.dispatchAction }),
    ...(fields.dispatchParams !== undefined && { dispatchParams: fields.dispatchParams }),
    ...(fields.llmCostUsd !== undefined && { llmCostUsd: fields.llmCostUsd }),
    ...(fields.llmModel !== undefined && { llmModel: fields.llmModel }),
    ...(fields.llmToolCalls !== undefined && { llmToolCalls: fields.llmToolCalls }),
    ...(fields.llmReasoning !== undefined && { llmReasoning: fields.llmReasoning }),
    ...(fields.dispatchSuccess !== undefined && { dispatchSuccess: fields.dispatchSuccess }),
    ...(fields.dispatchError !== undefined && { dispatchError: fields.dispatchError }),
    decisionLatencyMs: Date.now() - startTime,
  };

  try {
    const decisionResult = await deps.eventDecisionRepo.save(input);
    if (!decisionResult.ok) {
      logger.error(
        { eventId: event.id, auditEventId: event.auditEventId, error: decisionResult.error },
        'Failed to save event decision audit record'
      );
      return;
    }

    if (event.auditEventId !== undefined && deps.gitHubEventLogEntryRepo !== undefined) {
      const completeResult = await deps.gitHubEventLogEntryRepo.complete({
        id: event.auditEventId,
        decisionId: decisionResult.value.id,
        decisionState: 'completed',
        decisionOutcome: fields.decision,
        updatedAt: new Date(),
        rowVersion: 2,
      });

      if (!completeResult.ok) {
        logger.error(
          { eventId: event.id, auditEventId: event.auditEventId, error: completeResult.error },
          'Failed to complete GitHub event log entry'
        );
      }
    }
  } catch (saveError) {
    logger.error(
      { eventId: event.id, error: saveError },
      'Failed to save event decision audit record'
    );
  }
}

const REMEDIATION_RECENCY_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Check whether a recent remediation task indicates that re-review should be skipped.
 * Returns true when review should be SKIPPED, false when review should proceed.
 * Fails open: any error → proceed with review (return false).
 */
async function shouldSkipReviewForRemediation(
  codeTaskRepo: CodeTaskRepository,
  repository: string,
  prNumber: number,
  eventId: string,
  logger: Logger,
): Promise<boolean> {
  const result = await codeTaskRepo.findRecentRemediationForPR(repository, prNumber);
  if (!result.ok) {
    logger.warn(
      { eventId, error: result.error },
      'Failed to check remediation task for synchronize interception, proceeding with review',
    );
    return false;
  }

  const task: CodeTask | null = result.value;
  if (task === null) {
    return false;
  }

  // A remediation task is "recent" if running, OR completed within the recency window
  const isRunning = task.status === 'running';
  const isRecentlyCompleted = task.completedAt !== undefined &&
    (Date.now() - task.completedAt.toDate().getTime()) < REMEDIATION_RECENCY_MS;

  if (!isRunning && !isRecentlyCompleted) {
    return false;
  }

  // Only an explicit true requests a fresh review. Undefined preserves the duplicate-review guard.
  return task.requiresReReview !== true;
}

/** Deduplicate tool calls into string summaries for automation log events. */
function deduplicateToolCalls(toolCalls: { tool: string; args: Record<string, unknown> }[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tc of toolCalls) {
    const key = `${tc.tool}(${JSON.stringify(tc.args)})`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}
