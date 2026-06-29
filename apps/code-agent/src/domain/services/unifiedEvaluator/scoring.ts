/**
 * LLM triage flow for UnifiedEvaluator:
 * - retry-on-failure for pull_request events with corrective context
 * - dispatch / request_review / skip branches
 * - fallback handler when LLM is unavailable or fails
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { EventDecisionReviewType } from '../../models/eventDecision.js';
import { resolveLoginForTaskCreation } from '../gitHubDispatchService.js';
import { isReviewCommandComment, extractReviewWorkerType } from '../../utils/reviewTriage.js';
import type { UnifiedEvaluatorDeps } from './types.js';
import { deduplicateToolCalls, recordDecision, recordLog, resolveUserId } from './reporting.js';
import { FAILED_ORIGIN_NO_REVIEW_REASON, shouldSkipReviewForFailedOrigin, shouldSkipReviewForRemediation } from './criteria.js';

/**
 * Event-type-aware fallback when LLM is unavailable or fails.
 * - issue_comment / pull_request_review / pull_request_review_comment → dispatch
 *   (don't miss human requests)
 * - pull_request (and others) → skip (don't waste review costs)
 */
export async function handleFallback(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  reason: string,
  startTime: number,
  logger: Logger,
): Promise<void> {
  if (event.eventType === 'issue_comment' || event.eventType === 'pull_request_review' || event.eventType === 'pull_request_review_comment') {
    logger.warn({ eventId: event.id, _skipSentry: true }, 'Fallback: dispatching comment event');

    // Record automation log: triage_failed with fallback dispatch
    const userId = await resolveUserId(deps, event);
    recordLog(deps, event, {
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
      logger.warn({ eventId: event.id, error: fallbackResult.error, _skipSentry: true }, 'Dispatch failed for fallback decision');
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
    const userId = await resolveUserId(deps, event);
    recordLog(deps, event, {
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

/**
 * LLM triage entry point — assumes hard rules returned 'needs_triage'.
 * Handles retry-with-correction for pull_request events, then branches on
 * the triage action (dispatch / request_review / skip). Falls back if the
 * LLM is not configured or repeatedly fails.
 */
export async function handleLlmTriage(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  startTime: number,
  logger: Logger,
): Promise<void> {
  if (deps.evaluateEvent === undefined) {
    logger.warn({ eventId: event.id }, 'No LLM configured for triage, using fallback');
    await handleFallback(deps, event, 'no_llm_configured', startTime, logger);
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
      { eventId: event.id, error: llmResult.error, _skipSentry: true },
      'LLM triage failed for pull_request event, retrying with correction context'
    );
    llmResult = await deps.evaluateEvent(event, correctionContext);
  }

  if (!llmResult.ok) {
    logger.warn(
      { eventId: event.id, error: llmResult.error, _skipSentry: true },
      'LLM triage failed'
    );

    // Fail closed for explicit @review commands - do not fallback dispatch
    /* v8 ignore start -- upstream: isReviewCommandComment('') is always false, so event.body must be truthy when the if-true branch is taken — the ?? '' right side is unreachable in practice @preserve */
    if (event.eventType === 'issue_comment' && isReviewCommandComment(event.body ?? '')) {
      const workerType = extractReviewWorkerType(event.body ?? '');
      /* v8 ignore stop @preserve */

      // Record automation log: triage_failed for @review
      const userId = await resolveUserId(deps, event);
      recordLog(deps, event, {
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

    await handleFallback(deps, event, llmResult.error.message, startTime, logger);
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
    const userId = await resolveUserId(deps, event);
    recordLog(deps, event, {
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
    // Failed-origin gate: if the PR's latest planning/execution origin task
    // ended in a terminal failure (failed/interrupted/cancelled), suppress the
    // review for ANY event type. Runs before the synchronize-only remediation
    // check so it short-circuits without an extra Firestore lookup.
    if (deps.codeTaskRepo !== undefined) {
      const failedOrigin = await shouldSkipReviewForFailedOrigin(
        deps.codeTaskRepo, event.repository, event.pullRequestNumber, event.id, logger,
      );
      if (failedOrigin.skip) {
        const { origin } = failedOrigin;
        const userId = await resolveUserId(deps, event);
        logger.info(
          {
            eventId: event.id,
            originTaskId: origin.taskId,
            originAgentType: origin.agentType,
            originStatus: origin.status,
          },
          'Skipping review: latest origin task ended in terminal failure',
        );
        recordLog(deps, event, {
          type: 'skipped',
          decidedBy: 'llm_triage',
          reason: FAILED_ORIGIN_NO_REVIEW_REASON,
          cost: usage.costUsd,
          reasoning,
          toolCalls: toolCallSummaries,
        }, userId);
        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'skip',
          reason: `${FAILED_ORIGIN_NO_REVIEW_REASON}: latest origin task (${origin.agentType}, ${origin.status}) ended in terminal failure — retry the task before requesting review`,
          llmCostUsd: usage.costUsd,
          ...(usage.model !== undefined && { llmModel: usage.model }),
          llmToolCalls: usage.toolCalls,
          llmReasoning: reasoning,
        }, startTime, logger);
        return;
      }
    }

    // Synchronize remediation interception:
    // Before triggering a review for a synchronize event, check if a recent
    // remediation task already determined that no re-review is needed.
    if (event.eventType === 'pull_request' && event.action === 'synchronize' && deps.codeTaskRepo !== undefined) {
      const shouldSkip = await shouldSkipReviewForRemediation(
        deps.codeTaskRepo, event.repository, event.pullRequestNumber, event.id, logger,
      );
      if (shouldSkip) {
        const userId = await resolveUserId(deps, event);
        recordLog(deps, event, {
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
      const userId = await resolveUserId(deps, event);
      recordLog(deps, event, {
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
    const userId = await resolveUserId(deps, event);
    recordLog(deps, event, {
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
  const userId = await resolveUserId(deps, event);
  recordLog(deps, event, {
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

  // Best-effort: notify that review was skipped so ready-to-merge label can be set.
  // Only LLM triage skips qualify — hard-rules skips are pre-triage rejections.
  if (deps.onReviewSkipped !== undefined) {
    void deps.onReviewSkipped({ repository: event.repository, prNumber: event.pullRequestNumber }).catch((skipErr: unknown) => {
      logger.warn({ error: skipErr, eventId: event.id }, 'onReviewSkipped callback failed (best-effort)');
    });
  }
}
