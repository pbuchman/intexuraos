/**
 * Deterministic pre-LLM evaluation for UnifiedEvaluator:
 * - CIFailureRule handling for check_suite events (runs BEFORE webhookRules.evaluate)
 * - Hard-rule dispatch / skip outcomes from webhookRules.evaluate
 * - Remediation-task interception for synchronize events
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { CodeTask } from '../../models/codeTask.js';
import type { CIFailureDispatchService } from '../gitHubDispatchService.js';
import { CIFailureRule } from '../gitHubWebhookRules.js';
import type { UnifiedEvaluatorDeps } from './types.js';
import { dispatchAndRecord, recordDecision, recordLog, resolveUserId } from './reporting.js';

export const REMEDIATION_RECENCY_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Handle CIFailureRule for check_suite events.
 * Returns `true` if the event has been fully handled (facade should return);
 * `false` if evaluation should fall through to the normal webhook rules path.
 *
 * CIFailureRule must be evaluated BEFORE webhookRules.evaluate() because the rule chain
 * returns ALL_RULES_PASSED as the reason, not individual rule reasons. This means the
 * CHECK_SUITE_TASK_BRANCH reason check would never match if we relied on the chain.
 */
export async function handleCheckSuiteCIFailure(
  deps: UnifiedEvaluatorDeps,
  ciFailureDispatchService: CIFailureDispatchService,
  event: GitHubPREvent,
  startTime: number,
  logger: Logger,
): Promise<boolean> {
  const ciFailureRule = new CIFailureRule();
  const ciRuleOutcome = ciFailureRule.evaluate(event);
  logger.info(
    { eventId: event.id, action: ciRuleOutcome.action, reason: ciRuleOutcome.reason },
    'CIFailureRule evaluated for check_suite event'
  );

  if (ciRuleOutcome.action === 'dispatch' && ciRuleOutcome.reason === 'CHECK_SUITE_TASK_BRANCH') {
    const ciResult = await ciFailureDispatchService.dispatchCIFailure({ event, logger });

    if (ciResult.skipped === true) {
      const skipEvent: { type: 'ci_failure_skip'; reason: string; headBranch?: string } = {
        type: 'ci_failure_skip',
        reason: ciResult.skipReason ?? 'unknown',
        ...(event.baseBranch !== null && { headBranch: event.baseBranch }),
      };
      recordLog(deps, event, skipEvent);

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
    return true;
  }

  // For check_suite events that don't match (skip), we still continue to normal
  // webhook rules evaluation for consistent handling.
  /* v8 ignore start -- upstream: CIFailureRule only returns dispatch(CHECK_SUITE_TASK_BRANCH) or skip for check_suite events — false branch unreachable @preserve */
  if (ciRuleOutcome.action === 'skip') {
  /* v8 ignore stop @preserve */
    logger.info(
      { eventId: event.id, reason: ciRuleOutcome.reason },
      'CIFailureRule skipped check_suite event'
    );
    // Continue to normal webhook rules evaluation for consistent handling
  }
  return false;
}

/**
 * Evaluate hard rules and handle dispatch / skip outcomes.
 * Returns `'handled'` when the outcome was dispatch or skip (facade should return);
 * `'needs_triage'` when LLM triage should run next.
 */
export async function handleHardRules(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  startTime: number,
  logger: Logger,
): Promise<'handled' | 'needs_triage'> {
  const ruleOutcome = deps.webhookRules.evaluate(event);

  logger.info(
    { eventId: event.id, action: ruleOutcome.action, reason: ruleOutcome.reason },
    'Hard rules evaluated'
  );

  if (ruleOutcome.action === 'dispatch') {
    await dispatchAndRecord(deps, event, ruleOutcome, startTime, logger);
    return 'handled';
  }

  if (ruleOutcome.action === 'skip') {
    // Best-effort GitHub comment for unauthorized senders
    if (ruleOutcome.reason === 'SENDER_NOT_WHITELISTED' && deps.onUnauthorizedSender !== undefined) {
      void deps.onUnauthorizedSender(event).catch((commentErr: unknown) => {
        logger.warn({ commentErr, eventId: event.id }, 'Failed to post unauthorized sender comment');
      });
    }

    // Record automation log: hard_rules skip
    const userId = await resolveUserId(deps, event);
    recordLog(deps, event, {
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
    return 'handled';
  }

  return 'needs_triage';
}

/**
 * Check whether a recent remediation task indicates that re-review should be skipped.
 * Returns true when review should be SKIPPED, false when review should proceed.
 * Fails open: any error → proceed with review (return false).
 */
export async function shouldSkipReviewForRemediation(
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

  // Only an explicit false suppresses a fresh review. Undefined fails open to review.
  return task.requiresReReview === false;
}
